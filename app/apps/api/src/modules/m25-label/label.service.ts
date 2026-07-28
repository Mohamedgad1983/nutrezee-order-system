import type { Pool } from 'pg';
import type {
  LabelAddressContract, LabelDocumentContract, LabelMealRowContract, LabelMealSource,
  LabelNutritionTotalsContract,
} from '@nutrezee/shared';
import { code128Svg } from './code128';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { BarcodeService } from './barcode.service';
import type { FleetbaseOrderProjection } from './fleetbase-identity.service';

// m25-label — builds the exact legacy label (WP-LBL-02, amendment A27) and records prints.
//
// Reads customer / order / address / package / dish data through their owning modules' tables and
// writes ONLY label_print_event (single write path). Barcode issuance is delegated to
// BarcodeService, so a label render can never mint a second barcode for a customer.
//
// Nutrition rule (A27, binding): every meal value is read from customer_dish_day_item. There is no
// fallback, no averaging and no name-matching against the catalog — a date whose dish detail was
// never captured renders meal_source='no_dish_source' with zero rows, and the label prints an
// explicit marker rather than an invented number.

export class LabelError extends Error {
  constructor(readonly code: 'validation_failed' | 'not_found' | 'conflict', readonly detail?: unknown) {
    super(code);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-07-28` -> `Tuesday 28th July 2026`, matching the legacy label's date format exactly. */
export function formatLabelDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${d}${ordinalSuffix(d)} ${MONTHS[m - 1]} ${y}`;
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}

export class LabelService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly barcodes: BarcodeService,
  ) {}

  /**
   * Build the render-ready label for one order on one delivery date. Read-only apart from
   * first-time barcode issuance, which is idempotent.
   */
  async build(
    actor: StaffContext,
    orderId: string,
    deliveryDate: string,
    source?: { driverRef?: string | null },
  ): Promise<LabelDocumentContract> {
    if (!DATE_RE.test(deliveryDate ?? '')) {
      throw new LabelError('validation_failed', { field: 'delivery_date' });
    }

    const { rows } = await this.pool.query(
      `SELECT co.id                       AS order_id,
              co.order_number,
              co.customer_id,
              coalesce(co.package_name_frozen_en, p.name_en) AS package_name,
              co.delivery_time_frozen,
              co.delivery_method_frozen,
              co.delivery_area_frozen,
              p.meals_per_day,
              c.full_name_en,
              c.notes                     AS customer_notes,
              ph.phone_normalized,
              a.block, a.street, a.building, a.house_no, a.delivery_notes,
              ar.name_en                  AS area_name,
              sr.legacy_key               AS legacy_user_id,
              osp.days_remaining
         FROM customer_order co
         LEFT JOIN customer c  ON c.id = co.customer_id
         LEFT JOIN package  p  ON p.id = co.package_id
         LEFT JOIN LATERAL (
              SELECT phone_normalized FROM customer_phone
               WHERE customer_id = co.customer_id
               ORDER BY is_primary DESC, created_at ASC LIMIT 1) ph ON true
         LEFT JOIN LATERAL (
              SELECT * FROM address
               WHERE customer_id = co.customer_id AND active
               ORDER BY created_at ASC LIMIT 1) a ON true
         LEFT JOIN area ar ON ar.id = a.area_id
         LEFT JOIN sync_record sr ON sr.object_type = 'customer' AND sr.new_ref = co.customer_id
         LEFT JOIN analytics.order_subscription_periods osp ON osp.order_id = co.id
        WHERE co.id = $1
        LIMIT 1`,
      [orderId],
    );
    if (rows.length === 0) throw new LabelError('not_found', { order_id: orderId });
    const r = rows[0] as Record<string, unknown>;

    const [meals, mealSource] = await this.mealRows(orderId, deliveryDate);
    const driverRef = source && 'driverRef' in source
      ? source.driverRef ?? null
      : await this.driverRef(orderId, deliveryDate);
    const barcode = await this.barcodes.issueFor(actor, r.customer_id as string);

    const address: LabelAddressContract = {
      area: (r.area_name as string) ?? (r.delivery_area_frozen as string) ?? null,
      block: (r.block as string) ?? null,
      street: (r.street as string) ?? null,
      building: (r.building as string) ?? null,
      // No clean `floor` column exists (address.block_floor_raw is documented as building+block,
      // not floor). Printing blank here mirrors the legacy label, which itself prints "Floor: -".
      floor: null,
      flat: (r.house_no as string) ?? null,
      direction: (r.delivery_notes as string) ?? null,
    };

    return {
      order_id: orderId,
      customer_id: r.customer_id as string,
      delivery_date: deliveryDate,
      full_name: (r.full_name_en as string) ?? '',
      subscription_date_display: formatLabelDate(deliveryDate),
      delivery_time: (r.delivery_time_frozen as string) ?? null,
      days_remaining: r.days_remaining === null || r.days_remaining === undefined
        ? null : Number(r.days_remaining),
      delivery_method: (r.delivery_method_frozen as string) ?? null,
      package_name: (r.package_name as string) ?? null,
      meals_per_day: r.meals_per_day === null || r.meals_per_day === undefined
        ? null : Number(r.meals_per_day),
      // No snacks-per-day column exists anywhere in the schema (documented gap, A27 discovery §2).
      snacks_per_day: null,
      legacy_user_id: (r.legacy_user_id as string) ?? null,
      driver_ref: driverRef,
      order_number: r.order_number as string,
      address,
      phone: (r.phone_normalized as string) ?? null,
      notes: (r.customer_notes as string) ?? null,
      meals,
      meal_source: mealSource,
      totals: totalsOf(meals),
      barcode_value: barcode.barcode_value,
      barcode_svg: code128Svg(barcode.barcode_value, { moduleWidth: 1, height: 44, quietModules: 10 }),
    };
  }

  /**
   * Resolve a server-fetched Fleetbase order to one local order by exact bridge metadata only.
   * The browser never chooses the Nutrezee order id. This supports both the m24 bridge metadata
   * and the read-only Partner daily-dispatch metadata already stored on Fleetbase orders.
   */
  async resolveFleetbaseOrder(order: FleetbaseOrderProjection): Promise<string> {
    const meta = order.meta ?? {};
    const ids = compactStrings([meta.nutrezee_order_id]);
    const numbers = compactStrings([
      meta.source_order_number,
      meta.external_ref,
      order.internal_id,
    ]);
    if (ids.length === 0 && numbers.length === 0) {
      throw new LabelError('not_found', { reason: 'fleetbase_order_has_no_nutrezee_reference' });
    }
    // A direct Nutrezee id is authoritative. If Fleetbase also carries a contradictory order
    // number, or the direct id is stale, fail closed instead of silently falling back.
    const { rows } = ids.length > 0
      ? await this.pool.query(
        `SELECT id FROM customer_order WHERE id = ANY($1::text[]) ORDER BY id LIMIT 2`,
        [ids],
      )
      : await this.pool.query(
        `SELECT id FROM customer_order WHERE order_number = ANY($1::text[]) ORDER BY id LIMIT 2`,
        [numbers],
      );
    if (rows.length === 0) {
      throw new LabelError('not_found', { reason: 'fleetbase_order_not_in_nutrezee' });
    }
    if (rows.length > 1) {
      throw new LabelError('conflict', { reason: 'fleetbase_order_reference_ambiguous' });
    }
    return (rows[0] as Record<string, unknown>).id as string;
  }

  fleetbaseDriverRef(order: FleetbaseOrderProjection): string | null {
    const driver = order.driver_assigned;
    return driver?.internal_id?.trim()
      || driver?.name?.trim()
      || driver?.public_id?.trim()
      || driver?.id?.trim()
      || null;
  }

  /**
   * Labels for every order scheduled on a date, optionally narrowed to one driver. Drives batch
   * printing; returns the same document shape as the single-label path.
   */
  async buildBatch(
    actor: StaffContext, deliveryDate: string, driverId?: string,
  ): Promise<LabelDocumentContract[]> {
    if (!DATE_RE.test(deliveryDate ?? '')) {
      throw new LabelError('validation_failed', { field: 'delivery_date' });
    }
    const params: unknown[] = [deliveryDate];
    let driverClause = '';
    if (driverId) {
      params.push(driverId);
      driverClause = `AND EXISTS (
          SELECT 1 FROM delivery_route_order dro
            JOIN delivery_route dr ON dr.id = dro.route_id
           WHERE dro.order_id = fd.order_id AND dr.delivery_date = fd.date
             AND dr.driver_id = $${params.length} AND dro.status <> 'returned')`;
    }
    const { rows } = await this.pool.query(
      `SELECT DISTINCT fd.order_id
         FROM fulfillment_day fd
        WHERE fd.date = $1
          AND fd.status NOT IN ('cancelled_day','skipped')
          ${driverClause}
        ORDER BY fd.order_id`,
      params,
    );
    const out: LabelDocumentContract[] = [];
    for (const row of rows) {
      out.push(await this.build(actor, (row as Record<string, unknown>).order_id as string, deliveryDate));
    }
    return out;
  }

  /**
   * Record that a label was physically printed. A reprint must carry a reason (enforced here and
   * by a DB CHECK). The barcode value is stored so the trail proves reprints never change it.
   */
  async recordPrint(
    actor: StaffContext, orderId: string, deliveryDate: string,
    opts: { kind: 'print' | 'reprint'; reason?: string; batchRef?: string },
  ): Promise<{ id: string; barcode_value: string; print_kind: 'print' | 'reprint' }> {
    if (!DATE_RE.test(deliveryDate ?? '')) {
      throw new LabelError('validation_failed', { field: 'delivery_date' });
    }
    const reason = (opts.reason ?? '').trim();
    if (opts.kind === 'reprint' && !reason) throw new LabelError('validation_failed', { field: 'reason' });

    const { rows } = await this.pool.query(
      'SELECT customer_id FROM customer_order WHERE id=$1', [orderId],
    );
    if (rows.length === 0) throw new LabelError('not_found', { order_id: orderId });
    const customerId = (rows[0] as Record<string, unknown>).customer_id as string;
    const barcode = await this.barcodes.issueFor(actor, customerId);

    return withTransaction(this.pool, async (client) => {
      const id = newId();
      await client.query(
        `INSERT INTO label_print_event
           (id, order_id, customer_id, delivery_date, barcode_value, print_kind, reason, batch_ref, printed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, orderId, customerId, deliveryDate, barcode.barcode_value, opts.kind,
          reason || null, opts.batchRef ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: opts.kind === 'reprint' ? 'label.reprinted' : 'label.printed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'label_print_event', entityId: id,
        severity: opts.kind === 'reprint' ? 'warn' : 'info',
        reason: reason || undefined,
        relatedRefs: { order_id: orderId, customer_id: customerId, delivery_date: deliveryDate },
        after: { barcode_value: barcode.barcode_value, print_kind: opts.kind },
      });
      return { id, barcode_value: barcode.barcode_value, print_kind: opts.kind };
    });
  }

  /** Print history for one order+date, newest first. Drives the "already printed" reprint prompt. */
  async printHistory(orderId: string, deliveryDate: string): Promise<Array<{
    id: string; print_kind: string; reason: string | null; printed_by: string; printed_at: string;
    barcode_value: string;
  }>> {
    const { rows } = await this.pool.query(
      `SELECT id, print_kind, reason, printed_by, printed_at, barcode_value
         FROM label_print_event WHERE order_id=$1 AND delivery_date=$2
        ORDER BY printed_at DESC`,
      [orderId, deliveryDate],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id as string,
        print_kind: row.print_kind as string,
        reason: (row.reason as string) ?? null,
        printed_by: row.printed_by as string,
        printed_at: row.printed_at instanceof Date ? row.printed_at.toISOString() : String(row.printed_at),
        barcode_value: row.barcode_value as string,
      };
    });
  }

  // ---- helpers ----

  /**
   * The label's meal rows for this order+date. Deleted dish rows are excluded. Returns
   * `no_dish_source` when the date has no captured dish detail — the caller must render an
   * explicit empty state, never substitute values.
   */
  private async mealRows(orderId: string, deliveryDate: string): Promise<[LabelMealRowContract[], LabelMealSource]> {
    const { rows } = await this.pool.query(
      `SELECT i.dish_name, i.quantity, i.protein, i.carbs, i.fat, i.calories
         FROM customer_dish_day d
         JOIN customer_dish_day_item i ON i.customer_dish_day_id = d.id
        WHERE d.customer_order_id = $1 AND d.meal_date = $2
          AND coalesce(i.is_deleted, false) = false
        ORDER BY d.legacy_order_meal_id NULLS LAST, i.sort_order NULLS LAST, i.created_at, i.id`,
      [orderId, deliveryDate],
    );
    if (rows.length === 0) return [[], 'no_dish_source'];
    const meals = rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        dish_name: (r.dish_name as string) ?? '',
        qty: r.quantity === null || r.quantity === undefined ? 1 : Number(r.quantity),
        protein: numOrNull(r.protein),
        carbs: numOrNull(r.carbs),
        fat: numOrNull(r.fat),
        calories: numOrNull(r.calories),
      };
    });
    return [meals, 'dish_day'];
  }

  /** The legacy-style driver reference for this order's route on this date, when assigned. */
  private async driverRef(orderId: string, deliveryDate: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT coalesce(d.legacy_driver_id, d.name) AS driver_ref
         FROM delivery_route_order dro
         JOIN delivery_route dr ON dr.id = dro.route_id
         LEFT JOIN driver d ON d.id = dr.driver_id
        WHERE dro.order_id = $1 AND dr.delivery_date = $2 AND dro.status <> 'returned'
        ORDER BY dro.created_at DESC LIMIT 1`,
      [orderId, deliveryDate],
    );
    return rows.length ? ((rows[0] as Record<string, unknown>).driver_ref as string) ?? null : null;
  }
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function compactStrings(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

/**
 * Column sums of the rendered rows — the legacy label's "Total Nutrition" is exactly this sum,
 * verified against the reference label (16+21+9+2+1 = 49; 24+34+24+12+11 = 105; 12+11+6+6+0 = 35;
 * 268+319+186+110+48 = 931 — all four match the printed totals).
 *
 * The displayed values are summed AS DISPLAYED and deliberately NOT multiplied by qty: every row
 * on the reference label has qty 1, so whether a row's figures are per-unit or per-line cannot be
 * determined from the legacy output. Multiplying would be a guess; summing the column reproduces
 * the one behaviour that is actually verified.
 *
 * `complete` is false when any rendered row was missing a value, so the label can flag a partial
 * total instead of implying a verified one.
 */
export function totalsOf(meals: LabelMealRowContract[]): LabelNutritionTotalsContract {
  if (meals.length === 0) {
    return { protein: null, carbs: null, fat: null, calories: null, complete: false };
  }
  let complete = true;
  const sum = (pick: (m: LabelMealRowContract) => number | null): number | null => {
    let total = 0;
    let sawValue = false;
    for (const m of meals) {
      const v = pick(m);
      if (v === null) { complete = false; continue; }
      total += v;
      sawValue = true;
    }
    return sawValue ? Math.round(total * 100) / 100 : null;
  };
  const protein = sum((m) => m.protein);
  const carbs = sum((m) => m.carbs);
  const fat = sum((m) => m.fat);
  const calories = sum((m) => m.calories);
  return { protein, carbs, fat, calories, complete };
}
