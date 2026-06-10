import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

export class MergeError extends Error {
  constructor(readonly code: 'not_found' | 'self_merge' | 'undo_expired' | 'already_undone') {
    super(code);
  }
}

/** Other modules register re-link steps (e.g. WP-07 re-points draft_order.customer_id).
 *  Each step runs inside the merge transaction and returns what it moved (for undo). */
export type RelinkStep = {
  name: string;
  merge: (client: PoolClient, winnerId: string, loserId: string) => Promise<unknown>;
  undo: (client: PoolClient, winnerId: string, loserId: string, moved: unknown) => Promise<void>;
};

// M04 soft-merge with undo window (logical model MergeRecord; ops-only per matrix).
// Child rows re-parent to the winner; the loser deactivates (never deleted); undo
// restores within merge_undo_days. customer.merged is a HIGH audit event.
export class MergeService {
  private readonly relinkSteps: RelinkStep[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsReader,
  ) {}

  registerRelinkStep(step: RelinkStep): void {
    this.relinkSteps.push(step);
  }

  async merge(actor: StaffContext, winnerId: string, loserId: string): Promise<string> {
    if (winnerId === loserId) throw new MergeError('self_merge');
    const undoDays = await this.settings.get<number>('merge_undo_days', 7);
    const mergeId = newId();

    await withTransaction(this.pool, async (c) => {
      for (const id of [winnerId, loserId]) {
        const { rowCount } = await c.query('SELECT 1 FROM customer WHERE id = $1 FOR UPDATE', [id]);
        if (!rowCount) throw new MergeError('not_found');
      }
      const moved: Record<string, unknown> = {};
      // the winner keeps its primary phone: demote the loser's primaries BEFORE
      // re-parenting (the one-primary-per-customer partial unique index enforces this)
      const winnerHasPrimary = await c.query(
        'SELECT 1 FROM customer_phone WHERE customer_id = $1 AND is_primary', [winnerId],
      );
      if (winnerHasPrimary.rowCount && winnerHasPrimary.rowCount > 0) {
        const demoted = await c.query(
          'UPDATE customer_phone SET is_primary = false WHERE customer_id = $1 AND is_primary RETURNING id',
          [loserId],
        );
        moved['demoted_primaries'] = demoted.rows.map((r) => r.id);
      }
      // child rows re-parent to the winner; loser keeps none
      for (const table of ['customer_phone', 'address', 'customer_allergy', 'preference']) {
        const { rows } = await c.query(
          `UPDATE ${table} SET customer_id = $1 WHERE customer_id = $2 RETURNING id`,
          [winnerId, loserId],
        );
        moved[table] = rows.map((r) => r.id);
      }
      for (const step of this.relinkSteps) {
        moved[`step:${step.name}`] = await step.merge(c, winnerId, loserId);
      }
      await c.query(
        `UPDATE customer SET status = 'inactive', updated_at = now(), updated_by = $2, version = version + 1
         WHERE id = $1`,
        [loserId, actor.staffId],
      );
      await c.query(
        `INSERT INTO merge_record (id, winner_id, loser_id, field_decisions, merged_by, undo_until)
         VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6))`,
        [mergeId, winnerId, loserId, JSON.stringify(moved), actor.staffId, undoDays],
      );
      await this.audit.writeInTx(c, {
        eventType: 'customer.merged',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'customer', entityId: winnerId,
        relatedRefs: { loser: loserId, merge_record: mergeId },
        after: { moved_counts: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])) },
        severity: 'high', reason: `merge ${loserId} -> ${winnerId}`,
      });
      await this.outbox.writeInTx(c, {
        eventType: 'customer.merged',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { customer: winnerId, loser: loserId },
        payload: { merge_record: mergeId, undo_days: undoDays },
      });
    });
    return mergeId;
  }

  async undo(actor: StaffContext, mergeId: string): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      const { rows } = await c.query('SELECT * FROM merge_record WHERE id = $1 FOR UPDATE', [mergeId]);
      const rec = rows[0];
      if (!rec) throw new MergeError('not_found');
      if (rec.undone_at) throw new MergeError('already_undone');
      const inWindow = await c.query('SELECT now() <= $1::timestamptz AS ok', [rec.undo_until]);
      if (!inWindow.rows[0].ok) throw new MergeError('undo_expired');

      const moved = rec.field_decisions as Record<string, unknown>;
      for (const table of ['customer_phone', 'address', 'customer_allergy', 'preference']) {
        const ids = (moved[table] as string[]) ?? [];
        if (ids.length > 0) {
          await c.query(`UPDATE ${table} SET customer_id = $1 WHERE id = ANY($2)`, [rec.loser_id, ids]);
        }
      }
      const demoted = (moved['demoted_primaries'] as string[]) ?? [];
      if (demoted.length > 0) {
        await c.query('UPDATE customer_phone SET is_primary = true WHERE id = ANY($1)', [demoted]);
      }
      for (const step of this.relinkSteps) {
        await step.undo(c, rec.winner_id, rec.loser_id, moved[`step:${step.name}`]);
      }
      await c.query(
        `UPDATE customer SET status = 'active', updated_at = now(), updated_by = $2, version = version + 1
         WHERE id = $1`,
        [rec.loser_id, actor.staffId],
      );
      await c.query('UPDATE merge_record SET undone_at = now() WHERE id = $1', [mergeId]);
      await this.audit.writeInTx(c, {
        eventType: 'customer.merged',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'customer', entityId: rec.winner_id,
        relatedRefs: { loser: rec.loser_id, merge_record: mergeId },
        after: { undone: true }, severity: 'high', reason: 'merge undo within window',
      });
    });
  }
}
