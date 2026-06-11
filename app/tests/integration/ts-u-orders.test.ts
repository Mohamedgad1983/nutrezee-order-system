import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService, AuditReadQueue } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { TransitionEngine } from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import { MessageRefService } from '../../apps/api/src/modules/m17-whatsapp/message-ref.service';
import { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let customers: CustomerService;
let catalog: CatalogService;
let drafts: DraftService;
let review: ReviewService;
let orders: OrderService;
let areaId: string;
let slotId: string;
let methodId: string;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-o', name: 'Agent O', email: 'agent-o@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-o', name: 'Ops O', email: 'ops-o@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
};

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  pool = await freshDb();
  const settings = new SettingsReader(pool, 0);
  const readQueue = new AuditReadQueue(pool, audit);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  customers = new CustomerService(pool, audit, readQueue, outbox, settings);
  catalog = new CatalogService(pool, audit, settings);
  drafts = new DraftService(
    pool, audit, outbox, settings, new IdempotencyService(), engine,
    customers, catalog, new MessageRefService(),
  );
  review = new ReviewService(pool, audit, outbox, settings, drafts);
  orders = new OrderService(pool, audit, outbox, settings, engine, drafts, review, customers, catalog);
  await seedStaffAndMasters();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedStaffAndMasters() {
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Agent O','agent-o@t','en'), ($2,'Ops O','ops-o@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId],
  );
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-o','Area O','Area O')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',25)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
}

async function approvedPackageDraft(phone: string, durationDays = 3) {
  const customerId = await customers.createGuided(agent, { fullNameEn: `Order Customer ${phone}`, phone });
  const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Block 9, Street 1' });
  const packageId = await catalog.createPackage(
    agent,
    { nameEn: `Package ${phone}`, nameAr: `Package ${phone}`, durationDays, price: 12345 },
    'import',
  );
  const created = await drafts.createDraft(agent, {
    channel: 'phone',
    customerId,
    packageId,
    startDate: tomorrow(),
    addressId,
    slotId,
    methodId,
    expectedPaymentMethod: 'cash',
  });
  await drafts.submitDraft(agent, created.id);
  await review.decide(ops, created.id, { decision: 'approve' });
  return { draftId: created.id, customerId, packageId };
}

