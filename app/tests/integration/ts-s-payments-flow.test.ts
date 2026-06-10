import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { TransitionEngine } from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import type { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import type { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import type { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { PaymentService } from '../../apps/api/src/modules/m07-payments/payment.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let payments: PaymentService;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-pay-s', name: 'Pay Scenario Agent', email: 'pay-s-agent@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const finance: StaffContext = {
  staffId: 'finance-pay-s', name: 'Pay Scenario Finance', email: 'pay-s-finance@t', locale: 'en', roles: ['finance'], sessionId: 's-finance',
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
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedOrder(orderNumber: string): Promise<string> {
  const customerId = newId();
  const id = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Scenario Payment','test')`, [customerId]);
  await pool.query(
    `INSERT INTO customer_order
      (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by)
     VALUES ($1,$2,$3,'approved','2099-04-01','2099-04-02','phone',2500,'test')`,
    [id, orderNumber, customerId],
  );
  return id;
}

describe('TS-S scenario — WP-11 payment-lite flow', () => {
  it('records link_sent, queues finance confirmation, confirms paid, and keeps unmapped legacy status reviewable', async () => {
    const orderId = await seedOrder('N-S-PAY-1');
    const payment = await payments.recordLinkSent(agent, orderId, { linkRef: 'manual-link-1', method: 'online_link' });
    expect(payment.status).toBe('link_sent');

    const review = await payments.requestStatusChange(agent, orderId, {
      requestedStatus: 'paid',
      evidenceNote: 'WhatsApp receipt screenshot noted by agent',
    });
    await payments.decideReview(finance, review.id, {
      decision: 'approve',
      evidenceNote: 'Finance matched receipt',
      transactionRef: 'FIN-RECON-1',
    });

    expect(await payments.paymentForOrder(orderId, true)).toMatchObject({
      status: 'paid',
      transaction_ref: 'FIN-RECON-1',
      masked: false,
    });

    const paymentAudit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_event
       WHERE event_type = 'payment.status_changed' AND entity_id = $1 AND severity = 'high'`,
      [payment.id],
    );
    expect(paymentAudit.rows[0].n).toBe(2);

    const legacyOrder = await seedOrder('N-S-PAY-2');
    const unmapped = await payments.queueUnmappedLegacyStatus('system', legacyOrder, 'legacy_gateway_pending', 'Legacy export value unknown');
    const queue = await payments.listReviewQueue('waiting');
    expect(queue.find((item) => item.id === unmapped.id)).toMatchObject({
      requested_status: 'legacy_unmapped:legacy_gateway_pending',
      evidence_note: 'Legacy export value unknown',
    });
  });
});
