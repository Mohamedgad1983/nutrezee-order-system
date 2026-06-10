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
  staffId: 'agent-os', name: 'Agent OS', email: 'agent-os@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-os', name: 'Ops OS', email: 'ops-os@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
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
  await seedStaffAndMasters();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedStaffAndMasters() {
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Agent OS','agent-os@t','en'), ($2,'Ops OS','ops-os@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId],
  );
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-os','Area OS','Area OS')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Midday','Midday','11:00','14:00',15)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
}

describe('TS-S scenario — WP-09 order core lifecycle', () => {
  it('converts an approved review into an active order and resolves downstream order work items', async () => {
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Scenario Order', phone: '0554101001' });
    const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Scenario Order Block' });
    const packageId = await catalog.createPackage(
      agent,
      { nameEn: 'Scenario Order Plan', nameAr: 'Scenario Order Plan', durationDays: 2, price: 2222 },
      'import',
    );
    const draft = await drafts.createDraft(agent, {
      channel: 'phone',
      customerId,
      packageId,
      startDate: tomorrow(),
      addressId,
      slotId,
      methodId,
      expectedPaymentMethod: 'cash',
    });
    await drafts.submitDraft(agent, draft.id);
    await review.claim(ops, draft.id);
    await review.decide(ops, draft.id, { decision: 'approve' });

    const created = await orders.createFromApprovedDraft(ops, draft.id);
    await orders.transitionOrder('system', created.id, 'active');

    const changeId = await orders.createChangeRequest(agent, created.id, { end_date: '2099-12-31' });
    await orders.decideChangeRequest(ops, changeId, false);

    const firstDay = (await orders.listDays(created.id))[0];
    const exceptionId = await orders.createException(ops, {
      typeCode: 'allergy_incident',
      refs: { order_id: created.id, fulfillment_day_id: firstDay.id },
      notes: 'customer reported issue',
    });
    await orders.resolveException(ops, exceptionId, { resolutionCode: 'other', notes: 'manager followed up' });

    expect((await orders.getOrder(created.id)).status).toBe('active');
    expect(await orders.listDays(created.id)).toHaveLength(2);
    const cr = await pool.query(`SELECT state FROM change_request WHERE id = $1`, [changeId]);
    expect(cr.rows[0].state).toBe('rejected');
    const ex = await pool.query(`SELECT state, severity FROM exception_case WHERE id = $1`, [exceptionId]);
    expect(ex.rows[0]).toMatchObject({ state: 'resolved', severity: 'high' });
    const rejectedAudit = await pool.query(`SELECT 1 FROM audit_event WHERE event_type = 'order.change_rejected' AND entity_id = $1`, [changeId]);
    expect(rejectedAudit.rowCount).toBe(1);
  });
});
