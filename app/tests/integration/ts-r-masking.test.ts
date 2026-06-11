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
import { newId } from '../../apps/api/src/platform/ids';

// TS-R — masking per visibility class through real controllers + the REAL M13
// grant matrix (review fix: M01/M02/M03 read paths returned PII/HEALTH/PAYMENT
// unmasked — exactly while staged RBAC runs in log mode and admits every role).
let pool: Pool;
let customers: CustomerService;
let catalog: CatalogService;
let drafts: DraftService;
let review: ReviewService;
let orders: OrderService;
let payments: PaymentService;
let draftController: DraftController;
let reviewController: ReviewController;
let orderController: OrderController;
let draftId: string;
let orderId: string;

const audit = new AuditService();
const outbox = new OutboxService();

const agent: StaffContext = {
  staffId: 'agent-m', name: 'Agent M', email: 'agent-m@t', locale: 'en', roles: ['order_agent'], sessionId: 'sid-agent',
};
const ops: StaffContext = {
  staffId: 'ops-m', name: 'Ops M', email: 'ops-m@t', locale: 'en', roles: ['ops_manager'], sessionId: 'sid-ops',
};
// dormant role: zero permissions => zero visibility grants; log-mode RBAC still
// admits the call, so serialization masking is the active line of defense
const driver: StaffContext = {
  staffId: 'driver-m', name: 'Driver M', email: 'driver-m@t', locale: 'en', roles: ['driver'], sessionId: 'sid-driver',
};

