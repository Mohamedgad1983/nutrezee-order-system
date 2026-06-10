import type { Pool } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { FeatureFlagService, type FeatureFlagRecord } from '../../platform/feature-flags/feature-flag.service';
import { BridgeError } from './reconciliation.service';

export class CutoverFlagService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly flags: FeatureFlagService,
  ) {}

  async list(): Promise<FeatureFlagRecord[]> {
    return this.flags.list('cutover_');
  }

  async toggle(actor: StaffContext, key: string, onFlag: boolean, note?: string): Promise<FeatureFlagRecord> {
    if (!key.startsWith('cutover_')) throw new BridgeError('validation_failed', { field: 'key' });
    return withTransaction(this.pool, async (client) => {
      const flag = await this.flags.setInTx(client, key, onFlag, note, actor.staffId);
      await this.audit.writeInTx(client, {
        eventType: 'bridge.cutover_flag_changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'feature_flag',
        entityId: key,
        severity: 'high',
        after: { key, on_flag: onFlag, note: note ?? null },
      });
      return flag;
    });
  }
}
