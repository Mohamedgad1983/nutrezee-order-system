import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { SettingsService } from '../../apps/api/src/platform/settings/settings.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

let pool: Pool;
let reader: SettingsReader;
let service: SettingsService;
const ops: StaffContext = { staffId: 'ops-1', name: 'Ops', email: 'ops@t', locale: 'en', roles: ['ops_manager'], sessionId: 's' };

beforeAll(async () => {
  pool = await freshDb();
  reader = new SettingsReader(pool, 60_000); // LONG ttl — invalidation must come from the service
  service = new SettingsService(pool, new AuditService(), new OutboxService(), reader);
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-I integration — M16 settings (WP-03 DoD: invalidation proven)', () => {
  it('update invalidates the cached reader immediately (no TTL wait) and emits settings.changed', async () => {
    const before = await reader.get<number>('review_sla_minutes', 0);
    expect(before).toBe(120); // seeded — now cached for 60s
    await service.update(ops, 'review_sla_minutes', 90);
    const after = await reader.get<number>('review_sla_minutes', 0);
    expect(after).toBe(90); // would still be 120 if invalidation failed
    const evt = await pool.query(
      `SELECT 1 FROM outbox_event WHERE event_type = 'settings.changed' AND refs->>'setting' = 'review_sla_minutes'`,
    );
    expect(evt.rowCount).toBe(1);
  });

  it('typed validation: wrong type rejected; explicit null (unset) allowed; unknown key rejected', async () => {
    await expect(service.update(ops, 'review_sla_minutes', 'ninety')).rejects.toMatchObject({ code: 'type_mismatch' });
    await expect(service.update(ops, 'no_such_key', 1)).rejects.toMatchObject({ code: 'unknown_key' });
    await service.update(ops, 'kitchen_cutoff_time', '14:30'); // time format
    await expect(service.update(ops, 'kitchen_cutoff_time', '2pm')).rejects.toMatchObject({ code: 'type_mismatch' });
    await service.update(ops, 'kitchen_cutoff_time', null); // back to unset — allowed
  });

  it('gate keys audit HIGH; ordinary keys audit WARN (audit_architecture severities)', async () => {
    await service.update(ops, 'payment_gate', 'before_active');
    await service.update(ops, 'draft_retention_days', 21);
    const { rows } = await pool.query(
      `SELECT entity_id, severity FROM audit_event
       WHERE event_type = 'settings.changed' AND entity_id IN ('payment_gate','draft_retention_days')`,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.entity_id, r.severity]));
    expect(byKey['payment_gate']).toBe('high');
    expect(byKey['draft_retention_days']).toBe('warn');
  });

  it('preview validates without applying', async () => {
    const res = await service.preview('payment_gate', 'none');
    expect(res).toEqual({ key: 'payment_gate', ok: true, gate: true });
    const current = await pool.query(`SELECT value FROM setting WHERE key = 'payment_gate'`);
    expect(current.rows[0].value).toBe('before_active'); // unchanged by preview
  });

  it('cutover flags audit as bridge.cutover_flag_changed HIGH', async () => {
    await service.setFlag(ops, 'cutover_intake', true);
    const evt = await pool.query(
      `SELECT severity FROM audit_event WHERE event_type = 'bridge.cutover_flag_changed' AND entity_id = 'cutover_intake'`,
    );
    expect(evt.rows[0].severity).toBe('high');
    await service.setFlag(ops, 'cutover_intake', false); // restore
  });

  it('reason codes: add within a domain; unknown domain fails closed', async () => {
    await service.addReasonCode(ops, 'rejection', 'duplicate_order', 'Duplicate order');
    const row = await pool.query(
      `SELECT 1 FROM reason_code WHERE domain = 'rejection' AND code = 'duplicate_order'`,
    );
    expect(row.rowCount).toBe(1);
    await expect(service.addReasonCode(ops, 'no_such_domain', 'x', 'X'))
      .rejects.toMatchObject({ code: 'unknown_domain' });
  });

  it('ops masters remain editable: adding a section works and audits (DEC-006 content slot)', async () => {
    const id = await service.addMaster(ops, 'section_master', {
      code: 'test_hot', name_en: 'Test Hot Kitchen', name_ar: 'المطبخ الساخن',
    });
    const row = await pool.query('SELECT 1 FROM section_master WHERE id = $1', [id]);
    expect(row.rowCount).toBe(1);
    const evt = await pool.query(
      `SELECT 1 FROM audit_event WHERE entity_type = 'section_master' AND entity_id = $1`, [id],
    );
    expect(evt.rowCount).toBe(1);
  });
});
