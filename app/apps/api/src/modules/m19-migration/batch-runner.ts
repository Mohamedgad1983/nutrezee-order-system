import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { SyncRecordService } from '../m18-bridge/sync-record.service';
import { newId } from '../../platform/ids';
import type { OrderService } from '../m03-orders/order.service';
import type { PaymentService } from '../m07-payments/payment.service';

export type BatchType = 'customer' | 'catalog' | 'active_plans';
export type RowAction = 'created' | 'matched' | 'merge_review' | 'skipped' | 'error';

export interface RowResult {
  rowNo: number;
  action: RowAction;
  targetRef?: string;
  messages: string[];
}

export interface BatchReport {
  batchId: string;
  dryRun: boolean;
  sourceHash: string;
  counts: Record<RowAction, number>;
  rows: RowResult[];
}

/** Per-type importer: processes one source row inside the batch transaction. */
export type RowImporter = (client: PoolClient, row: Record<string, unknown>, rowNo: number, batchId: string) => Promise<RowResult>;

export class ImportGateError extends Error {
  constructor(readonly gate: string, readonly detail: string) {
    super(`import gate red: ${gate} — ${detail}`);
  }
}
export class ImportError extends Error {
  constructor(readonly code: 'dry_run_required' | 'not_found' | 'not_applied' | 'rollback_blocked', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

// Data-quality gates (migration_execution_plan §4, thresholds [Proposed]) — block APPLY only.
const GATES: Record<string, { maxMergeReviewRate: number; maxErrorRate: number }> = {
  customer: { maxMergeReviewRate: 0.10, maxErrorRate: 0.02 },
  catalog: { maxMergeReviewRate: 1, maxErrorRate: 0.02 },
  active_plans: { maxMergeReviewRate: 1, maxErrorRate: 0 }, // WP-13 — importer not built here
};

// M19 batch runner (migration_execution_plan §1): dry-run by default; apply requires
// a reviewed dry-run of the SAME source snapshot; idempotent via sync_record (the
// importers consult it); rollback deletes created rows while nothing references them.
export class BatchRunner {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly sync: SyncRecordService,
    private readonly orders?: OrderService,
    private readonly payments?: PaymentService,
  ) {}

  hashSource(rows: Array<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  }

  async run(
    actor: StaffContext,
    type: BatchType,
    rows: Array<Record<string, unknown>>,
    importer: RowImporter,
    opts: { apply?: boolean } = {},
  ): Promise<BatchReport> {
    const dryRun = !opts.apply;
    const sourceHash = this.hashSource(rows);

    if (!dryRun) {
      // apply gate 1: a dry-run of the same snapshot must exist (reviewed) —
      const prior = await this.pool.query(
        `SELECT 1 FROM import_batch WHERE type = $1 AND source_note = $2 AND state = 'dry_run'`,
        [type, sourceHash],
      );
      if (prior.rowCount === 0) throw new ImportError('dry_run_required');
    }

    const batchId = newId();
    const results: RowResult[] = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // batch row first so business rows can FK it; rolled back in dry-run and
      // re-written afterwards for the report
      await client.query(
        `INSERT INTO import_batch (id, type, source_note, dry_run, state, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [batchId, type, sourceHash, dryRun, dryRun ? 'dry_run' : 'applied', actor.staffId],
      );
      for (let i = 0; i < rows.length; i += 1) {
        try {
          results.push(await importer(client, rows[i] as Record<string, unknown>, i + 1, batchId));
        } catch (e) {
          results.push({ rowNo: i + 1, action: 'error', messages: [(e as Error).message] });
        }
      }
      const counts = this.count(results);
      if (!dryRun) this.enforceGates(type, counts, rows.length); // throws -> ROLLBACK (nothing persists)

      if (dryRun) {
        await client.query('ROLLBACK'); // business writes vanish; report persists below
      } else {
        await client.query(
          'UPDATE import_batch SET counts = $2, updated_at = now() WHERE id = $1',
          [batchId, JSON.stringify(counts)],
        );
        await this.writeRowResults(client, batchId, results);
        await this.audit.writeInTx(client, {
          eventType: 'bridge.import_run',
          actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
          entityType: 'import_batch', entityId: batchId, severity: 'high',
          after: { type, counts, source_hash: sourceHash, applied: true },
        });
        await client.query('COMMIT');
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const counts = this.count(results);
    if (dryRun) {
      // persist the reviewable report (batch + row results) in its own transaction
      await this.pool.query('BEGIN');
      try {
        await this.pool.query(
          `INSERT INTO import_batch (id, type, source_note, dry_run, state, counts, created_by)
           VALUES ($1,$2,$3,true,'dry_run',$4,$5)`,
          [batchId, type, sourceHash, JSON.stringify(counts), actor.staffId],
        );
        const c2 = { query: this.pool.query.bind(this.pool) } as unknown as PoolClient;
        await this.writeRowResults(c2, batchId, results);
        await this.pool.query('COMMIT');
      } catch (e) {
        await this.pool.query('ROLLBACK');
        throw e;
      }
    }
    return { batchId, dryRun, sourceHash, counts, rows: results };
  }

  /** Rollback an APPLIED batch: delete its created rows (valid only while nothing
   *  references them — FK RESTRICT turns later-referenced rows into a review list). */
  async rollback(actor: StaffContext, batchId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT type, state FROM import_batch WHERE id = $1 FOR UPDATE', [batchId]);
      if (rows.length === 0) throw new ImportError('not_found');
      if (rows[0].state !== 'applied') throw new ImportError('not_applied', rows[0].state);
      try {
        if (rows[0].type === 'active_plans') {
          if (!this.orders || !this.payments) throw new ImportError('rollback_blocked', 'active-plan owner rollback ports not configured');
          const paymentRefs = await this.payments.rollbackImportedBatchInTx(client, batchId);
          await this.sync.clearByNewRefs(client, paymentRefs);
          const orderRefs = await this.orders.rollbackImportedBatchInTx(client, batchId);
          await this.sync.clearByNewRefs(client, orderRefs);
          await client.query(`UPDATE import_batch SET state = 'rolled_back', updated_at = now() WHERE id = $1`, [batchId]);
          await this.audit.writeInTx(client, {
            eventType: 'bridge.import_run',
            actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
            entityType: 'import_batch', entityId: batchId, severity: 'high',
            after: { rolled_back: true, type: 'active_plans' },
          });
          await client.query('COMMIT');
          return;
        }
        // child-first deletion, explicit per child shape (errors must propagate —
        // a swallowed error aborts the PG transaction and poisons later statements)
        for (const table of ['customer_phone', 'address']) {
          await client.query(`DELETE FROM ${table} WHERE import_batch_id = $1`, [batchId]);
        }
        for (const table of ['customer_allergy', 'preference']) {
          await client.query(
            `DELETE FROM ${table} WHERE customer_id IN (SELECT id FROM customer WHERE import_batch_id = $1)`,
            [batchId],
          );
        }
        for (const table of ['nutrition_facts', 'product_allergen', 'product_ingredient', 'product_component']) {
          await client.query(
            `DELETE FROM ${table} WHERE product_id IN (SELECT id FROM product WHERE import_batch_id = $1)`,
            [batchId],
          );
        }
        for (const table of ['customer', 'package', 'product', 'meal_type', 'diet_status', 'tag', 'package_for_type', 'ingredient', 'allergen', 'delivery_slot', 'delivery_method']) {
          const del = await client.query(`DELETE FROM ${table} WHERE import_batch_id = $1 RETURNING id`, [batchId]);
          await this.sync.clearByNewRefs(client, del.rows.map((r) => r.id)); // M18 API (ADR-010)
        }
      } catch (e) {
        throw new ImportError('rollback_blocked', (e as Error).message);
      }
      await client.query(`UPDATE import_batch SET state = 'rolled_back', updated_at = now() WHERE id = $1`, [batchId]);
      await this.audit.writeInTx(client, {
        eventType: 'bridge.import_run',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'import_batch', entityId: batchId, severity: 'high',
        after: { rolled_back: true },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async report(batchId: string): Promise<BatchReport> {
    const batch = await this.pool.query(
      `SELECT id, type, dry_run, source_note, counts FROM import_batch WHERE id = $1`,
      [batchId],
    );
    if (batch.rows.length === 0) throw new ImportError('not_found');
    const rows = await this.pool.query(
      `SELECT row_no, action, target_ref, messages
       FROM import_row_result WHERE batch_id = $1 ORDER BY row_no`,
      [batchId],
    );
    return {
      batchId: batch.rows[0].id as string,
      dryRun: Boolean(batch.rows[0].dry_run),
      sourceHash: batch.rows[0].source_note as string,
      counts: batch.rows[0].counts as Record<RowAction, number>,
      rows: rows.rows.map((r) => ({
        rowNo: Number(r.row_no),
        action: r.action as RowAction,
        targetRef: (r.target_ref as string | null) ?? undefined,
        messages: r.messages as string[],
      })),
    };
  }

  private enforceGates(type: BatchType, counts: Record<RowAction, number>, total: number): void {
    const g = GATES[type];
    if (!g || total === 0) return;
    const mergeRate = (counts.merge_review ?? 0) / total;
    const errorRate = (counts.error ?? 0) / total;
    if (mergeRate > g.maxMergeReviewRate) {
      throw new ImportGateError('merge_review_rate', `${(mergeRate * 100).toFixed(1)}% > ${g.maxMergeReviewRate * 100}%`);
    }
    if (errorRate > g.maxErrorRate) {
      throw new ImportGateError('error_rate', `${(errorRate * 100).toFixed(1)}% > ${g.maxErrorRate * 100}%`);
    }
  }

  private count(results: RowResult[]): Record<RowAction, number> {
    const counts = { created: 0, matched: 0, merge_review: 0, skipped: 0, error: 0 };
    for (const r of results) counts[r.action] += 1;
    return counts;
  }

  private async writeRowResults(client: PoolClient, batchId: string, results: RowResult[]): Promise<void> {
    for (const r of results) {
      await client.query(
        `INSERT INTO import_row_result (id, batch_id, row_no, action, target_ref, messages)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(), batchId, r.rowNo, r.action, r.targetRef ?? null, JSON.stringify(r.messages)],
      );
    }
  }
}
