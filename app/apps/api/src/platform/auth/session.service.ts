import type { Pool } from 'pg';
import { withTransaction } from '../db/tx';
import { AuditService } from '../audit/audit.service';
import { SettingsReader } from '../settings/settings-reader';
import { newId } from '../ids';
import { verifyPassword } from './password';

export interface StaffContext {
  staffId: string;
  name: string;
  email: string;
  locale: string;
  roles: string[];
  sessionId: string;
}

export class AuthError extends Error {
  constructor(readonly code: 'invalid_credentials' | 'locked' | 'no_session') {
    super(code);
  }
}

// Server-side sessions in the session table (GAP-SEC-04 lesson: real logout, idle
// timeout, lockout — all revocable server state). auth.* events are audit-only,
// never on the outbox (security off-bus rule).
export class SessionService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly settings: SettingsReader,
  ) {}

  async login(email: string, password: string, source: Record<string, unknown>): Promise<StaffContext> {
    const { rows } = await this.pool.query(
      `SELECT id, name_en, email, locale, active, password_hash, failed_logins
       FROM staff_user WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    const threshold = await this.settings.get<number>('login_lockout_threshold', 5);

    if (!user || !user.active || !user.password_hash) {
      await this.auditFailedLogin(email, source, 'warn');
      throw new AuthError('invalid_credentials');
    }
    if (user.failed_logins >= threshold) {
      await this.auditFailedLogin(email, source, 'high');
      throw new AuthError('locked'); // unlock = staff.update by Admin/SA [Proposed]
    }
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) {
      const failed = user.failed_logins + 1;
      await withTransaction(this.pool, async (c) => {
        await c.query('UPDATE staff_user SET failed_logins = $2, updated_at = now() WHERE id = $1', [
          user.id, failed,
        ]);
        await this.audit.writeInTx(c, {
          eventType: 'auth.failed_login',
          actor: 'system',
          entityType: 'staff_user',
          entityId: user.id,
          severity: failed >= threshold ? 'high' : 'warn',
          after: { failed_logins: failed },
        });
      });
      throw new AuthError('invalid_credentials');
    }

    const idleMinutes = await this.settings.get<number>('session_idle_minutes', 60);
    const sessionId = newId();
    const roles = await this.rolesOf(user.id);
    await withTransaction(this.pool, async (c) => {
      await c.query('UPDATE staff_user SET failed_logins = 0, updated_at = now() WHERE id = $1', [user.id]);
      await c.query(
        `INSERT INTO session (id, staff_id, expires_at, source)
         VALUES ($1,$2, now() + make_interval(mins => $3), $4)`,
        [sessionId, user.id, idleMinutes, JSON.stringify(source)],
      );
      await this.audit.writeInTx(c, {
        eventType: 'auth.login',
        actor: { id: user.id, role: roles[0] ?? 'none' },
        entityType: 'session',
        entityId: sessionId,
        severity: 'info',
        source,
      });
    });
    return { staffId: user.id, name: user.name_en, email: user.email, locale: user.locale, roles, sessionId };
  }

  async validate(sessionId: string): Promise<StaffContext> {
    const { rows } = await this.pool.query(
      `SELECT s.id AS session_id, u.id, u.name_en, u.email, u.locale
       FROM session s JOIN staff_user u ON u.id = s.staff_id
       WHERE s.id = $1 AND s.ended_at IS NULL AND s.expires_at > now() AND u.active`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) throw new AuthError('no_session');
    const idleMinutes = await this.settings.get<number>('session_idle_minutes', 60);
    await this.pool.query(
      'UPDATE session SET expires_at = now() + make_interval(mins => $2) WHERE id = $1',
      [sessionId, idleMinutes], // sliding idle expiry
    );
    const roles = await this.rolesOf(row.id);
    return { staffId: row.id, name: row.name_en, email: row.email, locale: row.locale, roles, sessionId };
  }

  async logout(ctx: StaffContext): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      await c.query('UPDATE session SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [ctx.sessionId]);
      await this.audit.writeInTx(c, {
        eventType: 'auth.logout',
        actor: { id: ctx.staffId, role: ctx.roles[0] ?? 'none' },
        entityType: 'session',
        entityId: ctx.sessionId,
        severity: 'info',
      });
    });
  }

  private async rolesOf(staffId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT r.code FROM role_assignment ra JOIN role r ON r.id = ra.role_id
       WHERE ra.staff_id = $1 AND r.active ORDER BY r.code`,
      [staffId],
    );
    return rows.map((r) => r.code as string);
  }

  private async auditFailedLogin(email: string, source: Record<string, unknown>, severity: 'warn' | 'high') {
    await withTransaction(this.pool, (c) =>
      this.audit.writeInTx(c, {
        eventType: 'auth.failed_login',
        actor: 'system',
        entityType: 'staff_user',
        entityId: `email:${email}`, // unknown account — no user id to reference
        severity,
        source,
      }),
    );
  }
}
