import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { TransitionEngine } from '../../platform/transition/transition-engine';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { OrderService, type OrderForPayment } from '../m03-orders/order.service';

export type PaymentStatus =
  | 'unpaid'
  | 'link_sent'
  | 'paid'
  | 'failed'
  | 'cod_pending'
  | 'collected'
  | 'refund_requested'
  | 'refunded';

export class PaymentError extends Error {
  constructor(
    readonly code:
      | 'validation_failed'
      | 'not_found'
      | 'not_enabled',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface PaymentState {
  id: string;
  order_id: string;
  status: PaymentStatus;
  masked: boolean;
  method?: string | null;
  amount?: number;
  currency?: string;
  transaction_ref?: string | null;
  link_ref?: string | null;
  evidence_note?: string | null;
}

export interface PaymentReviewItem {
  id: string;
  payment_id: string;
  order_id: string;
  requested_status: string;
  state: 'waiting' | 'in_review' | 'decided';
  evidence_note: string | null;
  created_at: string;
}

interface PaymentRow {
  id: string;
  order_id: string;
  status: PaymentStatus;
  method: string | null;
  amount: string | number;
  currency: string;
  transaction_ref: string | null;
  link_ref: string | null;
  evidence_note: string | null;
}

const DIRECT_PAYMENT_STATUSES = new Set<PaymentStatus>([
  'link_sent', 'paid', 'failed', 'cod_pending', 'collected',
]);

export class PaymentService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly transitions: TransitionEngine,
    private readonly orders: OrderService,
  ) {}

  async paymentForOrder(orderId: string, exposeSensitive: boolean): Promise<PaymentState | null> {
    await this.orders.orderForPayment(orderId);
    const { rows } = await this.pool.query(`SELECT * FROM payment_record WHERE order_id = $1`, [orderId]);
    if (rows.length === 0) return null;
    return this.toPaymentState(rows[0] as PaymentRow, exposeSensitive);
  }

  async recordLinkSent(
    actor: StaffContext,
    orderId: string,
    input: { linkRef?: string; method?: string },
  ): Promise<PaymentState> {
    if (!input.linkRef?.trim()) throw new PaymentError('validation_failed', { field: 'link_ref' });
    const order = await this.assertPaymentEligibleOrder(orderId);
    this.assertMethod(input.method);
    return withTransaction(this.pool, async (client) => {
      const payment = await this.ensurePaymentInTx(client, actor, order, input.method ?? order.expectedPaymentMethod);
      if (payment.status === 'link_sent') {
        if (payment.link_ref === input.linkRef) return this.toPaymentState(payment, true);
        throw new PaymentError('validation_failed', { field: 'link_ref' });
      }
      if (payment.status !== 'unpaid') throw new PaymentError('validation_failed', { state: payment.status });
      await this.transitions.transitionInTx({
        machine: 'payment',
        subjectType: 'payment_record',
        subjectId: payment.id,
        from: payment.status,
        to: 'link_sent',
        actor,
        eventType: 'payment.status_changed',
        refs: { order_id: orderId, payment_id: payment.id, customer_id: order.customerId },
        severity: 'high',
        apply: async (tx) => {
          await tx.query(
            `UPDATE payment_record SET status = 'link_sent', link_ref = $2, method = COALESCE($3, method),
             updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1`,
            [payment.id, input.linkRef, input.method ?? null, actor.staffId],
          );
        },
      }, client);
      return this.loadPaymentInTx(client, payment.id, false).then((row) => this.toPaymentState(row, true));
    });
  }

