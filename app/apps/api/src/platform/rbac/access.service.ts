import type { Pool } from 'pg';
import { withTransaction } from '../db/tx';
import { AuditService } from '../audit/audit.service';
import { SettingsReader } from '../settings/settings-reader';

export type EnforcementMode = 'log' | 'warn' | 'deny';
export type VisibilityClass = 'pii' | 'health' | 'payment';

export interface AccessDecision {
  allowed: boolean;   // matrix verdict
  enforced: boolean;  // true => caller must reject (deny mode and not allowed)
  mode: EnforcementMode;
}

// M13 staged enforcement (backend_foundation §3 item 3): per-role mode from the
// rbac_enforcement_mode setting; would-deny in log/warn modes is audited, not blocked.
// Matrix lives in role_permission (single source — TS-R generates its cases from it).
export class AccessService {
  private matrix: Map<string, Set<string>> | null = null;
  private grants: Map<string, Set<VisibilityClass>> | null = null;
  private loadedAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly settings: SettingsReader,
    private readonly ttlMs = 10_000,
  ) {}

  async decide(roles: string[], permission: string, actorId: string): Promise<AccessDecision> {
    await this.ensureLoaded();
    const allowed = roles.some((r) => this.matrix?.get(r)?.has(permission) ?? false);
    const mode = await this.modeFor(roles);
    const enforced = !allowed && mode === 'deny';
    if (!allowed) {
      // would-deny trail powers the staged rollout review (log -> warn -> deny)
      await withTransaction(this.pool, (c) =>
        this.audit.writeInTx(c, {
          eventType: 'rbac.would_deny',
          actor: { id: actorId, role: roles[0] ?? 'none' },
          entityType: 'permission',
          entityId: permission,
          severity: mode === 'deny' ? 'warn' : 'info',
          after: { roles, mode, enforced },
        }),
      );
    }
    return { allowed, enforced, mode };
  }

  /** Union of visibility-class grants across the caller's roles (masking input). */
  async visibilityGrants(roles: string[]): Promise<Set<VisibilityClass>> {
    await this.ensureLoaded();
    const out = new Set<VisibilityClass>();
    for (const r of roles) for (const g of this.grants?.get(r) ?? []) out.add(g);
    return out;
  }

  invalidate(): void {
    this.matrix = null;
    this.grants = null;
  }

  private async modeFor(roles: string[]): Promise<EnforcementMode> {
    const map = await this.settings.get<Record<string, EnforcementMode>>('rbac_enforcement_mode', {});
    // strictest mode among the caller's roles wins
    const rank: Record<EnforcementMode, number> = { log: 0, warn: 1, deny: 2 };
    let mode: EnforcementMode = 'log';
    for (const r of roles) {
      const m = map[r] ?? 'log';
      if (rank[m] > rank[mode]) mode = m;
    }
    return mode;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.matrix && Date.now() - this.loadedAt < this.ttlMs) return;
    const { rows } = await this.pool.query(
      `SELECT r.code AS role_code, p.code AS perm_code, p.visibility_grants
       FROM role_permission rp
       JOIN role r ON r.id = rp.role_id
       JOIN permission p ON p.id = rp.permission_id`,
    );
    const matrix = new Map<string, Set<string>>();
    const grants = new Map<string, Set<VisibilityClass>>();
    for (const row of rows) {
      if (!matrix.has(row.role_code)) matrix.set(row.role_code, new Set());
      matrix.get(row.role_code)?.add(row.perm_code);
      if (!grants.has(row.role_code)) grants.set(row.role_code, new Set());
      for (const g of row.visibility_grants as VisibilityClass[]) grants.get(row.role_code)?.add(g);
    }
    this.matrix = matrix;
    this.grants = grants;
    this.loadedAt = Date.now();
  }
}
