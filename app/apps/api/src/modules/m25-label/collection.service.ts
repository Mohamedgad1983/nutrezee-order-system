import type { Pool, PoolClient } from 'pg';
import type {
  CollectionManifestContract, CollectionManifestEntryContract, CollectionOutcome,
  CollectionScanResultContract,
} from '@nutrezee/shared';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { BarcodeService } from './barcode.service';

// m25-label — daily box collection (WP-LBL-03, amendment A27).
//
// A driver scans a customer's permanent barcode; the system decides the outcome by combining the
// barcode, today's date, the logged-in driver and that driver's manifest. Every outcome — accepted
// AND every rejection — is written to audit_event in the same transaction. Writes ONLY
// box_collection; fulfillment_day / delivery_route / customer are read-only here.
//
// Duplicate prevention is DB-enforced by UNIQUE (customer_id, delivery_date): even two concurrent
// scans of the same box resolve to exactly one accepted collection.

/** Statuses on which a day is not deliverable. */
const CANCELLED_STATUSES = ['cancelled_day', 'skipped'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNIQUE_VIOLATION = '23505';

export class CollectionError extends Error {
  constructor(readonly code: 'validation_failed' | 'not_found' | 'forbidden', readonly detail?: unknown) {
    super(code);
  }
}

interface DeliveryRow {
  fulfillment_day_id: string;
  order_id: string;
  order_number: string;
  status: string;
  delivery_time: string | null;
  area: string | null;
}

interface Messages { en: string; ar: string }

/** Driver-facing wording for each outcome, in both label languages. */
const MESSAGES: Record<CollectionOutcome, Messages> = {
  accepted: { en: 'Collected — daily box recorded.', ar: 'تم الاستلام — تم تسجيل صندوق اليوم.' },
  duplicate: { en: 'Already collected today.', ar: 'تم استلامه اليوم بالفعل.' },
  wrong_driver: { en: 'Not on your manifest today.', ar: 'ليس ضمن قائمتك اليوم.' },
  no_delivery_today: { en: 'This customer has no delivery today.', ar: 'لا يوجد توصيل لهذا العميل اليوم.' },
  cancelled: { en: "Today's delivery is cancelled.", ar: 'تم إلغاء توصيل اليوم.' },
  unknown_barcode: { en: 'Barcode not recognised.', ar: 'الباركود غير معروف.' },
  ambiguous_delivery: {
    en: 'More than one active delivery — contact operations.',
    ar: 'يوجد أكثر من توصيل نشط — تواصل مع العمليات.',
  },
};

export class CollectionService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly barcodes: BarcodeService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Today in Kuwait — the operating timezone the analytics layer already standardises on. */
  async today(): Promise<string> {
    const { rows } = await this.pool.query(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD') AS d`,
    );
    return (rows[0] as Record<string, unknown>).d as string;
  }

  /**
   * The signed-in driver's manifest for a date: who is assigned, who has been collected, who is
   * still outstanding. Read-only.
   */
  async manifest(actor: StaffContext, date?: string): Promise<CollectionManifestContract> {
    const deliveryDate = date ?? await this.today();
    if (!DATE_RE.test(deliveryDate)) throw new CollectionError('validation_failed', { field: 'delivery_date' });

    const driver = await this.driverForStaff(actor.staffId);
    if (!driver) throw new CollectionError('forbidden', { reason: 'staff_user_not_linked_to_driver' });

    const { rows } = await this.pool.query(
      `SELECT co.customer_id,
              c.full_name_en                AS customer_name,
              co.order_number,
              coalesce(dro.area, co.delivery_area_frozen)                   AS area,
              coalesce(dro.delivery_time_frozen, co.delivery_time_frozen)   AS delivery_time,
              bc.id                         AS collection_id,
              bc.scanned_at
         FROM delivery_route dr
         JOIN delivery_route_order dro ON dro.route_id = dr.id AND dro.status <> 'returned'
         JOIN customer_order co ON co.id = dro.order_id
         LEFT JOIN customer c ON c.id = co.customer_id
         JOIN fulfillment_day fd ON fd.order_id = co.id AND fd.date = dr.delivery_date
                                AND fd.status <> ALL($3::text[])
         LEFT JOIN box_collection bc ON bc.customer_id = co.customer_id AND bc.delivery_date = dr.delivery_date
        WHERE dr.driver_id = $1 AND dr.delivery_date = $2
        ORDER BY (bc.id IS NOT NULL), c.full_name_en NULLS LAST, co.order_number`,
      [driver.id, deliveryDate, CANCELLED_STATUSES],
    );

    const entries: CollectionManifestEntryContract[] = rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        customer_id: r.customer_id as string,
        customer_name: (r.customer_name as string) ?? null,
        order_number: r.order_number as string,
        area: (r.area as string) ?? null,
        delivery_time: (r.delivery_time as string) ?? null,
        collected: r.collection_id !== null && r.collection_id !== undefined,
        collected_at: r.scanned_at instanceof Date ? r.scanned_at.toISOString()
          : (r.scanned_at as string) ?? null,
      };
    });
    const collected = entries.filter((e) => e.collected).length;
    return {
      delivery_date: deliveryDate,
      driver_ref: driver.driver_ref,
      total: entries.length,
      collected,
      remaining: entries.length - collected,
      entries,
    };
  }

  /**
   * Resolve one scan to exactly one outcome. Never throws for a business rejection — a rejection
   * is a result, not an error — so the driver app can render it. Every outcome is audited.
   */
  async scan(
    actor: StaffContext,
    input: { barcode: string; delivery_date?: string; device_ref?: string },
    idempotencyKey?: string,
  ): Promise<CollectionScanResultContract> {
    const deliveryDate = input.delivery_date ?? await this.today();
    if (!DATE_RE.test(deliveryDate)) throw new CollectionError('validation_failed', { field: 'delivery_date' });

    // A retried request (flaky signal in a stairwell) must repeat its original ACCEPTED answer
    // rather than degrade to `duplicate`, which would read to the driver as a failure.
    if (idempotencyKey) {
      const replay = await this.replayOf(idempotencyKey);
      if (replay) return replay;
    }

    const driver = await this.driverForStaff(actor.staffId);
    if (!driver) throw new CollectionError('forbidden', { reason: 'staff_user_not_linked_to_driver' });

    // 1 — barcode must resolve (alias rows resolve to the surviving customer)
    const resolved = await this.barcodes.resolve(input.barcode ?? '');
    if (!resolved) {
      return this.reject(actor, 'unknown_barcode', deliveryDate, {
        // Deliberately does not echo the scanned text back into audit: an unknown scan may be any
        // arbitrary barcode the driver pointed the camera at.
        relatedRefs: { driver_id: driver.id, delivery_date: deliveryDate },
      });
    }

    const customer = await this.customerName(resolved.customer_id);

    // 2 — the customer must have a delivery scheduled on this date
    const deliveries = await this.deliveriesFor(resolved.customer_id, deliveryDate);
    if (deliveries.length === 0) {
      return this.reject(actor, 'no_delivery_today', deliveryDate, {
        customerId: resolved.customer_id, customerName: customer,
        relatedRefs: { driver_id: driver.id, customer_id: resolved.customer_id, delivery_date: deliveryDate },
      });
    }

    const active = deliveries.filter((d) => !CANCELLED_STATUSES.includes(d.status));
    // 3 — every scheduled day for this date is cancelled
    if (active.length === 0) {
      return this.reject(actor, 'cancelled', deliveryDate, {
        customerId: resolved.customer_id, customerName: customer, delivery: deliveries[0],
        relatedRefs: { driver_id: driver.id, customer_id: resolved.customer_id, delivery_date: deliveryDate },
      });
    }
    // 4 — more than one live delivery: operations must decide, we must not guess
    if (active.length > 1) {
      return this.reject(actor, 'ambiguous_delivery', deliveryDate, {
        customerId: resolved.customer_id, customerName: customer,
        relatedRefs: {
          driver_id: driver.id, customer_id: resolved.customer_id, delivery_date: deliveryDate,
          order_ids: active.map((d) => d.order_id).join(','),
        },
      });
    }

    const delivery = active[0]!;

    // 5 — the delivery must be on THIS driver's manifest for this date
    const assignment = await this.assignmentFor(delivery.order_id, deliveryDate);
    if (!assignment || assignment.driver_id !== driver.id) {
      return this.reject(actor, 'wrong_driver', deliveryDate, {
        customerId: resolved.customer_id, customerName: customer, delivery,
        assignedDriverRef: assignment?.driver_ref ?? null,
        relatedRefs: {
          driver_id: driver.id, customer_id: resolved.customer_id, order_id: delivery.order_id,
          delivery_date: deliveryDate, assigned_driver_id: assignment?.driver_id ?? 'unassigned',
        },
      });
    }

    // 6 — already collected today?
    const existing = await this.existingCollection(resolved.customer_id, deliveryDate);
    if (existing) {
      return this.reject(actor, 'duplicate', deliveryDate, {
        customerId: resolved.customer_id, customerName: customer, delivery,
        collectedAt: existing.scanned_at,
        relatedRefs: {
          driver_id: driver.id, customer_id: resolved.customer_id, delivery_date: deliveryDate,
          existing_collection_id: existing.id,
        },
      });
    }

    // 7 — accept
    try {
      return await withTransaction(this.pool, async (client) => {
        if (idempotencyKey) {
          await this.idempotency.claimInTx(
            client, idempotencyKey, 'collection.scan',
            this.idempotency.hashRequest({ barcode: input.barcode, delivery_date: deliveryDate }),
          );
        }
        const id = newId();
        const { rows } = await client.query(
          `INSERT INTO box_collection
             (id, customer_id, delivery_date, order_id, fulfillment_day_id, driver_id, route_id,
              barcode_id, barcode_value, device_ref, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING scanned_at`,
          [id, resolved.customer_id, deliveryDate, delivery.order_id, delivery.fulfillment_day_id,
            driver.id, assignment.route_id, resolved.barcode_id, resolved.barcode_value,
            input.device_ref ?? null, actor.staffId],
        );
        await this.audit.writeInTx(client, {
          eventType: 'collection.accepted', actor: this.actor(actor),
          entityType: 'box_collection', entityId: id, severity: 'info',
          relatedRefs: {
            driver_id: driver.id, customer_id: resolved.customer_id, order_id: delivery.order_id,
            delivery_date: deliveryDate,
          },
          after: { outcome: 'accepted', barcode_value: resolved.barcode_value },
        });
        if (idempotencyKey) await this.idempotency.storeResponseInTx(client, idempotencyKey, id);
        const scannedAt = (rows[0] as Record<string, unknown>).scanned_at;
        return this.result('accepted', {
          customerId: resolved.customer_id, customerName: customer, delivery,
          collectedAt: scannedAt instanceof Date ? scannedAt.toISOString() : String(scannedAt),
          deliveryDate,
        });
      });
    } catch (e) {
      // Two scans raced: the loser reports `duplicate`, which is the truthful outcome.
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
        const settled = await this.existingCollection(resolved.customer_id, deliveryDate);
        return this.reject(actor, 'duplicate', deliveryDate, {
          customerId: resolved.customer_id, customerName: customer, delivery,
          collectedAt: settled?.scanned_at ?? null,
          relatedRefs: {
            driver_id: driver.id, customer_id: resolved.customer_id, delivery_date: deliveryDate,
            existing_collection_id: settled?.id ?? 'unknown', race: 'true',
          },
        });
      }
      throw e;
    }
  }

  // ---- helpers ----

  private async driverForStaff(staffUserId: string): Promise<{ id: string; driver_ref: string | null } | null> {
    const { rows } = await this.pool.query(
      `SELECT id, coalesce(legacy_driver_id, name) AS driver_ref
         FROM driver WHERE staff_user_id = $1 AND active LIMIT 1`,
      [staffUserId],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return { id: r.id as string, driver_ref: (r.driver_ref as string) ?? null };
  }

  /**
   * If this idempotency key already produced an accepted collection, rebuild that exact result.
   * Returns null when the key is unused, still in flight, or belonged to a different operation.
   */
  private async replayOf(key: string): Promise<CollectionScanResultContract | null> {
    const { rows } = await this.pool.query(
      `SELECT bc.id, bc.customer_id, bc.delivery_date, bc.scanned_at,
              c.full_name_en AS customer_name,
              co.order_number, co.delivery_time_frozen AS delivery_time,
              co.delivery_area_frozen AS area, bc.order_id, bc.fulfillment_day_id
         FROM idempotency_key ik
         JOIN box_collection bc ON bc.id = ik.response_ref
         LEFT JOIN customer c ON c.id = bc.customer_id
         LEFT JOIN customer_order co ON co.id = bc.order_id
        WHERE ik.key = $1 AND ik.operation = 'collection.scan' AND ik.response_ref IS NOT NULL
        LIMIT 1`,
      [key],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    const date = r.delivery_date instanceof Date
      ? r.delivery_date.toISOString().slice(0, 10) : String(r.delivery_date).slice(0, 10);
    return this.result('accepted', {
      customerId: r.customer_id as string,
      customerName: (r.customer_name as string) ?? null,
      delivery: {
        fulfillment_day_id: (r.fulfillment_day_id as string) ?? '',
        order_id: (r.order_id as string) ?? '',
        order_number: (r.order_number as string) ?? '',
        status: 'scheduled',
        delivery_time: (r.delivery_time as string) ?? null,
        area: (r.area as string) ?? null,
      },
      collectedAt: r.scanned_at instanceof Date ? r.scanned_at.toISOString() : String(r.scanned_at),
      deliveryDate: date,
    });
  }

  private async customerName(customerId: string): Promise<string | null> {
    const { rows } = await this.pool.query('SELECT full_name_en FROM customer WHERE id=$1', [customerId]);
    return rows.length ? ((rows[0] as Record<string, unknown>).full_name_en as string) ?? null : null;
  }

  private async deliveriesFor(customerId: string, date: string): Promise<DeliveryRow[]> {
    const { rows } = await this.pool.query(
      `SELECT fd.id AS fulfillment_day_id, fd.order_id, fd.status,
              co.order_number, co.delivery_time_frozen AS delivery_time,
              co.delivery_area_frozen AS area
         FROM fulfillment_day fd
         JOIN customer_order co ON co.id = fd.order_id
        WHERE co.customer_id = $1 AND fd.date = $2
        ORDER BY fd.created_at`,
      [customerId, date],
    );
    return rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        fulfillment_day_id: r.fulfillment_day_id as string,
        order_id: r.order_id as string,
        order_number: r.order_number as string,
        status: r.status as string,
        delivery_time: (r.delivery_time as string) ?? null,
        area: (r.area as string) ?? null,
      };
    });
  }

  private async assignmentFor(
    orderId: string, date: string,
  ): Promise<{ driver_id: string | null; driver_ref: string | null; route_id: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT dr.id AS route_id, dr.driver_id, coalesce(d.legacy_driver_id, d.name) AS driver_ref
         FROM delivery_route_order dro
         JOIN delivery_route dr ON dr.id = dro.route_id
         LEFT JOIN driver d ON d.id = dr.driver_id
        WHERE dro.order_id = $1 AND dr.delivery_date = $2 AND dro.status <> 'returned'
        ORDER BY dro.created_at DESC LIMIT 1`,
      [orderId, date],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      driver_id: (r.driver_id as string) ?? null,
      driver_ref: (r.driver_ref as string) ?? null,
      route_id: r.route_id as string,
    };
  }

  private async existingCollection(
    customerId: string, date: string,
  ): Promise<{ id: string; scanned_at: string } | null> {
    const { rows } = await this.pool.query(
      'SELECT id, scanned_at FROM box_collection WHERE customer_id=$1 AND delivery_date=$2 LIMIT 1',
      [customerId, date],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      id: r.id as string,
      scanned_at: r.scanned_at instanceof Date ? r.scanned_at.toISOString() : String(r.scanned_at),
    };
  }

  /** Audit a rejected scan in its own transaction, then shape the driver-facing result. */
  private async reject(
    actor: StaffContext, outcome: CollectionOutcome, deliveryDate: string,
    ctx: {
      customerId?: string; customerName?: string | null; delivery?: DeliveryRow;
      assignedDriverRef?: string | null; collectedAt?: string | null;
      relatedRefs: Record<string, string>;
    },
  ): Promise<CollectionScanResultContract> {
    await withTransaction(this.pool, async (client: PoolClient) => {
      await this.audit.writeInTx(client, {
        eventType: `collection.${outcome}`, actor: this.actor(actor),
        entityType: 'box_collection', entityId: ctx.customerId ?? 'unresolved',
        severity: 'warn', relatedRefs: ctx.relatedRefs, after: { outcome },
      });
    });
    return this.result(outcome, { ...ctx, deliveryDate });
  }

  private result(
    outcome: CollectionOutcome,
    ctx: {
      customerId?: string; customerName?: string | null; delivery?: DeliveryRow;
      assignedDriverRef?: string | null; collectedAt?: string | null; deliveryDate: string;
    },
  ): CollectionScanResultContract {
    return {
      outcome,
      customer_id: ctx.customerId ?? null,
      customer_name: ctx.customerName ?? null,
      order_number: ctx.delivery?.order_number ?? null,
      delivery_date: ctx.deliveryDate,
      delivery_time: ctx.delivery?.delivery_time ?? null,
      area: ctx.delivery?.area ?? null,
      collected_at: ctx.collectedAt ?? null,
      assigned_driver_ref: ctx.assignedDriverRef ?? null,
      message_en: MESSAGES[outcome].en,
      message_ar: MESSAGES[outcome].ar,
    };
  }

  private actor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }
}
