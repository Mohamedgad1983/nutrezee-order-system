import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService, AuditReadQueue } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { TransitionEngine, TransitionError } from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import { MessageRefService } from '../../apps/api/src/modules/m17-whatsapp/message-ref.service';
import { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { KitchenService } from '../../apps/api/src/modules/m08-kitchen/kitchen.service';
import { NotificationService } from '../../apps/api/src/modules/m11-notifications/notification.service';
import { ReconciliationService } from '../../apps/api/src/modules/m18-bridge/reconciliation.service';
import { newId } from '../../apps/api/src/platform/ids';

// TS-S — scenarios #3 and #7 (test_strategy mandatory list; previously untested).
// #3 Same-day cancel after kitchen_queued: OM + reason through transition_config
//    (seed-tc-f7), kitchen-alertable outbox event emitted. NOTE: the same_day_ack
//    validator is registered as a no-op pending workshop semantics — logged as a
//    review finding; this scenario covers role/reason enforcement and the alert event.
// #7 Reconciliation divergence -> alert: divergent run -> WARN audit -> outbox ->
//    M11 routes the seeded reconciliation_divergent trigger. A "resolution note"
//    API does not exist yet (pre-pilot gap, logged).
let pool: Pool;
let customers: CustomerService;
let catalog: CatalogService;
let drafts: DraftService;
let review: ReviewService;
let orders: OrderService;
let kitchen: KitchenService;
let notifications: NotificationService;
let reconciliation: ReconciliationService;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-s3', name: 'Agent S3', email: 'agent-s3@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-s3', name: 'Ops S3', email: 'ops-s3@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
};

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  pool = await freshDb();
  const settings = new SettingsReader(pool, 0);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), outbox, settings);
  catalog = new CatalogService(pool, audit, settings);
  drafts = new DraftService(
    pool, audit, outbox, settings, new IdempotencyService(), engine,
    customers, catalog, new MessageRefService(),
  );
  review = new ReviewService(pool, audit, outbox, settings, drafts);
  orders = new OrderService(pool, audit, outbox, settings, engine, drafts, review, customers, catalog);
  kitchen = new KitchenService(pool, audit, outbox, engine, orders, catalog, customers);
  notifications = new NotificationService(pool, audit, outbox, settings);
  reconciliation = new ReconciliationService(pool, audit, outbox);

  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Agent S3','agent-s3@t','en'), ($2,'Ops S3','ops-s3@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId],
  );
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function activeOrderWithQueuedDay() {
  const areaId = newId();
  const slotId = newId();
  const methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,$2,'Area S','Area S')`, [areaId, `area-${areaId.slice(-6)}`]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',30)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
  const customerId = await customers.createGuided(agent, { fullNameEn: 'Same Day Customer', phone: '0558001001' });
  const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Cancel Block' });
  const productId = await catalog.createProduct(agent, { nameEn: 'Cancel Meal', nameAr: 'Cancel Meal', price: 800 }, 'import');
  await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productId, sectionId: 'seed-section-hot' });
  const created = await drafts.createDraft(agent, {
    channel: 'phone', customerId, startDate: tomorrow(), addressId, slotId, methodId,
    expectedPaymentMethod: 'cash', items: [{ productId }],
  });
  await drafts.submitDraft(agent, created.id);
  await review.syncSubmittedDrafts(ops);
  await review.decide(ops, created.id, { decision: 'approve' });
  const order = await orders.createFromApprovedDraft(ops, created.id);
  await orders.transitionOrder('system', order.id, 'active');
  const day = (await orders.listDays(order.id))[0];
  await kitchen.generateTickets('system', day.date, `batch-${day.id.slice(-6)}`);
  return { orderId: order.id, dayId: day.id, dayDate: day.date };
}

describe('TS-S scenario #3 — same-day cancel after kitchen_queued (OM ack + kitchen alert)', () => {
  it('lets OM cancel a kitchen_queued day with a reason and emits the kitchen-alertable event', async () => {
    const { orderId, dayId } = await activeOrderWithQueuedDay();
    expect((await orders.dayForKitchen(dayId)).status).toBe('kitchen_queued');

    // role restriction: the order agent is NOT allowed by seed-tc-f7
    await expect(orders.transitionDay(agent, dayId, 'cancelled_day', { code: 'other', note: 'agent attempt' }))
      .rejects.toMatchObject({ code: 'transition_not_allowed_role' });
    // reason restriction: OM without a reason is refused
    await expect(orders.transitionDay(ops, dayId, 'cancelled_day'))
      .rejects.toBeInstanceOf(TransitionError);

    await orders.transitionDay(ops, dayId, 'cancelled_day', { code: 'other', note: 'customer cancelled same day' });
    expect((await orders.dayForKitchen(dayId)).status).toBe('cancelled_day');

    const history = await pool.query(
      `SELECT from_status, to_status FROM order_status_history
       WHERE subject = 'fulfillment_day' AND subject_ref = $1 ORDER BY at DESC LIMIT 1`,
      [dayId],
    );
    expect(history.rows[0]).toMatchObject({ from_status: 'kitchen_queued', to_status: 'cancelled_day' });

    const auditRow = await pool.query(
      `SELECT reason FROM audit_event
       WHERE event_type = 'fulfillment.status_changed' AND entity_id = $1
         AND after->>'status' = 'cancelled_day'`,
      [dayId],
    );
    expect(auditRow.rows[0].reason).toMatch(/customer cancelled same day/);

    // the kitchen alert signal: the status-change event is on the bus for consumers
    const evt = await pool.query(
      `SELECT payload FROM outbox_event
       WHERE event_type = 'fulfillment.status_changed' AND refs->>'fulfillment_day_id' = $1
         AND payload->>'to' = 'cancelled_day'`,
      [dayId],
    );
    expect(evt.rowCount).toBe(1);
    expect(evt.rows[0].payload).toMatchObject({ from: 'kitchen_queued', to: 'cancelled_day' });
    void orderId;
  });
});

describe('TS-S scenario #7 — reconciliation divergence raises the configured alert', () => {
  it('records a divergent run (WARN audit) and M11 routes the reconciliation_divergent trigger', async () => {
    const run = await reconciliation.record(ops, {
      runType: 'daily_orders',
      counts: { legacy: 12, new: 11 },
      diffs: { missing_orders: ['LEG-77'] },
    });
    expect(run.state).toBe('divergent');

    const auditRow = await pool.query(
      `SELECT severity FROM audit_event WHERE event_type = 'bridge.reconciliation_run' AND entity_id = $1`,
      [run.id],
    );
    expect(auditRow.rows[0].severity).toBe('warn');

    const evt = await pool.query(
      `SELECT id FROM outbox_event WHERE event_type = 'bridge.reconciliation_run' AND refs->>'reconciliation_run_id' = $1`,
      [run.id],
    );
    expect(evt.rowCount).toBe(1);

    await expect(notifications.routeEvent(evt.rows[0].id as string)).resolves.toEqual({ sent: 1, skipped: 0 });
    const logs = await notifications.logs();
    expect(logs.find((l) => l.source_event_id === evt.rows[0].id)).toMatchObject({
      template_code: 'reconciliation_divergent',
      recipient_ref: 'ops_manager',
      status: 'sent',
    });

    // an OK follow-up run is recordable as the operational close-out; a structured
    // "resolution note" surface does not exist yet (pre-pilot gap, see review report)
    const followUp = await reconciliation.record(ops, { runType: 'daily_orders', counts: { legacy: 12, new: 12 } });
    expect(followUp.state).toBe('ok');
  });
});