  async requestStatusChange(
    actor: StaffContext,
    orderId: string,
    input: { requestedStatus?: string; evidenceNote?: string; method?: string },
  ): Promise<{ id: string; payment_id: string }> {
    const requested = this.parseRequestedStatus(input.requestedStatus);
    const order = await this.assertPaymentEligibleOrder(orderId);
    this.assertMethod(input.method);
    return withTransaction(this.pool, async (client) => {
      const payment = await this.ensurePaymentInTx(client, actor, order, input.method ?? order.expectedPaymentMethod);
      if (!await this.activeTransitionExists(payment.status, requested)) {
        throw new PaymentError('validation_failed', { from: payment.status, to: requested });
      }
      const id = newId();
      await client.query(
        `INSERT INTO payment_review_item (id, payment_id, requested_status, evidence_note, requested_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, payment.id, requested, input.evidenceNote ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'payment.review_requested',
        actor: this.auditActor(actor),
        entityType: 'payment_review_item',
        entityId: id,
        severity: 'high',
        relatedRefs: { payment_id: payment.id, order_id: orderId, customer_id: order.customerId },
        after: { requested_status: requested, evidence_note: input.evidenceNote ?? null },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'payment.review_requested',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { payment_id: payment.id, order_id: orderId },
        payload: { requested_status: requested },
      });
      return { id, payment_id: payment.id };
    });
  }

  async queueUnmappedLegacyStatus(
    actor: StaffContext | 'system',
    orderId: string,
    legacyStatus: string,
    evidenceNote?: string,
  ): Promise<{ id: string; payment_id: string }> {
    if (!legacyStatus.trim()) throw new PaymentError('validation_failed', { field: 'legacy_status' });
    const order = await this.assertPaymentEligibleOrder(orderId);
    return withTransaction(this.pool, async (client) => {
      const payment = await this.ensurePaymentInTx(client, actor, order, order.expectedPaymentMethod);
      const id = newId();
      await client.query(
        `INSERT INTO payment_review_item (id, payment_id, requested_status, evidence_note, requested_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, payment.id, `legacy_unmapped:${legacyStatus}`, evidenceNote ?? null, actor === 'system' ? 'system' : actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'payment.legacy_status_unmapped',
        actor: actor === 'system' ? 'system' : this.auditActor(actor),
        entityType: 'payment_review_item',
        entityId: id,
        severity: 'high',
        relatedRefs: { payment_id: payment.id, order_id: orderId, customer_id: order.customerId },
        after: { legacy_status: legacyStatus, evidence_note: evidenceNote ?? null },
      });
      return { id, payment_id: payment.id };
    });
  }

  async listReviewQueue(state: 'waiting' | 'in_review' | 'decided' = 'waiting'): Promise<PaymentReviewItem[]> {
    const { rows } = await this.pool.query(
      `SELECT pri.id, pri.payment_id, pr.order_id, pri.requested_status, pri.state, pri.evidence_note, pri.created_at
       FROM payment_review_item pri
       JOIN payment_record pr ON pr.id = pri.payment_id
       WHERE pri.state = $1
       ORDER BY pri.created_at, pri.id
       LIMIT 100`,
      [state],
    );
    return rows.map((r) => ({
      id: r.id as string,
      payment_id: r.payment_id as string,
      order_id: r.order_id as string,
      requested_status: r.requested_status as string,
      state: r.state as 'waiting' | 'in_review' | 'decided',
      evidence_note: r.evidence_note as string | null,
      created_at: new Date(r.created_at as Date).toISOString(),
    }));
  }

