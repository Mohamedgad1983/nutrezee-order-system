import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import { TransitionEngine } from '../../platform/transition/transition-engine';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { DraftService, type DraftRecord } from '../m01-intake/draft.service';
import { ReviewService } from '../m02-review/review.service';
import { CustomerService } from '../m04-customers/customer.service';
import { CatalogService, type PackageForOrder } from '../m05-catalog/catalog.service';

export type OrderStatus = 'approved' | 'active' | 'paused' | 'completed' | 'expired' | 'cancelled' | 'rejected';
export type FulfillmentStatus = 'scheduled' | 'kitchen_queued' | 'in_preparation' | 'ready_to_pack' | 'packed'
  | 'assigned_to_driver' | 'out_for_delivery' | 'delivered' | 'failed' | 'rescheduled' | 'skipped' | 'cancelled_day';

export class OrderError extends Error {
  constructor(
    readonly code:
      | 'validation_failed'
      | 'not_found'
      | 'not_approved'
      | 'already_converted'
      | 'customer_required',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  start_date: string;
  end_date: string;
  source_draft_id: string | null;
  total: number;
}

export interface FulfillmentDayForKitchen {
  id: string;
  orderId: string;
  date: string;
  status: FulfillmentStatus;
  customerId: string;
}

export interface OrderItemForKitchen {
  id: string;
  productId: string | null;
  nameEn: string;
  nameAr: string | null;
  qty: number;
  allergensFrozen: Array<Record<string, unknown>>;
}

export interface OrderForPayment {
  id: string;
  status: OrderStatus;
  customerId: string;
  total: number;
  currency: string;
  expectedPaymentMethod: string | null;
}

export interface ImportedActivePlanInput {
  orderNumber: string;
  customerId: string;
  startDate: string;
  endDate: string;
  status?: OrderStatus;
  packageId?: string;
  packageNameEn?: string;
  packageNameAr?: string;
  offDays?: string[];
  offDaysUnverified?: boolean;
  channel?: string;
  total?: number;
  currency?: string;
  importBatchId: string;
  addressFrozen?: Record<string, unknown>;
  slotId?: string;
}

export interface ExceptionRow {
  id: string;
  type_code: string;
  order_id: string | null;
  refs: Record<string, string>;
  severity: 'info' | 'warn' | 'high';
  state: 'open' | 'in_progress' | 'resolved';
  owner_id: string | null;
  resolution_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export class OrderService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsReader,
    private readonly transitions: TransitionEngine,
    private readonly drafts: DraftService,
    private readonly reviews: ReviewService,
    private readonly customers: CustomerService,
    private readonly catalog: CatalogService,
  ) {
    this.transitions.registerValidator('payment_gate', async () => {
      await this.settings.get<string>('payment_gate', 'none');
    });
    this.transitions.registerValidator('pause_window', async () => undefined);
    this.transitions.registerValidator('same_day_ack', async () => undefined);
    this.transitions.registerValidator('plan_still_active', async () => undefined);
    this.transitions.registerValidator('routing_rules_present', async () => undefined);
    this.transitions.registerValidator('all_days_terminal', async (req) => this.assertAllDaysTerminal(req.subjectId));
  }

