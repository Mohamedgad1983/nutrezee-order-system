import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { TransitionEngine } from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { AuditReadQueue } from '../../apps/api/src/platform/audit/audit.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import { MessageRefService } from '../../apps/api/src/modules/m17-whatsapp/message-ref.service';
import { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let customers: CustomerService;
let catalog: CatalogService;
let drafts: DraftService;
let review: ReviewService;
let areaId: string;
let slotId: string;
let methodId: string;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-1', name: 'Agent', email: 'agent@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-1', name: 'Ops', email: 'ops@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
};

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  pool = await freshDb();
  const settings = new SettingsReader(pool, 0);
  const readQueue = new AuditReadQueue(pool, audit);
  customers = new CustomerService(pool, audit, readQueue, outbox, settings);
  catalog = new CatalogService(pool, audit, settings);
  drafts = new DraftService(
    pool, audit, outbox, settings, new IdempotencyService(),
    new TransitionEngine(pool, audit, outbox, 0), customers, catalog, new MessageRefService(),
  );
  review = new ReviewService(pool, audit, outbox, settings, drafts);
  await seedStaffAndMasters();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedStaffAndMasters() {
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale) VALUES
      ($1,'Agent','agent@t','en'), ($2,'Ops','ops@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId],
  );
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-u','Area U','Area U')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',NULL)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
}

async function submittedDraft(phone: string, productId?: string) {
  const customerId = await customers.createGuided(agent, { fullNameEn: `Customer ${phone}`, phone });
  const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Block 1' });
  const packageId = productId
    ? undefined
    : await catalog.createPackage(agent, { nameEn: `Plan ${phone}`, nameAr: `Plan ${phone}` }, 'import');
  const created = await drafts.createDraft(agent, {
    channel: 'phone',
    customerId,
    packageId,
    startDate: tomorrow(),
    addressId,
    slotId,
    methodId,
    expectedPaymentMethod: 'cash',
    items: productId ? [{ productId }] : undefined,
  });
  await drafts.submitDraft(agent, created.id);
  return { draftId: created.id, customerId };
}

describe('TS-U unit — review queue and decisions (WP-08)', () => {
  it('queues submitted drafts by SLA and claim records review.opened audit', async () => {
    const { draftId } = await submittedDraft('0552001001');
    await review.syncSubmittedDrafts(ops);
    const queue = await review.listQueue(ops, { state: 'waiting' });
    const item = queue.find((q) => q.draft_id === draftId);
    expect(item).toBeTruthy();
    expect(new Date(item?.sla_due_at ?? 0).getTime()).toBeGreaterThan(new Date(item?.entered_at ?? 0).getTime());

    await review.claim(ops, draftId);
    const inReview = (await review.listQueue(ops, { state: 'in_review' })).find((q) => q.draft_id === draftId);
    expect(inReview?.reviewer_id).toBe(ops.staffId);
    const evt = await pool.query(
      `SELECT after FROM audit_event WHERE event_type = 'review.opened' AND related_refs->>'draft' = $1`,
      [draftId],
    );
    expect(evt.rowCount).toBe(1);
  });

  it('return decision records an append-only decision and moves the draft through M01 transition', async () => {
    const { draftId } = await submittedDraft('0552001002');
    await review.claim(ops, draftId);
    await review.decide(ops, draftId, { decision: 'return', reasonCode: 'other', note: 'missing delivery detail' });

    expect((await drafts.getDraft(draftId)).state).toBe('returned');
    const decision = await pool.query(`SELECT decision, reason_code_id FROM review_decision WHERE draft_id = $1`, [draftId]);
    expect(decision.rows[0].decision).toBe('return');
    expect(decision.rows[0].reason_code_id).toBeTruthy();
    const evt = await pool.query(`SELECT 1 FROM outbox_event WHERE event_type = 'order.returned' AND refs->>'draft_order' = $1`, [draftId]);
    expect(evt.rowCount).toBe(1);
  });

  it('approval requires override reasons for warnings and writes HIGH audit when overridden', async () => {
    const allergenId = newId();
    await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Peanut','Peanut')`, [allergenId]);
    const productId = await catalog.createProduct(agent, { nameEn: 'Peanut Meal', nameAr: 'Peanut Meal' }, 'import');
    await catalog.declareAllergen(agent, productId, allergenId);
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Allergy Review', phone: '0552001003' });
    await customers.setAllergy(agent, customerId, { allergenId, severity: 'severe' });
    const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Block 2' });
    const created = await drafts.createDraft(agent, {
      channel: 'phone',
      customerId,
      startDate: tomorrow(),
      addressId,
      slotId,
      methodId,
      expectedPaymentMethod: 'cash',
      items: [{ productId }],
    });
    await drafts.submitDraft(agent, created.id);
    const draftId = created.id;

    await review.claim(ops, draftId);
    await expect(review.decide(ops, draftId, { decision: 'approve' }))
      .rejects.toMatchObject({ code: 'override_required' });
    await review.decide(ops, draftId, {
      decision: 'approve',
      warningsOverridden: [
        { field: 'allergy_conflicts', reason: 'Ops manager accepted customer confirmation' },
        { field: 'slot_id', reason: 'Ops manager accepted slot capacity warning' },
      ],
    });

    const evt = await pool.query(
      `SELECT severity, reason, after FROM audit_event WHERE event_type = 'order.approved' AND entity_id = $1`,
      [draftId],
    );
    expect(evt.rows[0].severity).toBe('high');
    expect(evt.rows[0].reason).toMatch(/override/);
    expect(evt.rows[0].after.conversion_pending_wp09).toBe(true);
    await review.syncSubmittedDrafts(ops);
    expect((await review.listQueue(ops, { state: 'waiting' })).map((q) => q.draft_id)).not.toContain(draftId);
  });
});