  async decideReview(
    actor: StaffContext,
    reviewId: string,
    input: { decision?: 'approve' | 'reject'; evidenceNote?: string; transactionRef?: string; reasonCode?: string; note?: string },
  ): Promise<void> {
    if (input.decision !== 'approve' && input.decision !== 'reject') {
      throw new PaymentError('validation_failed', { field: 'decision' });
    }
    await withTransaction(this.pool, async (client) => {
      const review = await this.loadReviewInTx(client, reviewId);
      if (review.state === 'decided') throw new PaymentError('validation_failed', { state: review.state });
      if (input.decision === 'reject') {
        await client.query(
          `UPDATE payment_review_item SET state = 'decided', decision = 'reject', decided_by = $2,
           decided_at = now(), updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
          [reviewId, actor.staffId],
        );
        await this.audit.writeInTx(client, {
          eventType: 'payment.review_rejected',
          actor: this.auditActor(actor),
          entityType: 'payment_review_item',
          entityId: reviewId,
          severity: 'high',
          relatedRefs: { payment_id: review.payment_id, order_id: review.order_id },
          after: { requested_status: review.requested_status, evidence_note: input.evidenceNote ?? null },
        });
        return;
      }
      const requested = this.parseRequestedStatus(review.requested_status);
      const payment = await this.loadPaymentInTx(client, review.payment_id, true);
      await this.transitions.transitionInTx({
        machine: 'payment',
        subjectType: 'payment_record',
        subjectId: payment.id,
        from: payment.status,
        to: requested,
        actor,
        reason: input.reasonCode ? { code: input.reasonCode, note: input.note } : undefined,
        eventType: 'payment.status_changed',
        refs: { payment_id: payment.id, order_id: payment.order_id },
        severity: 'high',
        apply: async (tx) => {
          await tx.query(
            `UPDATE payment_record SET status = $2, transaction_ref = COALESCE($3, transaction_ref),
             evidence_note = COALESCE($4, evidence_note), updated_at = now(), updated_by = $5,
             version = version + 1 WHERE id = $1`,
            [payment.id, requested, input.transactionRef ?? null, input.evidenceNote ?? review.evidence_note, actor.staffId],
          );
          await tx.query(
            `UPDATE payment_review_item SET state = 'decided', decision = 'approve', decided_by = $2,
             decided_at = now(), updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
            [reviewId, actor.staffId],
          );
        },
      }, client);
      await this.audit.writeInTx(client, {
        eventType: 'payment.review_approved',
        actor: this.auditActor(actor),
        entityType: 'payment_review_item',
        entityId: reviewId,
        severity: 'high',
        relatedRefs: { payment_id: payment.id, order_id: payment.order_id },
        after: { requested_status: requested, transaction_ref: input.transactionRef ?? null },
      });
    });
  }

  async requestRefund(): Promise<never> {
    throw new PaymentError('not_enabled', { feature: 'refunds_enabled' });
  }

  async decideRefund(): Promise<never> {
    throw new PaymentError('not_enabled', { feature: 'refunds_enabled' });
  }

  private async assertPaymentEligibleOrder(orderId: string): Promise<OrderForPayment> {
    const order = await this.orders.orderForPayment(orderId);
    if (order.status === 'cancelled' || order.status === 'rejected') {
      throw new PaymentError('validation_failed', { field: 'order_status', status: order.status });
    }
    return order;
  }

  private async ensurePaymentInTx(
    client: PoolClient,
    actor: StaffContext | 'system',
    order: OrderForPayment,
    method?: string | null,
  ): Promise<PaymentRow> {
    this.assertMethod(method ?? undefined);
    const existing = await client.query(`SELECT * FROM payment_record WHERE order_id = $1 FOR UPDATE`, [order.id]);
    if (existing.rows.length > 0) return existing.rows[0] as PaymentRow;
    const id = newId();
    await client.query(
      `INSERT INTO payment_record (id, order_id, method, amount, currency, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, order.id, method ?? null, order.total, order.currency, actor === 'system' ? 'system' : actor.staffId],
    );
    await this.audit.writeInTx(client, {
      eventType: 'payment.record_created',
      actor: actor === 'system' ? 'system' : this.auditActor(actor),
      entityType: 'payment_record',
      entityId: id,
      severity: 'high',
      relatedRefs: { order_id: order.id, customer_id: order.customerId },
      after: { status: 'unpaid', amount: order.total, currency: order.currency, method: method ?? null },
    });
    return this.loadPaymentInTx(client, id, true);
  }

  private async activeTransitionExists(from: PaymentStatus, to: PaymentStatus): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM transition_config
       WHERE machine = 'payment' AND from_status = $1 AND to_status = $2 AND active
       LIMIT 1`,
      [from, to],
    );
    return rows.length > 0;
  }

  private parseRequestedStatus(value?: string): PaymentStatus {
    if (!value || !DIRECT_PAYMENT_STATUSES.has(value as PaymentStatus)) {
      throw new PaymentError('validation_failed', { field: 'requested_status' });
    }
    return value as PaymentStatus;
  }

  private assertMethod(value?: string): void {
    if (value !== undefined && value !== null && value.trim().length === 0) {
      throw new PaymentError('validation_failed', { field: 'method' });
    }
  }

  private async loadPaymentInTx(client: PoolClient, paymentId: string, lock: boolean): Promise<PaymentRow> {
    const { rows } = await client.query(`SELECT * FROM payment_record WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [paymentId]);
    if (rows.length === 0) throw new PaymentError('not_found');
    return rows[0] as PaymentRow;
  }

  private async loadReviewInTx(client: PoolClient, reviewId: string): Promise<{
    id: string;
    payment_id: string;
    order_id: string;
    requested_status: string;
    state: string;
    evidence_note: string | null;
  }> {
    const { rows } = await client.query(
      `SELECT pri.*, pr.order_id
       FROM payment_review_item pri
       JOIN payment_record pr ON pr.id = pri.payment_id
       WHERE pri.id = $1 FOR UPDATE`,
      [reviewId],
    );
    if (rows.length === 0) throw new PaymentError('not_found');
    return rows[0] as {
      id: string;
      payment_id: string;
      order_id: string;
      requested_status: string;
      state: string;
      evidence_note: string | null;
    };
  }

  private toPaymentState(row: PaymentRow, exposeSensitive: boolean): PaymentState {
    if (!exposeSensitive) {
      return {
        id: row.id,
        order_id: row.order_id,
        status: row.status,
        masked: true,
      };
    }
    return {
      id: row.id,
      order_id: row.order_id,
      status: row.status,
      masked: false,
      method: row.method,
      amount: Number(row.amount),
      currency: row.currency,
      transaction_ref: row.transaction_ref,
      link_ref: row.link_ref,
      evidence_note: row.evidence_note,
    };
  }

  private auditActor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }
}
