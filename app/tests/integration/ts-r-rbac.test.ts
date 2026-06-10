import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { AccessService } from '../../apps/api/src/platform/rbac/access.service';

// TS-R is GENERATED from the seeded matrix (test_strategy: "generated from the M13
// config, not hand-written") — the case list below is queried from role_permission at
// runtime, so workshop edits to the matrix cannot drift from the tests.
let pool: Pool;
let access: AccessService;
let settings: SettingsReader;

beforeAll(async () => {
  pool = await freshDb();
  settings = new SettingsReader(pool, 0); // no cache: tests mutate the mode setting
  access = new AccessService(pool, new AuditService(), settings, 0);
}, 60_000);
afterAll(async () => {
  await pool.end();
});

async function matrixFromDb() {
  const roles = (await pool.query('SELECT code FROM role ORDER BY code')).rows.map((r) => r.code as string);
  const perms = (await pool.query('SELECT code FROM permission ORDER BY code')).rows.map((r) => r.code as string);
  const granted = new Set(
    (
      await pool.query(
        `SELECT r.code AS rc, p.code AS pc FROM role_permission rp
         JOIN role r ON r.id = rp.role_id JOIN permission p ON p.id = rp.permission_id`,
      )
    ).rows.map((row) => `${row.rc}::${row.pc}`),
  );
  return { roles, perms, granted };
}

describe('TS-R rbac — matrix-generated allow/deny (log mode)', () => {
  it('decide() matches role_permission for every role × permission', async () => {
    const { roles, perms, granted } = await matrixFromDb();
    expect(roles.length).toBe(12);
    expect(perms.length).toBeGreaterThanOrEqual(11);
    for (const role of roles) {
      for (const perm of perms) {
        const expected = granted.has(`${role}::${perm}`);
        const d = await access.decide([role], perm, 'test-actor');
        expect(d.allowed, `${role} -> ${perm}`).toBe(expected);
        expect(d.enforced, `log mode never enforces (${role} -> ${perm})`).toBe(false);
      }
    }
  }, 120_000);
});

describe('TS-R rbac — staged enforcement modes', () => {
  async function setMode(role: string, mode: 'log' | 'warn' | 'deny') {
    await pool.query(
      `UPDATE setting SET value = (value::jsonb || jsonb_build_object($1::text, $2::text))::jsonb
       WHERE key = 'rbac_enforcement_mode'`,
      [role, mode],
    );
    settings.clear();
    access.invalidate();
  }

  it('warn mode: would-deny is recorded but not enforced', async () => {
    await setMode('report_viewer', 'warn');
    const d = await access.decide(['report_viewer'], 'staff.create', 'test-actor');
    expect(d).toMatchObject({ allowed: false, enforced: false, mode: 'warn' });
  });

  it('deny mode: non-granted permission is enforced; granted still allowed', async () => {
    await setMode('report_viewer', 'deny');
    const denied = await access.decide(['report_viewer'], 'staff.create', 'test-actor');
    expect(denied).toMatchObject({ allowed: false, enforced: true, mode: 'deny' });
    const allowed = await access.decide(['report_viewer'], 'settings.read', 'test-actor');
    expect(allowed).toMatchObject({ allowed: true, enforced: false });
  });

  it('full matrix sweep in WARN mode: never enforced (WP-02 DoD)', async () => {
    const { roles, perms, granted } = await matrixFromDb();
    for (const role of roles) await setMode(role, 'warn');
    for (const role of roles) {
      for (const perm of perms) {
        const d = await access.decide([role], perm, 'test-actor');
        expect(d.allowed).toBe(granted.has(`${role}::${perm}`));
        expect(d.enforced).toBe(false);
      }
    }
  }, 120_000);

  it('full matrix sweep in DENY mode: enforced exactly when not granted (WP-02 DoD)', async () => {
    const { roles, perms, granted } = await matrixFromDb();
    for (const role of roles) await setMode(role, 'deny');
    for (const role of roles) {
      for (const perm of perms) {
        const expected = granted.has(`${role}::${perm}`);
        const d = await access.decide([role], perm, 'test-actor');
        expect(d.allowed).toBe(expected);
        expect(d.enforced).toBe(!expected);
      }
    }
    for (const role of roles) await setMode(role, 'log'); // restore
  }, 120_000);

  it('would-deny decisions leave an audit trail', async () => {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE event_type = 'rbac.would_deny'",
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('visibility grants aggregate across roles (masking input)', async () => {
    const grants = await access.visibilityGrants(['admin']);
    expect(grants.has('pii')).toBe(true); // staff.read carries ["pii"]
    const none = await access.visibilityGrants(['driver']);
    expect(none.has('pii')).toBe(false);
  });
});
