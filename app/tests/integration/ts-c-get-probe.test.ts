import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { Request } from 'express';
import { freshDb } from '../helpers/db';
import { AuditService, AuditReadQueue } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { TransitionEngine } from '../../apps/api/src/platform/transition/transition-engine';
import { AccessService } from '../../apps/api/src/platform/rbac/access.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import { DraftController } from '../../apps/api/src/modules/m01-intake/draft.controller';
import { MessageRefService } from '../../apps/api/src/modules/m17-whatsapp/message-ref.service';
import { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import { ReviewController } from '../../apps/api/src/modules/m02-review/review.controller';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { OrderController } from '../../apps/api/src/modules/m03-orders/order.controller';
import { PaymentService } from '../../apps/api/src/modules/m07-payments/payment.service';
import { KitchenService } from '../../apps/api/src/modules/m08-kitchen/kitchen.service';
import { NotificationService } from '../../apps/api/src/modules/m11-notifications/notification.service';
import { ReconciliationService } from '../../apps/api/src/modules/m18-bridge/reconciliation.service';
import { newId } from '../../apps/api/src/platform/ids';

// TS-C — RUNTIME no-GET-mutation probe (test_strategy: "router-level static check
// + runtime probe"; only the static scan existed). Exercises read paths against a
// populated database and asserts business tables + outbox are byte-stable.
// Out of probe scope by design: audit_event / audit_read_queue (would-deny and
// sensitive-read logging are sanctioned read-path writes) and `session` (sliding
// idle expiry is platform session bookkeeping, not business state).
const BUSINESS_TABLES = [
  'outbox_event', 'draft_order', 'draft_item', 'whatsapp_message_ref',
  'review_queue_item', 'review_decision', 'customer_order', 'order_item',
  'fulfillment_day', 'order_status_history', 'change_request', 'exception_case',
  'payment_record', 'payment_review_item', 'kitchen_ticket', 'ticket_status_event',
  'escalation', 'notification_log', 'reconciliation_run', 'customer',
  'customer_phone', 'address', 'import_batch', 'import_row_result', 'sync_record',
];

let pool: Pool;
let drafts: DraftService;
let review: ReviewService;
let orders: OrderService;
let payments: PaymentService;
let kitchen: KitchenService;
let notifications: NotificationService;
let reconciliation: ReconciliationService;
let draftController: DraftController;
let reviewController: ReviewController;
let orderController: OrderController;
let draftId: string;
let orderId: string;
let dayDate: string;

const audit = new AuditService();
const outbox = new OutboxService();
const ops: StaffContext = {
  staffId: 'ops-p', name: 'Ops P', email: 'ops-p@t', locale: 'en', roles: ['ops_manager'], sessionId: 'sid-ops-p',
};
const agent: StaffContext = {
  staffId: 'agent-p', name: 'Agent P', email: 'agent-p@t', locale: 'en', roles: ['order_agent'], sessionId: 'sid-agent-p',
};
const sessions = {
  validate: async (sid: string) => (sid === 'sid-ops-p' ? ops : agent),
} as unknown as SessionService;
const req = { cookies: { nz_session: 'sid-ops-p' } } as unknown as Request;

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of BUSINESS_TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    out[table] = rows[0].n as number;
  }
  return out;
}

beforeAll(async () => {
  pool = await freshDb();
  const settings = new SettingsReader(pool, 0);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  const access = new AccessService(pool, audit, settings, 0);
  const customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), outbox, settings);
  const catalog = new CatalogService(pool, audit, settings);
  drafts = new DraftService(
    pool, audit, outbox, settings, new IdempotencyService(), engine,
    customers, catalog, new MessageRefService(),
  );
  review = new ReviewService(pool, audit, outbox, settings, drafts);
  orders = new OrderService(pool, audit, outbox, settings, engine, drafts, review, customers, catalog);
  payments = new PaymentService(pool, audit, outbox, engine, orders);
  kitchen = new KitchenService(pool, audit, outbox, engine, orders, catalog, customers);
  notifications = new NotificationService(pool, audit, outbox, settings);
  reconciliation = new ReconciliationService(pool, audit, outbox);
  draftController = new DraftController(sessions, access, drafts);
  reviewController = new ReviewController(sessions, access, review);
  orderController = new OrderController(sessions, access, orders);

  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Ops P','ops-p@t','en'), ($2,'Agent P','agent-p@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [ops.staffId, agent.staffId],
  );
  const areaId = newId();
  const slotId = newId();
  const methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-p','Area P','Area P')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',30)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);

  // populate one full slice: draft -> approval -> order -> tickets -> payment -> recon
  const customerId = await customers.createGuided(agent, { fullNameEn: 'Probe Customer', phone: '0557001001' });
  const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Probe Block' });
  const productId = await catalog.createProduct(agent, { nameEn: 'Probe Meal', nameAr: 'Probe Meal', price: 900 }, 'import');
  await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productId, sectionId: 'seed-section-hot' });
  const created = await drafts.createDraft(agent, {
    channel: 'phone', customerId, startDate: tomorrow(), addressId, slotId, methodId,
    expectedPaymentMethod: 'cash', items: [{ productId }],
  });
  draftId = created.id;
  await drafts.submitDraft(agent, draftId);
  await review.syncSubmittedDrafts(ops);
  await review.decide(ops, draftId, { decision: 'approve' });
  orderId = (await orders.createFromApprovedDraft(ops, draftId)).id;
  const day = (await orders.listDays(orderId))[0];
  dayDate = day.date;
  await kitchen.generateTickets('system', dayDate, 'probe-batch');
  await payments.recordLinkSent(agent, orderId, { linkRef: 'probe-link', method: 'online_link' });
  await reconciliation.record(ops, { runType: 'daily_orders', counts: { legacy: 1, new: 1 } });
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-C contract — runtime GET-mutation probe (review fix)', () => {
  it('leaves every business table and the outbox unchanged across all read surfaces', async () => {
    const before = await snapshot();

    // controller GET surfaces
    await draftController.list(req);
    await draftController.incomplete(req);
    await draftController.get(req, draftId);
    await orderController.list(req);
    await orderController.get(req, orderId);
    await orderController.listDays(req, orderId);
    await reviewController.list(req);
    // service read surfaces backing the remaining GET routes
    await payments.paymentForOrder(orderId, true);
    await payments.listReviewQueue();
    await kitchen.board({ date: dayDate });
    await notifications.logs();
    await notifications.listTemplates();
    await reconciliation.list();
    await orders.fulfillmentDaysForKitchen(dayDate);
    await orders.dayForKitchen((await orders.listDays(orderId))[0].id);

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
