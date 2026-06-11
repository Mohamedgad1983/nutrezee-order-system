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
import { KitchenError, KitchenService } from '../../apps/api/src/modules/m08-kitchen/kitchen.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let customers: CustomerService;
let catalog: CatalogService;
let drafts: DraftService;
let review: ReviewService;
let orders: OrderService;
let kitchen: KitchenService;
let areaId: string;
let slotId: string;
let methodId: string;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-k', name: 'Agent K', email: 'agent-k@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-k', name: 'Ops K', email: 'ops-k@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
};
const chef: StaffContext = {
  staffId: 'chef-k', name: 'Chef K', email: 'chef-k@t', locale: 'en', roles: ['kitchen_user'], sessionId: 'tablet-1',
};

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

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
  kitchen = new KitchenService(pool, audit, outbox, engine, orders, catalog, customers);
  await seedStaffAndMasters();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedStaffAndMasters() {
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Agent K','agent-k@t','en'), ($2,'Ops K','ops-k@t','en'), ($3,'Chef K','chef-k@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId, chef.staffId],
  );
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-k','Area K','Area K')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Kitchen Morning','Kitchen Morning','08:00','11:00',30)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
}

async function approvedOrderWithItems(phone: string, productIds: string[], customerId?: string) {
  const cid = customerId ?? await customers.createGuided(agent, { fullNameEn: `Kitchen Customer ${phone}`, phone });
  const addressId = await customers.addAddress(agent, cid, { areaId, addressText: 'Kitchen Block' });
  const created = await drafts.createDraft(agent, {
    channel: 'phone',
    customerId: cid,
    startDate: tomorrow(),
    addressId,
    slotId,
    methodId,
    expectedPaymentMethod: 'cash',
    items: productIds.map((productId) => ({ productId })),
  });
  await drafts.submitDraft(agent, created.id);
  const draft = await drafts.getDraft(created.id);
  await review.decide(ops, created.id, {
    decision: 'approve',
    warningsOverridden: draft.completeness.warnings.map((w) => ({ field: w.field, reason: 'WP-10 test override' })),
  });
  const order = await orders.createFromApprovedDraft(ops, created.id);
  const day = (await orders.listDays(order.id))[0];
  return { orderId: order.id, day };
}