  async createFromApprovedDraft(actor: StaffContext, draftId: string): Promise<{ id: string; replay: boolean }> {
    const existing = await this.findByDraft(draftId);
    if (existing) return { id: existing, replay: true };
    const approval = await this.reviews.approvedDecisionForDraft(draftId);
    if (!approval) throw new OrderError('not_approved');
    const draft = await this.drafts.getDraft(draftId);
    if (draft.state !== 'submitted') throw new OrderError('validation_failed', { state: draft.state });
    if (!draft.customer_id) throw new OrderError('customer_required');
    const customerId = draft.customer_id;
    if (!draft.start_date) throw new OrderError('validation_failed', { field: 'start_date' });

    const pkg = draft.package_id ? await this.catalog.packageForOrder(draft.package_id) : null;
    const endDate = this.endDate(draft.start_date, draft.end_date, pkg);
    const amount = pkg?.price ?? draft.price_estimate ?? 0;
    const orderId = newId();
    const orderNumber = await this.nextOrderNumber();
    const addressFrozen = await this.addressFrozen(draft);

    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO customer_order
          (id, order_number, customer_id, package_id, package_name_frozen_en, package_name_frozen_ar,
           status, start_date, end_date, channel, source_draft_id, coupon_code_frozen,
           package_amount, discount, total, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,$8,$9,$10,$11,$12,0,$12,$13)`,
        [
          orderId, orderNumber, customerId, pkg?.id ?? null, pkg?.nameEn ?? null, pkg?.nameAr ?? null,
          draft.start_date, endDate, draft.channel, draft.id, draft.coupon_code, amount, actor.staffId,
        ],
      );
      await this.insertOrderItemsInTx(client, actor, orderId, draft, pkg);
      const dayCount = await this.generateDaysInTx(client, actor.staffId, orderId, draft.start_date as string, endDate, draft.slot_id, addressFrozen);
      await this.historyInTx(client, 'order', orderId, 'pending_review', 'approved', actor.staffId, null);
      await this.drafts.transitionToConvertedInTx(client, draftId, orderId);
      await this.audit.writeInTx(client, {
        eventType: 'order.approved',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'customer_order',
        entityId: orderId,
        severity: approval.warningsOverridden.length > 0 ? 'high' : 'info',
        reason: approval.warningsOverridden.length > 0 ? `override: ${approval.warningsOverridden.map((w) => w.field).join(',')}` : undefined,
        relatedRefs: { draft: draftId, customer: customerId },
        after: { order_number: orderNumber, start_date: draft.start_date, end_date: endDate, day_count: dayCount },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'order.approved',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { order_id: orderId, draft_id: draftId, customer_id: customerId },
        payload: {
          order_id: orderId, start_date: draft.start_date, end_date: endDate,
          day_count: dayCount, warnings_overridden: approval.warningsOverridden, payment_gate_state: await this.settings.get<string>('payment_gate', 'none'),
        },
      });
    });
    return { id: orderId, replay: false };
  }

  async getOrder(orderId: string): Promise<OrderRecord> {
    const { rows } = await this.pool.query(`SELECT * FROM customer_order WHERE id = $1`, [orderId]);
    if (rows.length === 0) throw new OrderError('not_found');
    return this.toOrder(rows[0]);
  }

  async listOrders(filters: { status?: OrderStatus } = {}): Promise<OrderRecord[]> {
    const params: unknown[] = [];
    const where = filters.status ? 'WHERE status = $1' : '';
    if (filters.status) params.push(filters.status);
    const { rows } = await this.pool.query(
      `SELECT * FROM customer_order ${where} ORDER BY start_date DESC, created_at DESC LIMIT 100`,
      params,
    );
    return rows.map((r) => this.toOrder(r));
  }

  async listDays(orderId: string): Promise<Array<{ id: string; date: string; status: FulfillmentStatus }>> {
    const { rows } = await this.pool.query(
      `SELECT id, date, status FROM fulfillment_day WHERE order_id = $1 ORDER BY date`,
      [orderId],
    );
    return rows.map((r) => ({ id: r.id as string, date: this.dateString(r.date), status: r.status as FulfillmentStatus }));
  }

  async transitionOrder(actor: StaffContext | 'system', orderId: string, to: OrderStatus, reason?: { code: string; note?: string }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const order = await this.loadOrderInTx(client, orderId, true);
      await this.transitions.transitionInTx({
        machine: 'order',
        subjectType: 'customer_order',
        subjectId: orderId,
        from: order.status,
        to,
        actor,
        reason,
        eventType: to === 'cancelled' ? 'order.cancelled' : 'order.status_changed',
        refs: { order_id: orderId, customer_id: order.customer_id },
        apply: async (tx) => {
          await tx.query(
            `UPDATE customer_order SET status = $2, updated_at = now(),
             updated_by = $3, version = version + 1 WHERE id = $1`,
            [orderId, to, actor === 'system' ? 'system' : actor.staffId],
          );
          await this.historyInTx(tx, 'order', orderId, order.status, to, actor === 'system' ? null : actor.staffId, null);
          if (to === 'cancelled') await this.cancelOpenDaysInTx(tx, actor === 'system' ? null : actor.staffId, orderId, reason?.code);
        },
      }, client);
    });
  }

  async transitionDay(actor: StaffContext | 'system', dayId: string, to: FulfillmentStatus, reason?: { code: string; note?: string }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await this.transitionDayInTx(client, actor, dayId, to, reason);
    });
  }

  async transitionDayInTx(
    client: PoolClient,
    actor: StaffContext | 'system',
    dayId: string,
    to: FulfillmentStatus,
    reason?: { code: string; note?: string },
  ): Promise<void> {
    const day = await this.loadDayInTx(client, dayId, true);
    await this.transitions.transitionInTx({
      machine: 'fulfillment',
      subjectType: 'fulfillment_day',
      subjectId: dayId,
      from: day.status,
      to,
      actor,
      reason,
      eventType: 'fulfillment.status_changed',
      refs: { fulfillment_day_id: dayId, order_id: day.order_id },
      apply: async (tx) => {
        await tx.query(
          `UPDATE fulfillment_day SET status = $2, updated_at = now(),
           updated_by = $3, version = version + 1 WHERE id = $1`,
          [dayId, to, actor === 'system' ? 'system' : actor.staffId],
        );
        await this.historyInTx(tx, 'fulfillment_day', dayId, day.status, to, actor === 'system' ? null : actor.staffId, null);
      },
    }, client);
  }

  async fulfillmentDaysForKitchen(date: string): Promise<FulfillmentDayForKitchen[]> {
    const { rows } = await this.pool.query(
      `SELECT fd.id, fd.order_id, fd.date, fd.status, co.customer_id
       FROM fulfillment_day fd JOIN customer_order co ON co.id = fd.order_id
       WHERE fd.date = $1 AND fd.status NOT IN ('cancelled_day','skipped')
       ORDER BY fd.date, co.order_number`,
      [date],
    );
    return rows.map((r) => ({
      id: r.id as string,
      orderId: r.order_id as string,
      date: this.dateString(r.date),
      status: r.status as FulfillmentStatus,
      customerId: r.customer_id as string,
    }));
  }

  async dayForKitchen(dayId: string): Promise<FulfillmentDayForKitchen> {
    const { rows } = await this.pool.query(
      `SELECT fd.id, fd.order_id, fd.date, fd.status, co.customer_id
       FROM fulfillment_day fd JOIN customer_order co ON co.id = fd.order_id
       WHERE fd.id = $1`,
      [dayId],
    );
    if (rows.length === 0) throw new OrderError('not_found');
    return {
      id: rows[0].id as string,
      orderId: rows[0].order_id as string,
      date: this.dateString(rows[0].date),
      status: rows[0].status as FulfillmentStatus,
      customerId: rows[0].customer_id as string,
    };
  }

  /** In-transaction day read for M08; lock=true serializes per-day kitchen activity
   *  (rollup decisions must see the in-tx state, not a stale pool read). */
  async dayForKitchenInTx(client: PoolClient, dayId: string, lock = false): Promise<FulfillmentDayForKitchen> {
    const { rows } = await client.query(
      `SELECT fd.id, fd.order_id, fd.date, fd.status, co.customer_id
       FROM fulfillment_day fd JOIN customer_order co ON co.id = fd.order_id
       WHERE fd.id = $1${lock ? ' FOR UPDATE OF fd' : ''}`,
      [dayId],
    );
    if (rows.length === 0) throw new OrderError('not_found');
    return {
      id: rows[0].id as string,
      orderId: rows[0].order_id as string,
      date: this.dateString(rows[0].date),
      status: rows[0].status as FulfillmentStatus,
      customerId: rows[0].customer_id as string,
    };
  }

  async orderItemsForKitchen(dayId: string): Promise<OrderItemForKitchen[]> {
    const { rows } = await this.pool.query(
      `SELECT oi.id, oi.product_id, oi.name_frozen_en, oi.name_frozen_ar, oi.qty, oi.allergens_frozen
       FROM fulfillment_day fd
       JOIN order_item oi ON oi.order_id = fd.order_id
       WHERE fd.id = $1
       ORDER BY oi.created_at, oi.id`,
      [dayId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      productId: r.product_id as string | null,
      nameEn: r.name_frozen_en as string,
      nameAr: r.name_frozen_ar as string | null,
      qty: Number(r.qty),
      allergensFrozen: (r.allergens_frozen as Array<Record<string, unknown>> | null) ?? [],
    }));
  }

  async orderForPayment(orderId: string): Promise<OrderForPayment> {
    const { rows } = await this.pool.query(
      `SELECT id, status, customer_id, total, currency, source_draft_id
       FROM customer_order WHERE id = $1`,
      [orderId],
    );
    if (rows.length === 0) throw new OrderError('not_found');
    // draft data via the M01 owning-module API, not a cross-module join (ADR-010)
    let expectedPaymentMethod: string | null = null;
    if (rows[0].source_draft_id) {
      expectedPaymentMethod = (await this.drafts.getDraft(rows[0].source_draft_id as string)).expected_payment_method;
    }
    return {
      id: rows[0].id as string,
      status: rows[0].status as OrderStatus,
      customerId: rows[0].customer_id as string,
      total: Number(rows[0].total),
      currency: rows[0].currency as string,
      expectedPaymentMethod,
    };
  }

  async findByOrderNumberInTx(client: PoolClient, orderNumber: string): Promise<string | null> {
    const { rows } = await client.query(`SELECT id FROM customer_order WHERE order_number = $1`, [orderNumber]);
    return rows.length > 0 ? rows[0].id as string : null;
  }

  async createImportedActivePlanInTx(
    client: PoolClient,
    actorId: string,
    input: ImportedActivePlanInput,
  ): Promise<{ id: string; dayCount: number }> {
    const status = input.status ?? 'active';
    if (!['approved', 'active', 'paused', 'completed', 'expired', 'cancelled', 'rejected'].includes(status)) {
      throw new OrderError('validation_failed', { field: 'status' });
    }
    const existing = await this.findByOrderNumberInTx(client, input.orderNumber);
    if (existing) return { id: existing, dayCount: 0 };
    const id = newId();
    const addressFrozen = input.addressFrozen ?? { legacy_import: true, address_unverified: true };
    await client.query(
      `INSERT INTO customer_order
        (id, order_number, customer_id, package_id, package_name_frozen_en, package_name_frozen_ar,
         status, start_date, end_date, off_days, off_days_unverified, channel, package_amount,
         discount, total, currency, origin, import_batch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$13,$14,'legacy',$15,$16)`,
      [
        id, input.orderNumber, input.customerId, input.packageId ?? null,
        input.packageNameEn ?? null, input.packageNameAr ?? null, status,
        input.startDate, input.endDate, JSON.stringify(input.offDays ?? []),
        input.offDaysUnverified ?? false, input.channel ?? 'legacy',
        input.total ?? 0, input.currency ?? 'SAR', input.importBatchId, actorId,
      ],
    );
    let dayCount = 0;
    for (const date of this.dateRange(input.startDate, input.endDate)) {
      await client.query(
        `INSERT INTO fulfillment_day (id, order_id, date, slot_id, address_frozen, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(), id, date, input.slotId ?? null, JSON.stringify(addressFrozen), actorId],
      );
      dayCount += 1;
    }
    return { id, dayCount };
  }

  async rollbackImportedBatchInTx(client: PoolClient, batchId: string): Promise<string[]> {
    const { rows } = await client.query(
      `SELECT id FROM customer_order WHERE import_batch_id = $1 FOR UPDATE`,
      [batchId],
    );
    const orderIds = rows.map((r) => r.id as string);
    if (orderIds.length === 0) return [];
    await client.query(`DELETE FROM fulfillment_day WHERE order_id = ANY($1)`, [orderIds]);
    await client.query(`DELETE FROM customer_order WHERE id = ANY($1)`, [orderIds]);
    return orderIds;
  }

  async createChangeRequest(actor: StaffContext, orderId: string, diff: Record<string, unknown>): Promise<string> {
    const order = await this.getOrder(orderId);
    if (!['approved', 'active'].includes(order.status)) throw new OrderError('validation_failed', { state: order.status });
    this.validateChangeDiff(diff);
    const impact = await this.impact(orderId, diff);
    const id = newId();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO change_request (id, order_id, diff, impact, requested_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, orderId, JSON.stringify(diff), JSON.stringify(impact), actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'order.change_requested',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'change_request',
        entityId: id,
        severity: 'info',
        relatedRefs: { order_id: orderId },
        after: { diff, impact },
      });
    });
    return id;
  }

  async decideChangeRequest(actor: StaffContext, changeRequestId: string, approve: boolean): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT * FROM change_request WHERE id = $1 FOR UPDATE`, [changeRequestId]);
      if (rows.length === 0) throw new OrderError('not_found');
      if (rows[0].state !== 'pending') throw new OrderError('validation_failed', { state: rows[0].state });
      if (!approve) {
        await client.query(
          `UPDATE change_request SET state = 'rejected', decided_by = $2, decided_at = now(),
           updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
          [changeRequestId, actor.staffId],
        );
        await this.audit.writeInTx(client, {
          eventType: 'order.change_rejected',
          actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
          entityType: 'change_request',
          entityId: changeRequestId,
          severity: 'info',
          relatedRefs: { order_id: rows[0].order_id as string },
          before: { state: 'pending' },
          after: { state: 'rejected' },
        });
        return;
      }
      const diff = rows[0].diff as Record<string, unknown>;
      await this.applyChangeInTx(client, actor, rows[0].order_id as string, diff);
      await client.query(
        `UPDATE change_request SET state = 'applied', decided_by = $2, decided_at = now(),
         updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
        [changeRequestId, actor.staffId],
      );
      await this.outbox.writeInTx(client, {
        eventType: 'order.change_applied',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { order_id: rows[0].order_id as string },
        payload: { change_request_id: changeRequestId, diff, impact: rows[0].impact },
      });
    });
  }

  // WP-UI-03c exceptions view (read path; create/resolve already exist). Resolves the
  // type/resolution reason_code rows to their codes and lifts order_id out of refs for
  // the list. `notes` is PII-masked at the controller per the caller's grants.
  async listExceptions(filter: { state?: string } = {}): Promise<ExceptionRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (filter.state) {
      params.push(filter.state);
      where = `WHERE ec.state = $${params.length}`;
    }
    const { rows } = await this.pool.query(
      `SELECT ec.id, tc.code AS type_code, ec.refs, ec.severity, ec.state, ec.owner_id,
              rc.code AS resolution_code, ec.notes, ec.created_at, ec.updated_at
         FROM exception_case ec
         JOIN reason_code tc ON tc.id = ec.type_code_id
         LEFT JOIN reason_code rc ON rc.id = ec.resolution_code_id
         ${where}
        ORDER BY ec.created_at DESC
        LIMIT 100`,
      params,
    );
    return rows.map((r) => {
      const refs = (r.refs ?? {}) as Record<string, string>;
      return {
        id: r.id as string,
        type_code: r.type_code as string,
        order_id: refs.order_id ?? null,
        refs,
        severity: r.severity as ExceptionRow['severity'],
        state: r.state as ExceptionRow['state'],
        owner_id: (r.owner_id as string | null) ?? null,
        resolution_code: (r.resolution_code as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        created_at: r.created_at as string,
        updated_at: (r.updated_at as string | null) ?? null,
      };
    });
  }

  async createException(actor: StaffContext, input: { typeCode?: string; refs: Record<string, string>; severity?: 'info' | 'warn' | 'high'; notes?: string }): Promise<string> {
    const requestedCode = input.typeCode ?? 'other';
    const reasonCode = requestedCode === 'allergy_incident' ? 'other' : requestedCode;
    const typeId = await this.reasonCodeId('escalation', reasonCode);
    const severity = requestedCode === 'allergy_incident' ? 'high' : (input.severity ?? 'warn');
    const id = newId();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO exception_case (id, type_code_id, refs, severity, owner_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$5)`,
        [id, typeId, JSON.stringify(input.refs), severity, actor.staffId, input.notes ?? null],
      );
      await this.audit.writeInTx(client, {
        eventType: 'order.exception_created',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'exception_case',
        entityId: id,
        severity,
        relatedRefs: input.refs,
        after: { type_code: requestedCode, reason_code: reasonCode },
      });
    });
    return id;
  }

  async resolveException(actor: StaffContext, exceptionId: string, input: { resolutionCode?: string; notes?: string }): Promise<void> {
    const code = input.resolutionCode ?? 'other';
    const resolutionId = await this.reasonCodeId('escalation', code);
    await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT state, refs FROM exception_case WHERE id = $1 FOR UPDATE`, [exceptionId]);
      if (rows.length === 0) throw new OrderError('not_found');
      if (rows[0].state === 'resolved') throw new OrderError('validation_failed', { state: rows[0].state });
      await client.query(
        `UPDATE exception_case SET state = 'resolved', resolution_code_id = $2, notes = COALESCE($3, notes),
         updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1`,
        [exceptionId, resolutionId, input.notes ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'order.exception_resolved',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'exception_case',
        entityId: exceptionId,
        severity: 'info',
        relatedRefs: rows[0].refs as Record<string, string>,
        after: { resolution_code: code, state: 'resolved' },
      });
    });
  }

  private async findByDraft(draftId: string): Promise<string | null> {
    const { rows } = await this.pool.query(`SELECT id FROM customer_order WHERE source_draft_id = $1`, [draftId]);
    return rows.length > 0 ? rows[0].id as string : null;
  }

  private async insertOrderItemsInTx(client: PoolClient, actor: StaffContext, orderId: string, draft: DraftRecord, pkg: PackageForOrder | null): Promise<void> {
    if (draft.items.length === 0 && pkg) {
      await client.query(
        `INSERT INTO order_item (id, order_id, name_frozen_en, name_frozen_ar, qty, unit_price_frozen, created_by)
         VALUES ($1,$2,$3,$4,1,$5,$6)`,
        [newId(), orderId, pkg.nameEn, pkg.nameAr, pkg.price ?? 0, actor.staffId],
      );
      return;
    }
    for (const item of draft.items) {
      const product = await this.catalog.productForOrder(item.product_id);
      if (!product) throw new OrderError('not_found', { product_id: item.product_id });
      const allergens = await this.catalog.resolveAllergens(item.product_id);
      await client.query(
        `INSERT INTO order_item
          (id, order_id, product_id, name_frozen_en, name_frozen_ar, qty, unit_price_frozen, allergens_frozen, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId(), orderId, product.id, product.nameEn, product.nameAr, item.qty, product.price ?? 0, JSON.stringify(allergens), actor.staffId],
      );
    }
  }

  private async generateDaysInTx(
    client: PoolClient,
    actorId: string,
    orderId: string,
    startDate: string,
    endDate: string,
    slotId: string | null,
    addressFrozen: Record<string, unknown>,
  ): Promise<number> {
    let count = 0;
    for (const date of this.dateRange(startDate, endDate)) {
      const id = newId();
      await client.query(
        `INSERT INTO fulfillment_day (id, order_id, date, slot_id, address_frozen, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, orderId, date, slotId, JSON.stringify(addressFrozen), actorId],
      );
      await this.historyInTx(client, 'fulfillment_day', id, null, 'scheduled', actorId, null);
      await this.outbox.writeInTx(client, {
        eventType: 'fulfillment.created',
        actor: { system: 'order-factory' },
        refs: { order_id: orderId, fulfillment_day_id: id },
        payload: { order_ref: orderId, date, slot: slotId },
      });
      count += 1;
    }
    return count;
  }

  private async addressFrozen(draft: DraftRecord): Promise<Record<string, unknown>> {
    if (draft.address_inline) return draft.address_inline as Record<string, unknown>;
    if (!draft.address_id) throw new OrderError('validation_failed', { field: 'address' });
    const address = await this.customers.getAddressSnapshot(draft.address_id, draft.customer_id ?? undefined);
    if (!address?.active) throw new OrderError('validation_failed', { field: 'address' });
    return {
      address_id: address.id,
      area_id: address.areaId,
      address_text: address.addressText,
      delivery_notes: address.deliveryNotes,
    };
  }

  private endDate(startDate: string, explicitEnd: string | null, pkg: PackageForOrder | null): string {
    if (explicitEnd) return explicitEnd;
    const days = Math.max(1, pkg?.durationDays ?? 1);
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days - 1);
    return d.toISOString().slice(0, 10);
  }

  private dateRange(start: string, end: string): string[] {
    const out: string[] = [];
    const d = new Date(`${start}T00:00:00Z`);
    const stop = new Date(`${end}T00:00:00Z`);
    while (d <= stop) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
      if (out.length > 370) throw new OrderError('validation_failed', { field: 'date_range' });
    }
    return out;
  }

  private async nextOrderNumber(): Promise<string> {
    const prefix = await this.settings.get<string>('order_number_prefix', 'N-');
    return `${prefix}${newId().slice(-10).toUpperCase()}`;
  }

  private async loadOrderInTx(client: PoolClient, orderId: string, lock: boolean) {
    const { rows } = await client.query(`SELECT * FROM customer_order WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [orderId]);
    if (rows.length === 0) throw new OrderError('not_found');
    return rows[0] as { id: string; status: OrderStatus; customer_id: string };
  }

  private async loadDayInTx(client: PoolClient, dayId: string, lock: boolean) {
    const { rows } = await client.query(`SELECT * FROM fulfillment_day WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [dayId]);
    if (rows.length === 0) throw new OrderError('not_found');
    return rows[0] as { id: string; order_id: string; status: FulfillmentStatus };
  }

  private async historyInTx(
    client: PoolClient,
    subject: 'order' | 'fulfillment_day',
    subjectRef: string,
    from: string | null,
    to: string,
    actorId: string | null,
    reasonCodeId: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO order_status_history (id, subject, subject_ref, from_status, to_status, actor_id, reason_code_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newId(), subject, subjectRef, from, to, actorId, reasonCodeId],
    );
  }

  private async cancelOpenDaysInTx(client: PoolClient, actorId: string | null, orderId: string, reasonCode?: string): Promise<void> {
    const reasonId = reasonCode ? await this.reasonCodeId('day_cancel', reasonCode) : null;
    const { rows } = await client.query(
      `SELECT id, status FROM fulfillment_day
       WHERE order_id = $1 AND status NOT IN ('delivered','skipped','cancelled_day') FOR UPDATE`,
      [orderId],
    );
    for (const row of rows) {
      await client.query(`UPDATE fulfillment_day SET status = 'cancelled_day', updated_at = now(), updated_by = $2 WHERE id = $1`, [row.id, actorId]);
      await this.historyInTx(client, 'fulfillment_day', row.id as string, row.status as string, 'cancelled_day', actorId, reasonId);
    }
  }

  private async assertAllDaysTerminal(orderId: string): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM fulfillment_day WHERE order_id = $1
       AND status NOT IN ('delivered','skipped','cancelled_day') LIMIT 1`,
      [orderId],
    );
    if (rows.length > 0) throw new OrderError('validation_failed', { field: 'fulfillment_day' });
  }

  private async impact(orderId: string, diff: Record<string, unknown>): Promise<Record<string, unknown>> {
    const days = await this.listDays(orderId);
    return {
      days_current: days.length,
      requested_end_date: diff.end_date ?? null,
      price_delta: 0,
      same_day_ack_required: days.some((d) => d.date <= new Date().toISOString().slice(0, 10)),
    };
  }

  private validateChangeDiff(diff: Record<string, unknown>): void {
    const keys = Object.keys(diff);
    if (keys.length === 0) throw new OrderError('validation_failed', { field: 'diff' });
    if (keys.some((k) => k !== 'end_date')) throw new OrderError('validation_failed', { field: 'diff.unsupported' });
    if (typeof diff.end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(diff.end_date)) {
      throw new OrderError('validation_failed', { field: 'end_date' });
    }
  }

  private async applyChangeInTx(client: PoolClient, actor: StaffContext, orderId: string, diff: Record<string, unknown>): Promise<void> {
    this.validateChangeDiff(diff);
    if (typeof diff.end_date === 'string') {
      const order = await this.loadOrderInTx(client, orderId, true) as { id: string; status: OrderStatus; customer_id: string; end_date?: string; start_date?: string };
      const current = await client.query(`SELECT start_date, end_date FROM customer_order WHERE id = $1`, [orderId]);
      const start = this.dateString(current.rows[0].start_date);
      const oldEnd = this.dateString(current.rows[0].end_date);
      await client.query(`UPDATE customer_order SET end_date = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [orderId, diff.end_date, actor.staffId]);
      if (diff.end_date > oldEnd) {
        const address = await client.query(`SELECT address_frozen, slot_id FROM fulfillment_day WHERE order_id = $1 ORDER BY date DESC LIMIT 1`, [orderId]);
        const next = new Date(`${oldEnd}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        await this.generateDaysInTx(client, actor.staffId, orderId, next.toISOString().slice(0, 10), diff.end_date, address.rows[0]?.slot_id ?? null, address.rows[0]?.address_frozen ?? {});
      } else if (diff.end_date < oldEnd) {
        // Days already in kitchen production (status model: cancel after KITCHEN_QUEUED
        // needs an explicit OM per-day decision + reason) must not be silently orphaned
        // or auto-cancelled by an end-date reduction — reject and require per-day
        // cancellation through the fulfillment transition API first.
        const active = await client.query(
          `SELECT id, status FROM fulfillment_day
           WHERE order_id = $1 AND date > $2
             AND status NOT IN ('scheduled','cancelled_day','skipped','delivered')`,
          [orderId, diff.end_date],
        );
        if (active.rows.length > 0) {
          throw new OrderError('validation_failed', {
            field: 'end_date',
            rule: 'kitchen_activity_beyond_new_end',
            days: active.rows.map((r) => ({ id: r.id as string, status: r.status as string })),
          });
        }
        const { rows } = await client.query(
          `SELECT id, status FROM fulfillment_day WHERE order_id = $1 AND date > $2 AND status = 'scheduled' FOR UPDATE`,
          [orderId, diff.end_date],
        );
        for (const row of rows) {
          await client.query(`UPDATE fulfillment_day SET status = 'cancelled_day', updated_at = now(), updated_by = $2 WHERE id = $1`, [row.id, actor.staffId]);
          await this.historyInTx(client, 'fulfillment_day', row.id as string, row.status as string, 'cancelled_day', actor.staffId, null);
        }
      }
      await this.historyInTx(client, 'order', orderId, order.status, order.status, actor.staffId, null);
      if (!start) throw new OrderError('validation_failed', { field: 'start_date' });
    }
    await this.audit.writeInTx(client, {
      eventType: 'order.change_applied',
      actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      entityType: 'customer_order',
      entityId: orderId,
      severity: 'warn',
      after: diff,
    });
  }

  private async reasonCodeId(domain: string, code: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT id FROM reason_code WHERE domain = $1 AND code = $2 AND active`,
      [domain, code],
    );
    if (rows.length === 0) throw new OrderError('validation_failed', { field: 'reason_code' });
    return rows[0].id as string;
  }

  private toOrder(row: Record<string, unknown>): OrderRecord {
    return {
      id: row.id as string,
      order_number: row.order_number as string,
      customer_id: row.customer_id as string,
      status: row.status as OrderStatus,
      start_date: this.dateString(row.start_date),
      end_date: this.dateString(row.end_date),
      source_draft_id: row.source_draft_id as string | null,
      total: Number(row.total),
    };
  }

  private dateString(value: unknown): string {
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
  }
}
