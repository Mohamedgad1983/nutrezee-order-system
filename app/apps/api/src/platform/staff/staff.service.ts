import type { Pool } from 'pg';
import { withTransaction } from '../db/tx';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/session.service';
import { hashPassword } from '../auth/password';
import { newId } from '../ids';

export class StaffAdminError extends Error {
  constructor(readonly code: 'email_taken' | 'not_found' | 'level_cap' | 'self_deactivate') {
    super(code);
  }
}

// Role rank for the level-cap rule [Proposed — RBAC matrix sign-off S8]:
// admin cannot create/modify/deactivate super_admins; nobody self-deactivates.
const RANK: Record<string, number> = { super_admin: 2, admin: 1 };
const rankOf = (roles: string[]) => Math.max(0, ...roles.map((r) => RANK[r] ?? 0));

export interface StaffInput {
  nameEn: string;
  nameAr?: string;
  email: string;
  phone?: string;
  locale?: 'en' | 'ar';
  password?: string;
}

// M12 staff lifecycle: create / update (diff-audited) / deactivate-never-delete.
// All writes audited HIGH in the same transaction (staff.* events, security off-bus).
export class StaffService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  async create(actor: StaffContext, input: StaffInput): Promise<string> {
    const id = newId();
    const pwd = input.password ? await hashPassword(input.password) : null;
    try {
      await withTransaction(this.pool, async (c) => {
        await c.query(
          `INSERT INTO staff_user (id, name_en, name_ar, email, phone, locale, password_hash, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, input.nameEn, input.nameAr ?? null, input.email, input.phone ?? null,
           input.locale ?? 'en', pwd, actor.staffId],
        );
        await this.audit.writeInTx(c, {
          eventType: 'staff.created',
          actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
          entityType: 'staff_user', entityId: id, severity: 'high',
          after: { name_en: input.nameEn, email: input.email, locale: input.locale ?? 'en' },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new StaffAdminError('email_taken');
      throw e;
    }
    return id;
  }

  async update(
    actor: StaffContext,
    staffId: string,
    patch: Partial<Pick<StaffInput, 'nameEn' | 'nameAr' | 'phone' | 'locale'>> & { resetFailedLogins?: boolean },
  ): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      const target = await this.lockTarget(c, staffId, actor);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const sets: string[] = ['updated_at = now()', 'updated_by = $2', 'version = version + 1'];
      const params: unknown[] = [staffId, actor.staffId];
      const apply = (col: string, key: string, val: unknown, old: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
        before[key] = old;
        after[key] = val;
      };
      if (patch.nameEn !== undefined) apply('name_en', 'name_en', patch.nameEn, target.name_en);
      if (patch.nameAr !== undefined) apply('name_ar', 'name_ar', patch.nameAr, target.name_ar);
      if (patch.phone !== undefined) apply('phone', 'phone', patch.phone, target.phone);
      if (patch.locale !== undefined) apply('locale', 'locale', patch.locale, target.locale);
      if (patch.resetFailedLogins) apply('failed_logins', 'failed_logins', 0, target.failed_logins);
      await c.query(`UPDATE staff_user SET ${sets.join(', ')} WHERE id = $1`, params);
      await this.audit.writeInTx(c, {
        eventType: 'staff.updated',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'staff_user', entityId: staffId, severity: 'high',
        before, after, // changed fields only (audit_architecture schema)
      });
    });
  }

  async deactivate(actor: StaffContext, staffId: string): Promise<void> {
    if (staffId === actor.staffId) throw new StaffAdminError('self_deactivate');
    await withTransaction(this.pool, async (c) => {
      await this.lockTarget(c, staffId, actor);
      await c.query(
        'UPDATE staff_user SET active = false, updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1',
        [staffId, actor.staffId],
      );
      await c.query('UPDATE session SET ended_at = now() WHERE staff_id = $1 AND ended_at IS NULL', [staffId]);
      await this.audit.writeInTx(c, {
        eventType: 'staff.deactivated',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'staff_user', entityId: staffId, severity: 'high',
        before: { active: true }, after: { active: false, sessions_ended: true },
      });
    });
  }

  async list(): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.name_en, u.name_ar, u.email, u.phone, u.active, u.locale,
              coalesce(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
       FROM staff_user u
       LEFT JOIN role_assignment ra ON ra.staff_id = u.id
       LEFT JOIN role r ON r.id = ra.role_id
       GROUP BY u.id ORDER BY u.name_en`,
    );
    return rows;
  }

  /** Lock the row, enforce the level cap (admin cannot touch a super_admin). */
  private async lockTarget(
    c: import('pg').PoolClient,
    staffId: string,
    actor: StaffContext,
  ): Promise<Record<string, unknown> & { name_en: string }> {
    const { rows } = await c.query('SELECT * FROM staff_user WHERE id = $1 FOR UPDATE', [staffId]);
    if (rows.length === 0) throw new StaffAdminError('not_found');
    const targetRoles = (
      await c.query(
        `SELECT r.code FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.staff_id = $1`,
        [staffId],
      )
    ).rows.map((r) => r.code as string);
    if (rankOf(targetRoles) > rankOf(actor.roles)) throw new StaffAdminError('level_cap');
    return rows[0];
  }
}