describe('TS-U unit — order factory and lifecycle (WP-09)', () => {
  it('converts an approved package draft into an approved order, frozen item, days, and converted draft', async () => {
    const { draftId, customerId } = await approvedPackageDraft('0554001001', 3);
    const created = await orders.createFromApprovedDraft(ops, draftId);
    const replay = await orders.createFromApprovedDraft(ops, draftId);

    expect(created.replay).toBe(false);
    expect(replay).toEqual({ id: created.id, replay: true });

    const order = await orders.getOrder(created.id);
    expect(order).toMatchObject({ customer_id: customerId, status: 'approved', source_draft_id: draftId, total: 12345 });
    expect(await drafts.getDraft(draftId)).toMatchObject({ state: 'converted' });
    expect(await orders.listDays(created.id)).toHaveLength(3);

    const items = await pool.query(`SELECT name_frozen_en, qty, unit_price_frozen FROM order_item WHERE order_id = $1`, [created.id]);
    expect(items.rows[0]).toMatchObject({ qty: 1, unit_price_frozen: '12345' });
    expect(items.rows[0].name_frozen_en).toMatch(/Package/);

    const evt = await pool.query(
      `SELECT payload FROM outbox_event WHERE event_type = 'order.approved' AND refs->>'order_id' = $1`,
      [created.id],
    );
    expect(evt.rows[0].payload.day_count).toBe(3);
  });

  it('freezes product names, quantities, prices, and resolved allergens on order items', async () => {
    const allergenId = newId();
    await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Peanut','Peanut')`, [allergenId]);
    const productId = await catalog.createProduct(agent, { nameEn: 'Peanut Bowl', nameAr: 'Peanut Bowl', price: 975 }, 'import');
    await catalog.declareAllergen(agent, productId, allergenId);
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Frozen Allergy', phone: '0554001002' });
    await customers.setAllergy(agent, customerId, { allergenId, severity: 'severe' });
    const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Block 10' });
    const created = await drafts.createDraft(agent, {
      channel: 'phone',
      customerId,
      startDate: tomorrow(),
      addressId,
      slotId,
      methodId,
      expectedPaymentMethod: 'cash',
      items: [{ productId, qty: 2 }],
    });
    await drafts.submitDraft(agent, created.id);
    await review.decide(ops, created.id, {
      decision: 'approve',
      warningsOverridden: [{ field: 'allergy_conflicts', reason: 'Customer confirmed by phone' }],
    });

    const order = await orders.createFromApprovedDraft(ops, created.id);
    const item = await pool.query(`SELECT * FROM order_item WHERE order_id = $1`, [order.id]);
    expect(item.rows[0]).toMatchObject({ product_id: productId, name_frozen_en: 'Peanut Bowl', qty: 2, unit_price_frozen: '975' });
    expect(item.rows[0].allergens_frozen).toEqual([{ allergenId, nameEn: 'Peanut', source: 'declared' }]);
  });

  it('runs order and day transitions through config and applies approved date-extension requests atomically', async () => {
    const { draftId } = await approvedPackageDraft('0554001003', 2);
    const created = await orders.createFromApprovedDraft(ops, draftId);

    await orders.transitionOrder('system', created.id, 'active');
    expect((await orders.getOrder(created.id)).status).toBe('active');

    const firstDay = (await orders.listDays(created.id))[0];
    await orders.transitionDay(ops, firstDay.id, 'cancelled_day', { code: 'other', note: 'customer pause' });
    expect((await orders.listDays(created.id)).find((d) => d.id === firstDay.id)?.status).toBe('cancelled_day');

    const before = await orders.getOrder(created.id);
    const requestId = await orders.createChangeRequest(ops, created.id, { end_date: addDays(before.end_date, 2) });
    await orders.decideChangeRequest(ops, requestId, true);

    const after = await orders.getOrder(created.id);
    expect(after.end_date).toBe(addDays(before.end_date, 2));
    expect(await orders.listDays(created.id)).toHaveLength(4);
    const auditRows = await pool.query(`SELECT 1 FROM audit_event WHERE event_type = 'order.change_applied' AND entity_id = $1`, [created.id]);
    expect(auditRows.rowCount).toBe(1);
  });

  // review fix: an end-date reduction used to leave days already in kitchen
  // production alive beyond the new end date (silently inconsistent state)
  it('rejects an end-date reduction while days beyond the new end are in kitchen production', async () => {
    const { draftId } = await approvedPackageDraft('0554001004', 3);
    const created = await orders.createFromApprovedDraft(ops, draftId);
    await orders.transitionOrder('system', created.id, 'active');

    const days = await orders.listDays(created.id);
    const lastDay = days[days.length - 1];
    await orders.transitionDay('system', lastDay.id, 'kitchen_queued');

    const order = await orders.getOrder(created.id);
    const requestId = await orders.createChangeRequest(ops, created.id, { end_date: order.start_date });
    await expect(orders.decideChangeRequest(ops, requestId, true)).rejects.toMatchObject({
      code: 'validation_failed',
      detail: expect.objectContaining({ rule: 'kitchen_activity_beyond_new_end' }),
    });
    // atomic: nothing applied — request still pending, days untouched, end date kept
    const state = await pool.query(`SELECT state FROM change_request WHERE id = $1`, [requestId]);
    expect(state.rows[0].state).toBe('pending');
    expect((await orders.getOrder(created.id)).end_date).toBe(order.end_date);
    expect((await orders.listDays(created.id)).find((d) => d.id === lastDay.id)?.status).toBe('kitchen_queued');
  });

  it('applies an end-date reduction by cancelling scheduled days beyond the new end', async () => {
    const { draftId } = await approvedPackageDraft('0554001005', 3);
    const created = await orders.createFromApprovedDraft(ops, draftId);
    await orders.transitionOrder('system', created.id, 'active');

    const order = await orders.getOrder(created.id);
    const newEnd = addDays(order.end_date, -1);
    const requestId = await orders.createChangeRequest(ops, created.id, { end_date: newEnd });
    await orders.decideChangeRequest(ops, requestId, true);

    expect((await orders.getOrder(created.id)).end_date).toBe(newEnd);
    const days = await orders.listDays(created.id);
    expect(days.filter((d) => d.status === 'cancelled_day')).toHaveLength(1);
    expect(days.filter((d) => d.status === 'scheduled')).toHaveLength(2);
  });
});
