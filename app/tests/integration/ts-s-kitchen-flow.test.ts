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
import { KitchenService } from '../../apps/api/src/modules/m08-kitchen/kitchen.service';
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
  staffId: 'agent-ks', name: 'Agent KS', email: 'agent-ks@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-ks', name: 'Ops KS', email: 'ops-ks@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
};
const chef: StaffContext = {
  staffId: 'chef-ks', name: 'Chef KS', email: 'chef-ks@t', locale: 'en', roles: ['kitchen_user'], sessionId: 'tablet-ks',
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
      ($1,'Agent KS','agent-ks@t','en'), ($2,'Ops KS','ops-ks@t','en'), ($3,'Chef KS','chef-ks@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId, chef.staffId],
  );
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-ks','Area KS','Area KS')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Kitchen Scenario','Kitchen Scenario','08:00','11:00',20)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
}

describe('TS-S scenario — WP-10 kitchen flow', () => {
  it('takes a WhatsApp order through allergy-marked kitchen ticketing to packed', async () => {
    const allergenId = newId();
    await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Peanut','Peanut')`, [allergenId]);
    const productId = await catalog.createProduct(agent, { nameEn: 'Scenario Peanut Meal', nameAr: 'Scenario Peanut Meal' }, 'import');
    await catalog.declareAllergen(agent, productId, allergenId);
    await catalog.addRoutingRule(ops, { scope: 'product', targetRef: productId, sectionId: 'seed-section-hot' });
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Kitchen Scenario Customer', phone: '0555101001' });
    await customers.setAllergy(agent, customerId, { allergenId, severity: 'severe' });
    const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Scenario Kitchen Block' });

    const draft = await drafts.createDraft(agent, {
      channel: 'whatsapp',
      customerId,
      startDate: tomorrow(),
      addressId,
      slotId,
      methodId,
      expectedPaymentMethod: 'cash',
      items: [{ productId }],
      whatsappRef: { senderPhone: '0555101001', messageAt: new Date().toISOString(), refNote: 'scenario copy' },
    });
    await drafts.submitDraft(agent, draft.id);
    await review.decide(ops, draft.id, {
      decision: 'approve',
      warningsOverridden: [{ field: 'allergy_conflicts', reason: 'Customer confirmed by phone' }],
    });
    const order = await orders.createFromApprovedDraft(ops, draft.id);
    const day = (await orders.listDays(order.id))[0];

    await kitchen.generateTickets('system', day.date, 'scenario-batch');
    const ticket = (await kitchen.board({ date: day.date })).find((t) => t.fulfillment_day_id === day.id);
    expect(ticket).toBeTruthy();
    expect(ticket?.allergy_marker).toBe(true);
    await kitchen.transitionTicket(chef, ticket?.id as string, 'in_progress', { deviceSession: 'tablet-ks', nameTap: 'Chef S' });
    await kitchen.transitionTicket(chef, ticket?.id as string, 'prepared', { deviceSession: 'tablet-ks', nameTap: 'Chef S' });
    expect((await orders.dayForKitchen(day.id)).status).toBe('ready_to_pack');
    await kitchen.confirmPacked(chef, day.id);
    expect((await orders.dayForKitchen(day.id)).status).toBe('packed');

    const generated = await pool.query(`SELECT 1 FROM outbox_event WHERE event_type = 'kitchen.ticket_generated'`);
    expect(generated.rowCount).toBe(1);
  });
});