const byCookie: Record<string, StaffContext> = {
  'sid-agent': agent, 'sid-ops': ops, 'sid-driver': driver,
};
const sessions = {
  validate: async (sid: string) => byCookie[sid],
} as unknown as SessionService;
const reqFor = (sid: string) => ({ cookies: { nz_session: sid } } as unknown as Request);

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  pool = await freshDb();
  const settings = new SettingsReader(pool, 0);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  const access = new AccessService(pool, audit, settings, 0);
  customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), outbox, settings);
  catalog = new CatalogService(pool, audit, settings);
  drafts = new DraftService(
    pool, audit, outbox, settings, new IdempotencyService(), engine,
    customers, catalog, new MessageRefService(),
  );
  review = new ReviewService(pool, audit, outbox, settings, drafts);
  orders = new OrderService(pool, audit, outbox, settings, engine, drafts, review, customers, catalog);
  payments = new PaymentService(pool, audit, outbox, engine, orders);
  draftController = new DraftController(sessions, access, drafts);
  reviewController = new ReviewController(sessions, access, review);
  orderController = new OrderController(sessions, access, orders);

  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Agent M','agent-m@t','en'), ($2,'Ops M','ops-m@t','en'), ($3,'Driver M','driver-m@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId, driver.staffId],
  );
  const areaId = newId();
  const slotId = newId();
  const methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-m','Area M','Area M')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',30)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);

  const allergenId = newId();
  await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Peanut','Peanut')`, [allergenId]);
  const customerId = await customers.createGuided(agent, { fullNameEn: 'Mask Customer', phone: '0556001001' });
  await customers.setAllergy(agent, customerId, { allergenId, severity: 'severe' });
  const productId = await catalog.createProduct(agent, { nameEn: 'Peanut Mask Meal', nameAr: 'Peanut Mask Meal', price: 700 }, 'import');
  await catalog.declareAllergen(agent, productId, allergenId);

  const created = await drafts.createDraft(agent, {
    channel: 'phone',
    customerId,
    startDate: tomorrow(),
    addressInline: { areaId, addressText: 'Secret Street 7', contactPhone: '0556001001' },
    slotId,
    methodId,
    expectedPaymentMethod: 'cash',
    priceEstimate: 4200,
    items: [{ productId }],
  });
  draftId = created.id;
  await drafts.submitDraft(agent, draftId);
  await review.syncSubmittedDrafts(ops);
  await review.decide(ops, draftId, {
    decision: 'approve',
    warningsOverridden: [{ field: 'allergy_conflicts', reason: 'masking test override' }],
  });
  orderId = (await orders.createFromApprovedDraft(ops, draftId)).id;
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-R rbac — PII/HEALTH/PAYMENT masking at serialization (review fixes)', () => {
  it('masks draft PII/HEALTH/PAYMENT fields with the sentinel for a grant-less role', async () => {
    const masked = await draftController.get(reqFor('sid-driver'), draftId);
    expect(masked).toMatchObject({
      address_inline: '***',
      allergy_conflicts: '***',
      price_estimate: '***',
      masked: true,
    });
    // allergy warning detail inside the completeness snapshot is HEALTH data too
    const allergyWarning = masked.completeness.warnings.find((w) => w.field === 'allergy_conflicts');
    expect(allergyWarning?.detail).toBe('***');
  });

  it('returns unmasked fields to a role whose permissions carry the grants', async () => {
    const full = await draftController.get(reqFor('sid-agent'), draftId);
    expect(full.masked).toBe(false);
    expect(full.address_inline).toMatchObject({ addressText: 'Secret Street 7' });
    expect(full.price_estimate).toBe(4200);
    expect(Array.isArray(full.allergy_conflicts)).toBe(true);
  });

  it('masks order money fields for roles without the payment grant', async () => {
    const masked = await orderController.get(reqFor('sid-driver'), orderId);
    expect(masked).toMatchObject({ total: '***', masked: true });
    const full = await orderController.get(reqFor('sid-ops'), orderId);
    expect(full).toMatchObject({ total: 4200, masked: false }); // price_estimate frozen at conversion
  });

  it('masks allergy warning detail in the review queue for roles without the health grant', async () => {
    // a fresh submitted draft so the queue has an undecided item with warnings
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Queue Mask', phone: '0556001002' });
    const { rows: slot } = await pool.query(`SELECT id FROM delivery_slot LIMIT 1`);
    const { rows: method } = await pool.query(`SELECT id FROM delivery_method LIMIT 1`);
    const { rows: area } = await pool.query(`SELECT id FROM area LIMIT 1`);
    const { rows: allergen } = await pool.query(`SELECT id FROM allergen LIMIT 1`);
    await customers.setAllergy(agent, customerId, { allergenId: allergen[0].id, severity: 'avoid' });
    const { rows: product } = await pool.query(`SELECT id FROM product LIMIT 1`);
    const created = await drafts.createDraft(agent, {
      channel: 'phone',
      customerId,
      startDate: tomorrow(),
      addressInline: { areaId: area[0].id, addressText: 'Queue Street 1' },
      slotId: slot[0].id,
      methodId: method[0].id,
      expectedPaymentMethod: 'cash',
      items: [{ productId: product[0].id }],
    });
    await drafts.submitDraft(agent, created.id);
    await review.syncSubmittedDrafts(ops);

    const maskedList = await reviewController.list(reqFor('sid-driver'));
    const item = maskedList.items.find((q) => q.draft_id === created.id);
    expect(item?.masked).toBe(true);
    expect(item?.warnings.find((w) => w.field === 'allergy_conflicts')?.detail).toBe('***');

    const fullList = await reviewController.list(reqFor('sid-ops'));
    const fullItem = fullList.items.find((q) => q.draft_id === created.id);
    expect(fullItem?.masked).toBe(false);
    expect(fullItem?.warnings.find((w) => w.field === 'allergy_conflicts')?.detail).not.toBe('***');
  });

  it('renders masked payment reads as sentinel fields, never silent omission (api_standards rule 4)', async () => {
    await payments.recordLinkSent(agent, orderId, { linkRef: 'mask-link-1', method: 'online_link' });
    const masked = await payments.paymentForOrder(orderId, false);
    expect(masked).toMatchObject({
      status: 'link_sent',
      masked: true,
      method: '***',
      amount: '***',
      currency: '***',
      transaction_ref: '***',
      link_ref: '***',
      evidence_note: '***',
    });
    const full = await payments.paymentForOrder(orderId, true);
    expect(full).toMatchObject({ masked: false, link_ref: 'mask-link-1' });
  });
});
