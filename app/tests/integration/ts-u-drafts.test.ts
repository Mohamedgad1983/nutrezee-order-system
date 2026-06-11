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
import { DraftError, DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import { MessageRefService } from '../../apps/api/src/modules/m17-whatsapp/message-ref.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let customers: CustomerService;
let catalog: CatalogService;
let drafts: DraftService;
let areaId: string;
let slotId: string;
let methodId: string;

const audit = new AuditService();
const outbox = new OutboxService();
const agent: StaffContext = {
  staffId: 'agent-1', name: 'Agent', email: 'agent@t', locale: 'en', roles: ['order_agent'], sessionId: 's',
};

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

async function seedOpsMasters() {
  areaId = newId();
  slotId = newId();
  methodId = newId();
  await pool.query(
    `INSERT INTO area (id, code, name_en, name_ar) VALUES ($1,'kuwait-city','Kuwait City','Kuwait City')`,
    [areaId],
  );
  await pool.query(
    `INSERT INTO delivery_slot (id, label_en, label_ar, start_time, end_time, capacity)
     VALUES ($1,'Morning','Morning','08:00','11:00',NULL)`,
    [slotId],
  );
  await pool.query(
    `INSERT INTO delivery_method (id, name_en, name_ar) VALUES ($1,'Delivery','Delivery')`,
    [methodId],
  );
}

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
  await seedOpsMasters();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedCustomerWithAddress(name: string, phone: string) {
  const customerId = await customers.createGuided(agent, { fullNameEn: name, phone });
  const addressId = await customers.addAddress(agent, customerId, {
    areaId,
    addressText: 'Block 1, Street 2, House 3',
  });
  return { customerId, addressId };
}

describe('TS-U unit — draft completeness engine and incomplete queue (WP-07)', () => {
  it('saves incomplete WhatsApp drafts but blocks submit until mandatory fields and ref are present', async () => {
    const created = await drafts.createDraft(agent, {
      channel: 'whatsapp',
      unverifiedCustomer: true,
      unverifiedReason: 'Customer sent order from WhatsApp',
    });
    const draft = await drafts.getDraft(created.id);
    expect(draft.state).toBe('open');
    expect(draft.completeness.missing).toEqual(expect.arrayContaining([
      'whatsapp_reference',
      'selection',
      'start_date',
      'address',
      'area',
      'delivery_slot',
      'delivery_method',
      'expected_payment_method',
    ]));

    await expect(drafts.submitDraft(agent, created.id)).rejects.toMatchObject({ code: 'validation_failed' });
    const queue = await drafts.incompleteQueue();
    expect(queue.map((d) => d.id)).toContain(created.id);
  });

  it('submits a complete WhatsApp draft through the config-seeded draft transition', async () => {
    const { customerId, addressId } = await seedCustomerWithAddress('Complete Customer', '0551001001');
    const packageId = await catalog.createPackage(agent, { nameEn: 'Monthly Plan', nameAr: 'Monthly Plan' }, 'import');
    const created = await drafts.createDraft(agent, {
      channel: 'whatsapp',
      customerId,
      packageId,
      startDate: tomorrow(),
      addressId,
      slotId,
      methodId,
      expectedPaymentMethod: 'online_link',
      whatsappRef: { senderPhone: '0551001001', messageAt: new Date().toISOString(), refNote: 'manual copy' },
    });
    expect((await drafts.getDraft(created.id)).completeness.missing).toEqual([]);
    await drafts.submitDraft(agent, created.id);
    const submitted = await drafts.getDraft(created.id);
    expect(submitted.state).toBe('submitted');
    const evt = await pool.query(
      `SELECT 1 FROM outbox_event WHERE event_type = 'order.submitted' AND refs->>'draft_order' = $1`,
      [created.id],
    );
    expect(evt.rowCount).toBe(1);
  });

  it('keeps submitted drafts immutable for OA edits until review returns/reopens them', async () => {
    const { customerId, addressId } = await seedCustomerWithAddress('Immutable Customer', '0551001002');
    const packageId = await catalog.createPackage(agent, { nameEn: 'Trial Plan', nameAr: 'Trial Plan' }, 'import');
    const created = await drafts.createDraft(agent, {
      channel: 'phone', customerId, packageId, startDate: tomorrow(), addressId,
      slotId, methodId, expectedPaymentMethod: 'cash',
    });
    await drafts.submitDraft(agent, created.id);
    const submitted = await drafts.getDraft(created.id);
    await expect(drafts.updateDraft(agent, created.id, { version: submitted.version, notes: 'late edit' }))
      .rejects.toBeInstanceOf(DraftError);
  });
});

describe('TS-U unit — allergy conflict computation (WP-07)', () => {
  it('computes customer allergy conflicts from product declared allergens', async () => {
    const { customerId, addressId } = await seedCustomerWithAddress('Allergy Customer', '0551001003');
    const allergenId = newId();
    await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,'Peanut','Peanut')`, [allergenId]);
    await customers.setAllergy(agent, customerId, { allergenId, severity: 'severe' });
    const productId = await catalog.createProduct(agent, { nameEn: 'Peanut Salad', nameAr: 'Peanut Salad' }, 'import');
    await catalog.declareAllergen(agent, productId, allergenId);

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
    const draft = await drafts.getDraft(created.id);
    expect(draft.allergy_conflicts).toHaveLength(1);
    expect(draft.allergy_conflicts[0]).toMatchObject({ allergen_name: 'Peanut', severity: 'severe' });
    expect(draft.completeness.warnings.some((w) => w.field === 'allergy_conflicts')).toBe(true);
  });
});

describe('TS-U unit — draft date handling (review fixes)', () => {
  // review fix: M01 serialized pg `date` values via toISOString(), shifting the
  // calendar day by -1 on machines east of UTC (M03 was fixed under A10; M01 was not).
  it('round-trips start/end dates exactly as stored regardless of host timezone', async () => {
    const created = await drafts.createDraft(agent, {
      channel: 'phone',
      unverifiedCustomer: true,
      unverifiedReason: 'date round-trip check',
      startDate: '2099-07-01',
      endDate: '2099-07-05',
    });
    const draft = await drafts.getDraft(created.id);
    expect(draft.start_date).toBe('2099-07-01');
    expect(draft.end_date).toBe('2099-07-05');
  });

  // review fix: ASM-015 — backdated start is an OM override; the OM_BACKDATE_OVERRIDE
  // marker previously worked for ANY role.
  it('rejects the backdate override marker from non-OM roles and accepts it from OM', async () => {
    const localDate = (offsetDays: number) => {
      const d = new Date(Date.now() + offsetDays * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const om: StaffContext = {
      staffId: 'om-1', name: 'Ops', email: 'om@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-om',
    };
    await expect(drafts.createDraft(agent, {
      channel: 'phone',
      unverifiedCustomer: true,
      unverifiedReason: 'OM_BACKDATE_OVERRIDE',
      startDate: localDate(-2),
    })).rejects.toMatchObject({ code: 'validation_failed', detail: { rule: 'backdate_override_requires_om' } });

    const allowed = await drafts.createDraft(om, {
      channel: 'phone',
      unverifiedCustomer: true,
      unverifiedReason: 'OM_BACKDATE_OVERRIDE',
      startDate: localDate(-2),
    });
    expect((await drafts.getDraft(allowed.id)).start_date).toBe(localDate(-2));
  });
});

describe('TS-U unit — draft aging alerts (WP-07)', () => {
  it('fires one outbox alert per aged open draft', async () => {
    const created = await drafts.createDraft(agent, {
      channel: 'phone',
      unverifiedCustomer: true,
      unverifiedReason: 'Waiting for missing details',
    });
    await pool.query(`UPDATE draft_order SET created_at = now() - interval '6 hours' WHERE id = $1`, [created.id]);
    const first = await drafts.fireAgingAlerts();
    const second = await drafts.fireAgingAlerts();
    expect(first).toContain(created.id);
    expect(second).not.toContain(created.id);
    const evt = await pool.query(
      `SELECT 1 FROM outbox_event WHERE event_type = 'order.draft_aging_alert' AND refs->>'draft' = $1`,
      [created.id],
    );
    expect(evt.rowCount).toBe(1);
  });
});
