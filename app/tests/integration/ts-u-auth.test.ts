import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { AuthError, SessionService } from '../../apps/api/src/platform/auth/session.service';
import { hashPassword } from '../../apps/api/src/platform/auth/password';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let sessions: SessionService;

beforeAll(async () => {
  pool = await freshDb();
  sessions = new SessionService(pool, new AuditService(), new SettingsReader(pool, 0));
  const staffId = newId();
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, password_hash, created_by)
     VALUES ($1, 'Test Agent', 'agent@test.local', $2, 'test')`,
    [staffId, await hashPassword('correct-horse')],
  );
  await pool.query(
    `INSERT INTO role_assignment (id, staff_id, role_id, assigned_by)
     SELECT $1, $2, id, 'test' FROM role WHERE code = 'order_agent'`,
    [newId(), staffId],
  );
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-U unit — auth/session (server-side sessions, GAP-SEC-04 lesson)', () => {
  it('login creates a session, returns roles, and audits auth.login', async () => {
    const ctx = await sessions.login('agent@test.local', 'correct-horse', { surface: 'test' });
    expect(ctx.roles).toContain('order_agent');
    const s = await pool.query('SELECT 1 FROM session WHERE id = $1 AND ended_at IS NULL', [ctx.sessionId]);
    expect(s.rowCount).toBe(1);
    const a = await pool.query(
      "SELECT 1 FROM audit_event WHERE event_type = 'auth.login' AND entity_id = $1",
      [ctx.sessionId],
    );
    expect(a.rowCount).toBe(1);
  });

  it('logout ends the session (real logout — revocable server state) and audits it', async () => {
    const ctx = await sessions.login('agent@test.local', 'correct-horse', { surface: 'test' });
    await sessions.logout(ctx);
    await expect(sessions.validate(ctx.sessionId)).rejects.toThrow(AuthError);
    const a = await pool.query(
      "SELECT 1 FROM audit_event WHERE event_type = 'auth.logout' AND entity_id = $1",
      [ctx.sessionId],
    );
    expect(a.rowCount).toBe(1);
  });

  it('validate slides the idle expiry forward', async () => {
    const ctx = await sessions.login('agent@test.local', 'correct-horse', { surface: 'test' });
    const before = await pool.query('SELECT expires_at FROM session WHERE id = $1', [ctx.sessionId]);
    await new Promise((r) => setTimeout(r, 30));
    await sessions.validate(ctx.sessionId);
    const after = await pool.query('SELECT expires_at FROM session WHERE id = $1', [ctx.sessionId]);
    expect(new Date(after.rows[0].expires_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].expires_at).getTime(),
    );
  });

  it('wrong password increments failed_logins, audits, and lockout threshold locks the account', async () => {
    const staffId = newId();
    await pool.query(
      `INSERT INTO staff_user (id, name_en, email, password_hash, created_by)
       VALUES ($1, 'Lock Me', 'lockme@test.local', $2, 'test')`,
      [staffId, await hashPassword('right')],
    );
    for (let i = 0; i < 5; i += 1) {
      await expect(sessions.login('lockme@test.local', 'wrong', { surface: 'test' }))
        .rejects.toMatchObject({ code: 'invalid_credentials' });
    }
    // threshold (seeded: 5) reached — even the CORRECT password is now rejected as locked
    await expect(sessions.login('lockme@test.local', 'right', { surface: 'test' }))
      .rejects.toMatchObject({ code: 'locked' });
    const high = await pool.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE event_type = 'auth.failed_login' AND severity = 'high'",
    );
    expect(high.rows[0].n).toBeGreaterThan(0); // lockout escalation audited HIGH
  });

  it('unknown account fails closed with the same error (no user enumeration)', async () => {
    await expect(sessions.login('ghost@test.local', 'x', { surface: 'test' }))
      .rejects.toMatchObject({ code: 'invalid_credentials' });
  });
});
