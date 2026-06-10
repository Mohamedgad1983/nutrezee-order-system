import type { Pool } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

export type ReconciliationType = 'daily_orders' | 'weekly_catalog' | 'payments';
export type ReconciliationState = 'ok' | 'divergent';

export class BridgeError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'not_enabled',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface ReconciliationRecord {
  id: string;
  run_type: ReconciliationType;
  counts: Record<string, unknown>;
  diffs: Record<string, unknown>;
  state: ReconciliationState;
  run_by: string | null;
  run_at: string;
}

const RECON_TYPES = new Set<ReconciliationType>(['daily_orders', 'weekly_catalog', 'payments']);

export class ReconciliationService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async record(
    actor: StaffContext,
    input: { runType?: string; counts?: Record<string, unknown>; diffs?: Record<string, unknown>; state?: ReconciliationState },
  ): Promise<ReconciliationRecord> {
    const runType = input.runType as ReconciliationType | undefined;
    if (!runType || !RECON_TYPES.has(runType)) throw new BridgeError('validation_failed', { field: 'run_type' });
    const counts = input.counts ?? {};
    const diffs = input.diffs ?? {};
    const state = input.state ?? (Object.keys(diffs).length > 0 ? 'divergent' : 'ok');
    if (state !== 'ok' && state !== 'divergent') throw new BridgeError('validation_failed', { field: 'state' });
    const id = newId();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO reconciliation_run (id, run_type, counts, diffs, state, run_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, runType, JSON.stringify(counts), JSON.stringify(diffs), state, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'bridge.reconciliation_run',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'reconciliation_run',
        entityId: id,
        severity: state === 'divergent' ? 'warn' : 'info',
        after: { run_type: runType, counts, diffs, state },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'bridge.reconciliation_run',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { reconciliation_run_id: id },
        payload: { run_type: runType, counts, diffs, state },
      });
    });
    const record = await this.get(id);
    if (!record) throw new BridgeError('not_found');
    return record;
  }

  async list(limit = 100): Promise<ReconciliationRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM reconciliation_run ORDER BY run_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => this.toRecord(r));
  }

  async get(id: string): Promise<ReconciliationRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM reconciliation_run WHERE id = $1`, [id]);
    return rows.length > 0 ? this.toRecord(rows[0]) : null;
  }

  private toRecord(row: Record<string, unknown>): ReconciliationRecord {
    return {
      id: row.id as string,
      run_type: row.run_type as ReconciliationType,
      counts: row.counts as Record<string, unknown>,
      diffs: row.diffs as Record<string, unknown>,
      state: row.state as ReconciliationState,
      run_by: row.run_by as string | null,
      run_at: new Date(row.run_at as Date).toISOString(),
    };
  }
}
