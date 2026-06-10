import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditReadQueue, AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { normalizePhone } from '../../apps/api/src/modules/m04-customers/phone';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let customers: CustomerService;
let readQueue: AuditReadQueue;
const agent: StaffContext = { staffId: 'agent-1', name: 'A', email: 'a@t', locale: 'en', roles: ['order_agent'], sessionId: 's' };

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  readQueue = new AuditReadQueue(pool, audit);
  customers = new CustomerService(pool, audit, readQueue, new OutboxService(), new SettingsReader(pool, 0));
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-U unit — phone normalization (DM-03, dedup foundation)', () => {
  it('normalizes local, international, and 00-prefixed formats', () => {
    expect(normalizePhone('0501234567', '+966')).toBe('+966501234567');
    expect(normalizePhone('+966 50 123 4567', '+966')).toBe('+966501234567');
    expect(normalizePhone('00966501234567', '+966')).toBe('+966501234567');
    expect(normalizePhone('050-123-4567', '+966')).toBe('+966501234567');
  });
  it('rejects unparseable input (raw preserved separately)', () => {
    expect(() => normalizePhone('not a phone', '+966')).toThrow();
    expect(() => normalizePhone('', '+966')).toThrow();
  });
});

describe('TS-U unit — guided creation + duplicate detection (GAP-DQ-01/ADM-01)', () => {
  it('creates with normalized primary phone and audits + emits customer.created', async () => {
    const id = await customers.createGuided(agent, {
      fullNameEn: 'Sara Ahmed', phone: '0551112222', whatsapp: true,
    });
    const phone = await pool.query('SELECT phone_normalized, is_primary FROM customer_phone WHERE customer_id = $1', [id]);
    expect(phone.rows[0]).toMatchObject({ phone_normalized: '+966551112222', is_primary: true });
    const evt = await pool.query(`SELECT 1 FROM outbox_event WHERE event_type = 'customer.created' AND refs->>'customer' = $1`, [id]);
    expect(evt.rowCount).toBe(1);
  });

  it('exact-phone duplicate BLOCKS with a link to the existing profile', async () => {
    await expect(
      customers.createGuided(agent, { fullNameEn: 'Other Person', phone: '055 111 2222' }),
    ).rejects.toMatchObject({ code: 'duplicate_phone' });
  });

  it('fuzzy name+dob match WARNS and requires force to proceed', async () => {
    await customers.createGuided(agent, { fullNameEn: 'Omar Khan', dob: '1990-01-01', phone: '0552223333' });
    await expect(
      customers.createGuided(agent, { fullNameEn: 'omar khan', dob: '1990-01-01', phone: '0553334444' }),
    ).rejects.toMatchObject({ code: 'possible_duplicate' });
    const id = await customers.createGuided(agent, {
      fullNameEn: 'omar khan', dob: '1990-01-01', phone: '0553334444', force: true,
    });
    const evt = await pool.query(
      `SELECT after FROM audit_event WHERE event_type = 'customer.created' AND entity_id = $1`, [id],
    );
    expect(evt.rows[0].after.forced_past_fuzzy).toBe(true); // override visible in audit
  });

  it('search-by-phone finds across formats', async () => {
    const hits = await customers.searchByPhone('00966551112222');
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ full_name_en: 'Sara Ahmed' });
  });
});

describe('TS-U unit — profile reads logged per visibility class (BR-043)', () => {
  it('pii panel logs customer.pii_viewed; health panel adds customer.health_viewed', async () => {
    const id = await customers.createGuided(agent, { fullNameEn: 'Reader Test', phone: '0554445555' });
    const allergen = newId();
    await pool.query(
      `INSERT INTO allergen (id, name_en, name_ar) VALUES ($1, 'Peanut', 'فول سوداني')`, [allergen],
    );
    await customers.setAllergy(agent, id, { allergenId: allergen, severity: 'severe' });

    await customers.getProfile(agent, id, false);
    await customers.getProfile(agent, id, true);
    await readQueue.drain();

    const counts = await pool.query(
      `SELECT event_type, count(*)::int AS n FROM audit_event
       WHERE entity_id = $1 AND event_type IN ('customer.pii_viewed','customer.health_viewed')
       GROUP BY event_type`,
      [id],
    );
    const byType = Object.fromEntries(counts.rows.map((r) => [r.event_type, r.n]));
    expect(byType['customer.pii_viewed']).toBe(2);
    expect(byType['customer.health_viewed']).toBe(1);
  });

  it('update audits changed fields only', async () => {
    const id = await customers.createGuided(agent, { fullNameEn: 'Before Name', phone: '0555556666' });
    await customers.update(agent, id, { email: 'x@y.z' }); // A1 field in action
    const evt = await pool.query(
      `SELECT before, after FROM audit_event WHERE event_type = 'customer.updated' AND entity_id = $1`, [id],
    );
    expect(evt.rows[0].before).toEqual({ email: null });
    expect(evt.rows[0].after).toEqual({ email: 'x@y.z' });
  });
});
