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
  staffId: 'agent-s', name: 'Agent S', email: 'agent-s@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const ops: StaffContext = {
  staffId: 'ops-s', name: 'Ops S', email: 'ops-s@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
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
      ($1,'Agent S','agent-s@t','en'), ($2,'Ops S','ops-s@t','en')
     ON CONFLICT (email) DO NOTHING`,
    [agent.staffId, ops.staffId],
  );
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'area-s','Area S','Area S')`, [areaId]);
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',NULL)`,
    [slotId],
  );
  await pool.query(`INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`, [methodId]);
}

describe('TS-S scenario — WP-08 review return loop', () => {
  it('moves a submitted draft into review, returns it, lets the agent correct, and requeues on resubmit', async () => {
    const customerId = await customers.createGuided(agent, { fullNameEn: 'Scenario Customer', phone: '0553001001' });
    const addressId = await customers.addAddress(agent, customerId, { areaId, addressText: 'Scenario Block' });
    const packageId = await catalog.createPackage(agent, { nameEn: 'Scenario Plan', nameAr: 'Scenario Plan' }, 'import');
    const created = await drafts.createDraft(agent, {
      channel: 'phone',
      customerId,
      packageId,
      startDate: tomorrow(),
      addressId,
      slotId,
      methodId,
      expectedPaymentMethod: 'cash',
      notes: 'first submit',
    });
    await drafts.submitDraft(agent, created.id);

    await review.syncSubmittedDrafts(ops);
    expect((await review.listQueue(ops, { state: 'waiting' })).map((q) => q.draft_id)).toContain(created.id);
    await review.claim(ops, created.id);
    await review.decide(ops, created.id, { decision: 'return', reasonCode: 'other', note: 'Correct customer note' });
    expect((await drafts.getDraft(created.id)).state).toBe('returned');

    const returned = await drafts.getDraft(created.id);
    await drafts.updateDraft(agent, created.id, { version: returned.version, notes: 'corrected submit' });
    await drafts.submitDraft(agent, created.id);
    await review.syncSubmittedDrafts(ops);
    const requeued = await review.listQueue(ops, { state: 'waiting' });
    expect(requeued.map((q) => q.draft_id)).toContain(created.id);
    const decisions = await pool.query(`SELECT decision FROM review_decision WHERE draft_id = $1`, [created.id]);
    expect(decisions.rows.map((r) => r.decision)).toEqual(['return']);
  });
});
