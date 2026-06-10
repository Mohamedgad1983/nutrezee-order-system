import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { TransitionEngine, TransitionError } from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import type { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import type { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import type { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { PaymentError, PaymentService } from '../../apps/api/src/modules/m07-payments/payment.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let payments: PaymentService;
let orderId: string;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-pay-u', name: 'Pay Agent', email: 'pay-agent@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const finance: StaffContext = {
  staffId: 'finance-pay-u', name: 'Finance Pay', email: 'finance@t', locale: 'en', roles: ['finance'], sessionId: 's-finance',
};

beforeAll(async () => {
  pool = await freshDb();
  const settings = new SettingsReader(pool, 0);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  const orders = new OrderService(
    pool, audit, outbox, settings, engine,
    {} as DraftService, {} as ReviewService, {} as CustomerService, {} as CatalogService,
  );
  payments = new PaymentService(pool, audit, outbox, engine, orders);
  orderId = await seedOrder('N-PAY-U-1', 13500);
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedOrder(orderNumber: string, total: number): Promise<string> {
  const customerId = newId();
  const id = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Pay Customer','test')`, [customerId]);
  await pool.query(
    `INSERT INTO customer_order
      (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by)
     VALUES ($1,$2,$3,'approved','2099-02-01','2099-02-03','phone',$4,'test')`,
    [id, orderNumber, customerId, total],
  );
  return id;
}

describe('TS-U unit — payment-lite service (WP-11)', () => {
  it('records a manual payment link through the payment transition machine and keeps the call idempotent', async () => {
    const payment = await payments.recordLinkSent(agent, orderId, { linkRef: 'pay-link-001', method: 'online_link' });
    const replay = await payments.recordLinkSent(agent, orderId, { linkRef: 'pay-link-001', method: 'online_link' });

    expect(payment).toMatchObject({ order_id: orderId, status: 'link_sent', link_ref: 'pay-link-001', method: 'online_link', masked: false });
    expect(replay).toMatchObject({ id: payment.id, status: 'link_sent' });

    const audits = await pool.query(
      `SELECT event_type, severity FROM audit_event
       WHERE entity_id = $1 AND event_type IN ('payment.record_created','payment.status_changed')
       ORDER BY occurred_at`,
      [payment.id],
    );
    expect(audits.rows.map((r) => r.event_type)).toEqual(['payment.record_created', 'payment.status_changed']);
    expect(audits.rows.every((r) => r.severity === 'high')).toBe(true);
  });

  it('queues a finance review request and finance approval confirms paid', async () => {
    const review = await payments.requestStatusChange(agent, orderId, {
      requestedStatus: 'paid',
      evidenceNote: 'Customer sent bank receipt',
    });
    expect((await payments.listReviewQueue()).map((i) => i.id)).toContain(review.id);

    await payments.decideReview(finance, review.id, {
      decision: 'approve',
      evidenceNote: 'Receipt matched bank',
      transactionRef: 'BANK-42',
    });

    const state = await payments.paymentForOrder(orderId, true);
    expect(state).toMatchObject({ status: 'paid', transaction_ref: 'BANK-42', evidence_note: 'Receipt matched bank' });
    const item = await pool.query(`SELECT state, decision, decided_by FROM payment_review_item WHERE id = $1`, [review.id]);
    expect(item.rows[0]).toMatchObject({ state: 'decided', decision: 'approve', decided_by: finance.staffId });
  });

  it('keeps paid decisions FI-only through transition_config', async () => {
    const anotherOrder = await seedOrder('N-PAY-U-2', 9900);
    await payments.recordLinkSent(agent, anotherOrder, { linkRef: 'pay-link-002', method: 'online_link' });
    const review = await payments.requestStatusChange(agent, anotherOrder, { requestedStatus: 'paid', evidenceNote: 'Agent saw receipt' });

    await expect(payments.decideReview(agent, review.id, { decision: 'approve' }))
      .rejects.toBeInstanceOf(TransitionError);
  });

  it('requires a reason when approving failed payment transitions', async () => {
    const failedOrder = await seedOrder('N-PAY-U-3', 4400);
    await payments.recordLinkSent(agent, failedOrder, { linkRef: 'pay-link-003', method: 'online_link' });
    const review = await payments.requestStatusChange(agent, failedOrder, { requestedStatus: 'failed', evidenceNote: 'Gateway declined' });

    await expect(payments.decideReview(finance, review.id, { decision: 'approve' }))
      .rejects.toBeInstanceOf(TransitionError);
    await payments.decideReview(finance, review.id, { decision: 'approve', reasonCode: 'other', note: 'Gateway declined' });
    expect(await payments.paymentForOrder(failedOrder, true)).toMatchObject({ status: 'failed' });
  });

  it('leaves refund workflows behind not_enabled stubs', async () => {
    await expect(payments.requestRefund()).rejects.toMatchObject({ code: 'not_enabled' } satisfies Partial<PaymentError>);
    await expect(payments.decideRefund()).rejects.toMatchObject({ code: 'not_enabled' } satisfies Partial<PaymentError>);
  });
});
