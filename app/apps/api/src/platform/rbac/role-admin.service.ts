import type { Pool } from 'pg';
import { withTransaction } from '../db/tx';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/session.service';
import { AccessService } from './access.service';
import { newId } from '../ids';

export class RoleAdminError extends Error {
  constructor(readonly code: 'unknown_role' | 'level_cap' | 'already_granted' | 'not_granted') {
    super(code);
  }
}

const RANK: Record<string, number> = { super_admin: 2, admin: 1 };
const rankOf = (roles: string[]) => Math.max(0, ...roles.map((r) => RANK[r] ?? 0));

// M13 role administration — the ONLY write path to role_assignment (C4 resolution).
// Every grant/revoke is a HIGH audit event; granting a dormant role raises an explicit
// alert marker in the event (rbac_architecture: dormant grants alarmed until workshop
// legitimizes those roles). Security events stay off the outbox.
export class RoleAdminService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async grant(actor: StaffContext, staffId: string, roleCode: string): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      const role = await this.loadRole(c, roleCode);
      // level cap [Proposed]: an admin may not grant admin or super_admin
      if ((RANK[roleCode] ?? 0) >= 1 && rankOf(actor.roles) < 2) throw new RoleAdminError('level_cap');
      const inserted = await c.query(
        `INSERT INTO role_assignment (id, staff_id, role_id, assigned_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [newId(), staffId, role.id, actor.staffId],
      );
      if (inserted.rowCount === 0) throw new RoleAdminError('already_granted');
      await this.audit.writeInTx(c, {
        eventType: 'rbac.role_assigned',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'role_assignment', entityId: `${staffId}:${roleCode}`, severity: 'high',
        after: { staff_id: staffId, role: roleCode, dormant_alert: role.dormant === true },
        reason: role.dormant ? 'DORMANT ROLE GRANTED — review required (rbac_architecture)' : `grant ${roleCode}`,
      });
    });
    this.access.invalidate();
  }

  async revoke(actor: StaffContext, staffId: string, roleCode: string): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      const role = await this.loadRole(c, roleCode);
      if ((RANK[roleCode] ?? 0) >= 1 && rankOf(actor.roles) < 2) throw new RoleAdminError('level_cap');
      const deleted = await c.query(
        'DELETE FROM role_assignment WHERE staff_id = $1 AND role_id = $2',
        [staffId, role.id],
      );
      if (deleted.rowCount === 0) throw new RoleAdminError('not_granted');
      await this.audit.writeInTx(c, {
        eventType: 'rbac.role_revoked',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'role_assignment', entityId: `${staffId}:${roleCode}`, severity: 'high',
        before: { staff_id: staffId, role: roleCode }, reason: `revoke ${roleCode}`,
      });
    });
    this.access.invalidate();
  }

  /** Matrix export for the drift compare vs rbac_architecture.md (export-compare guard). */
  async exportMatrix(): Promise<Record<string, { permissions: string[]; dormant: boolean }>> {
    const { rows } = await this.pool.query(
      `SELECT r.code AS role_code, r.dormant,
              coalesce(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS perms
       FROM role r
       LEFT JOIN role_permission rp ON rp.role_id = r.id
       LEFT JOIN permission p ON p.id = rp.permission_id
       GROUP BY r.code, r.dormant ORDER BY r.code`,
    );
    const out: Record<string, { permissions: string[]; dormant: boolean }> = {};
    for (const row of rows) out[row.role_code] = { permissions: row.perms, dormant: row.dormant };
    return out;
  }

  private async loadRole(
    c: import('pg').PoolClient,
    code: string,
  ): Promise<{ id: string; dormant: boolean }> {
    const { rows } = await c.query('SELECT id, dormant FROM role WHERE code = $1 AND active', [code]);
    if (rows.length === 0) throw new RoleAdminError('unknown_role');
    return rows[0];
  }
}
