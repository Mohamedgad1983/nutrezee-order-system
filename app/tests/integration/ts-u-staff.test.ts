import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { AccessService } from '../../apps/api/src/platform/rbac/access.service';
import { RoleAdminService } from '../../apps/api/src/platform/rbac/role-admin.service';
import { StaffService } from '../../apps/api/src/platform/staff/staff.service';
import { AuthError, SessionService, type StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let staff: StaffService;
let roles: RoleAdminService;
let sessions: SessionService;

const sa: StaffContext = { staffId: 'sa-actor', name: 'SA', email: 'sa@x', locale: 'en', roles: ['super_admin'], sessionId: 's1' };
const admin: StaffContext = { staffId: 'ad-actor', name: 'AD', email: 'ad@x', locale: 'en', roles: ['admin'], sessionId: 's2' };

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  staff = new StaffService(pool, audit);
  roles = new RoleAdminService(pool, audit, new AccessService(pool, audit, new SettingsReader(pool, 0), 0));
  sessions = new SessionService(pool, audit, new SettingsReader(pool, 0));
  // actor rows must exist for role-rank lookups on themselves as targets
  for (const a of [sa, admin]) {
    await pool.query(
      `INSERT INTO staff_user (id, name_en, email, created_by) VALUES ($1,$2,$3,'test')`,
      [a.staffId, a.name, a.email],
    );
    await pool.query(
      `INSERT INTO role_assignment (id, staff_id, role_id, assigned_by)
       SELECT $1, $2, id, 'test' FROM role WHERE code = $3`,
      [newId(), a.staffId, a.roles[0]],
    );
  }
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-U unit — staff lifecycle (M12, audited HIGH)', () => {
  it('create is audited HIGH with after-values; duplicate email conflicts', async () => {
    const id = await staff.create(sa, { nameEn: 'Agent One', email: 'one@test.local', password: 'pw-123456' });
    const evt = await pool.query(
      "SELECT severity, after FROM audit_event WHERE event_type = 'staff.created' AND entity_id = $1", [id],
    );
    expect(evt.rows[0].severity).toBe('high');
    expect(evt.rows[0].after.email).toBe('one@test.local');
    await expect(staff.create(sa, { nameEn: 'Dup', email: 'one@test.local' }))
      .rejects.toMatchObject({ code: 'email_taken' });
  });

  it('update audits changed fields only (before/after diff)', async () => {
    const id = await staff.create(sa, { nameEn: 'Old Name', email: 'upd@test.local' });
    await staff.update(sa, id, { nameEn: 'New Name' });
    const evt = await pool.query(
      "SELECT before, after FROM audit_event WHERE event_type = 'staff.updated' AND entity_id = $1", [id],
    );
    expect(evt.rows[0].before).toEqual({ name_en: 'Old Name' });
    expect(evt.rows[0].after).toEqual({ name_en: 'New Name' });
  });

  it('deactivate ends open sessions and blocks login; never deletes', async () => {
    const id = await staff.create(sa, { nameEn: 'Leaver', email: 'leaver@test.local', password: 'pw-123456' });
    await pool.query(
      `INSERT INTO role_assignment (id, staff_id, role_id, assigned_by)
       SELECT $1, $2, id, 'test' FROM role WHERE code = 'order_agent'`, [newId(), id],
    );
    const ctx = await sessions.login('leaver@test.local', 'pw-123456', { surface: 'test' });
    await staff.deactivate(sa, id);
    await expect(sessions.validate(ctx.sessionId)).rejects.toThrow(AuthError); // session ended
    await expect(sessions.login('leaver@test.local', 'pw-123456', { surface: 'test' }))
      .rejects.toMatchObject({ code: 'invalid_credentials' }); // inactive
    const row = await pool.query('SELECT active FROM staff_user WHERE id = $1', [id]);
    expect(row.rows[0].active).toBe(false); // row still exists — deactivate, never delete
  });

  it('self-deactivation is blocked', async () => {
    await expect(staff.deactivate(sa, sa.staffId)).rejects.toMatchObject({ code: 'self_deactivate' });
  });

  it('level cap: admin cannot modify or deactivate a super_admin [Proposed]', async () => {
    await expect(staff.update(admin, sa.staffId, { nameEn: 'Hax' }))
      .rejects.toMatchObject({ code: 'level_cap' });
    await expect(staff.deactivate(admin, sa.staffId))
      .rejects.toMatchObject({ code: 'level_cap' });
  });
});

describe('TS-U unit — role grants via M13 only (C4), dormant alert', () => {
  it('grant + revoke are HIGH-audited; duplicate grant conflicts', async () => {
    const id = await staff.create(sa, { nameEn: 'Grantee', email: 'grantee@test.local' });
    await roles.grant(sa, id, 'finance');
    await expect(roles.grant(sa, id, 'finance')).rejects.toMatchObject({ code: 'already_granted' });
    await roles.revoke(sa, id, 'finance');
    await expect(roles.revoke(sa, id, 'finance')).rejects.toMatchObject({ code: 'not_granted' });
    const evts = await pool.query(
      `SELECT event_type, severity FROM audit_event
       WHERE entity_id = $1 ORDER BY occurred_at`, [`${id}:finance`],
    );
    expect(evts.rows.map((r) => [r.event_type, r.severity])).toEqual([
      ['rbac.role_assigned', 'high'], ['rbac.role_revoked', 'high'],
    ]);
  });

  it('granting a DORMANT role raises the alert marker (rbac_architecture)', async () => {
    const id = await staff.create(sa, { nameEn: 'Driver Candidate', email: 'driver@test.local' });
    await roles.grant(sa, id, 'driver'); // dormant role
    const evt = await pool.query(
      "SELECT after, reason FROM audit_event WHERE event_type = 'rbac.role_assigned' AND entity_id = $1",
      [`${id}:driver`],
    );
    expect(evt.rows[0].after.dormant_alert).toBe(true);
    expect(evt.rows[0].reason).toMatch(/DORMANT/);
  });

  it('level cap: admin cannot grant admin or super_admin [Proposed]', async () => {
    const id = await staff.create(sa, { nameEn: 'Target', email: 'target@test.local' });
    await expect(roles.grant(admin, id, 'super_admin')).rejects.toMatchObject({ code: 'level_cap' });
    await expect(roles.grant(admin, id, 'admin')).rejects.toMatchObject({ code: 'level_cap' });
    await roles.grant(admin, id, 'order_agent'); // below the cap — allowed
  });

  it('unknown role fails closed', async () => {
    await expect(roles.grant(sa, 'whoever', 'nonexistent')).rejects.toMatchObject({ code: 'unknown_role' });
  });

  it('matrix export exposes role -> permissions for the drift compare', async () => {
    const matrix = await roles.exportMatrix();
    expect(Object.keys(matrix).length).toBe(12);
    expect(matrix['super_admin'].permissions).toContain('rbac.role.grant');
    expect(matrix['driver'].dormant).toBe(true);
  });
});