describe('TS-U unit — kitchen ticket generation and board (WP-10)', () => {
  it('generates routed and unrouted tickets idempotently, with allergy markers from frozen order items', async () => {
    const allergenId = newId();
    await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Peanut','Peanut')`, [allergenId]);
    const routedProduct = await catalog.createProduct(agent, { nameEn: 'Hot Peanut Meal', nameAr: 'Hot Peanut Meal' }, 'import');
    await catalog.declareAllergen(agent, routedProduct, allergenId);
    const unroutedProduct = await catalog.createProduct(agent, { nameEn: 'No Route Meal', nameAr: 'No Route Meal' }, 'import');
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: routedProduct, sectionId: 'seed-section-hot' });

    const { day } = await approvedOrderWithItems('0555001001', [routedProduct, unroutedProduct]);
    const first = await kitchen.generateTickets('system', day.date, 'batch-a');
    const second = await kitchen.generateTickets('system', day.date, 'batch-a');

    expect(first).toMatchObject({ days_seen: 1, days_queued: 1, tickets_created: 2, unrouted: 1 });
    expect(second).toMatchObject({ days_seen: 1, tickets_created: 0 });
    const board = await kitchen.board({ date: day.date });
    expect(board).toHaveLength(2);
    expect(board.some((t) => t.section_id === 'seed-section-hot' && t.allergy_marker)).toBe(true);
    expect(board.some((t) => t.unrouted)).toBe(true);
    expect((await orders.listDays((await orders.getOrder((await orders.dayForKitchen(day.id)).orderId)).id))[0].status).toBe('kitchen_queued');

    const evt = await pool.query(`SELECT payload FROM outbox_event WHERE event_type = 'kitchen.ticket_generated'`);
    expect(evt.rows[0].payload.unrouted).toBe(1);
  });

  it('captures shared-device actor taps and rolls fulfillment days to ready_to_pack and packed', async () => {
    const productA = await catalog.createProduct(agent, { nameEn: 'Rollup A', nameAr: 'Rollup A' }, 'import');
    const productB = await catalog.createProduct(agent, { nameEn: 'Rollup B', nameAr: 'Rollup B' }, 'import');
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productA, sectionId: 'seed-section-hot' });
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productB, sectionId: 'seed-section-cold' });
    const { day } = await approvedOrderWithItems('0555001002', [productA, productB]);
    await kitchen.generateTickets('system', day.date, 'batch-b');
    const tickets = (await kitchen.board({ date: day.date })).filter((t) => t.fulfillment_day_id === day.id);

    for (const ticket of tickets) {
      await kitchen.transitionTicket(chef, ticket.id, 'in_progress', { deviceSession: 'tablet-42', nameTap: 'Chef A' });
      await kitchen.transitionTicket(chef, ticket.id, 'prepared', { deviceSession: 'tablet-42', nameTap: 'Chef A' });
    }
    expect((await orders.dayForKitchen(day.id)).status).toBe('ready_to_pack');
    await kitchen.confirmPacked(chef, day.id);
    expect((await orders.dayForKitchen(day.id)).status).toBe('packed');

    const actor = await pool.query(`SELECT actor FROM ticket_status_event WHERE ticket_id = $1 ORDER BY at LIMIT 1`, [tickets[0].id]);
    expect(actor.rows[0].actor).toMatchObject({ device_session: 'tablet-42', name_tap: 'Chef A' });
  });

  // review fix: the rollup read the day via the pool (outside the transaction) and
  // the all-tickets-prepared check was write-skew prone — two concurrent `prepared`
  // transitions could each see the other ticket as unprepared and BOTH skip the
  // rollup, stranding a fully-prepared day in in_preparation.
  it('rolls a day to ready_to_pack when the last two tickets are prepared concurrently', async () => {
    const productA = await catalog.createProduct(agent, { nameEn: 'Race A', nameAr: 'Race A' }, 'import');
    const productB = await catalog.createProduct(agent, { nameEn: 'Race B', nameAr: 'Race B' }, 'import');
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productA, sectionId: 'seed-section-hot' });
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productB, sectionId: 'seed-section-cold' });
    const { day } = await approvedOrderWithItems('0555001004', [productA, productB]);
    await kitchen.generateTickets('system', day.date, 'batch-race');
    const tickets = (await kitchen.board({ date: day.date })).filter((t) => t.fulfillment_day_id === day.id);
    expect(tickets).toHaveLength(2);

    for (const ticket of tickets) {
      await kitchen.transitionTicket(chef, ticket.id, 'in_progress', { deviceSession: 'tablet-9' });
    }
    expect((await orders.dayForKitchen(day.id)).status).toBe('in_preparation');

    await Promise.all(tickets.map((ticket) =>
      kitchen.transitionTicket(chef, ticket.id, 'prepared', { deviceSession: 'tablet-9' }),
    ));
    expect((await orders.dayForKitchen(day.id)).status).toBe('ready_to_pack');
  });

  it('rechecks proposed substitutes against customer allergies before raising an escalation', async () => {
    const allergenId = newId();
    await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Sesame','Sesame')`, [allergenId]);
    const baseProduct = await catalog.createProduct(agent, { nameEn: 'Base Kitchen Meal', nameAr: 'Base Kitchen Meal' }, 'import');
    const unsafeSub = await catalog.createProduct(agent, { nameEn: 'Sesame Substitute', nameAr: 'Sesame Substitute' }, 'import');
    await catalog.declareAllergen(agent, unsafeSub, allergenId);
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: baseProduct, sectionId: 'seed-section-prep' });
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Escalation Customer', phone: '0555001003' });
    await customers.setAllergy(agent, customerId, { allergenId, severity: 'severe' });
    const { day } = await approvedOrderWithItems('0555001003', [baseProduct], customerId);
    await kitchen.generateTickets('system', day.date, 'batch-c');
    const ticket = (await kitchen.board({ date: day.date })).find((t) => t.fulfillment_day_id === day.id);
    expect(ticket).toBeTruthy();

    await expect(kitchen.raiseEscalation(chef, ticket?.id as string, { typeCode: 'other', proposedSubstituteId: unsafeSub }))
      .rejects.toBeInstanceOf(KitchenError);
    const escalationId = await kitchen.raiseEscalation(chef, ticket?.id as string, { typeCode: 'other', notes: 'short item' });
    await kitchen.resolveEscalation(ops, escalationId);

    const row = await pool.query(`SELECT state FROM escalation WHERE id = $1`, [escalationId]);
    expect(row.rows[0].state).toBe('resolved');
  });
});
