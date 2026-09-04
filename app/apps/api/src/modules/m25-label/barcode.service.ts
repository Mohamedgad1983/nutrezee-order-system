import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  formatBarcodeValue, generateBarcodePayload, isValidBarcodeValue, normalizeScannedBarcode,
} from './code128';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import type { RelinkStep } from '../m04-customers/merge.service';

// m25-label — the permanent customer barcode (WP-LBL-01, amendment A27).
//
// Invariants, all DB-enforced (migration 0027) and re-checked here:
//   * exactly one ACTIVE barcode per customer      -> partial unique index
//   * a value can never belong to two customers    -> UNIQUE (barcode_value)
//   * issuance is idempotent                       -> read-then-insert, unique violation re-reads
//   * a reprint never changes the barcode          -> nothing here mutates barcode_value
//   * a merge preserves the loser's barcode        -> repointed to the survivor as an 'alias'
//   * the value encodes no PII                     -> payload is CSPRNG random, never derived
//
// Writes ONLY customer_barcode. Customer rows are read, never written.

export type BarcodeStatus = 'active' | 'alias' | 'disabled';

export class BarcodeError extends Error {
  constructor(readonly code: 'validation_failed' | 'not_found' | 'conflict', readonly detail?: unknown) {
    super(code);
  }
}

export interface BarcodeRecord {
  id: string;
  customer_id: string;
  barcode_value: string;
  status: BarcodeStatus;
  issued_at: string;
  replacement_reason: string | null;
}

export interface ResolvedBarcode {
  barcode_id: string;
  customer_id: string;
  barcode_value: string;
  status: BarcodeStatus;
}

/** Distinct values are 32^8 ≈ 1.1e12, so a collision is vanishingly rare; retry anyway. */
const ISSUE_ATTEMPTS = 8;
const UNIQUE_VIOLATION = '23505';

export class BarcodeService {
  constructor(private readonly pool: Pool, private readonly audit: AuditService) {}

  /**
   * Return the customer's active barcode, creating it on first call. Idempotent: calling this
   * repeatedly — or concurrently — always yields the same value, so reprinting a label can never
   * mint a new barcode.
   */
  async issueFor(actor: StaffContext, customerId: string): Promise<BarcodeRecord> {
    const existing = await this.findActive(this.pool, customerId);
    if (existing) return existing;

    await this.assertCustomerExists(customerId);

    for (let attempt = 0; attempt < ISSUE_ATTEMPTS; attempt += 1) {
      try {
        return await withTransaction(this.pool, async (client) => {
          // Re-check inside the transaction: a concurrent issue may have won the race.
          const raced = await this.findActive(client, customerId);
          if (raced) return raced;

          const value = formatBarcodeValue(generateBarcodePayload((max) => randomInt(max)));
          const id = newId();
          const { rows } = await client.query(
            `INSERT INTO customer_barcode (id, customer_id, barcode_value, status, issued_by, created_by)
             VALUES ($1,$2,$3,'active',$4,$4) RETURNING *`,
            [id, customerId, value, actor.staffId],
          );
          await this.audit.writeInTx(client, {
            eventType: 'barcode.issued', actor: this.actor(actor),
            entityType: 'customer_barcode', entityId: id, severity: 'info',
            relatedRefs: { customer_id: customerId },
            after: { barcode_value: value, status: 'active' },
          });
          return this.row(rows[0]);
        });
      } catch (e) {
        // Either the value collided or another request issued first — both resolve by re-reading.
        if (!this.isUniqueViolation(e)) throw e;
        const settled = await this.findActive(this.pool, customerId);
        if (settled) return settled;
      }
    }
    throw new BarcodeError('conflict', { reason: 'could_not_allocate_barcode', customer_id: customerId });
  }

  /** Issue for many customers, preserving input order. Used by batch label printing. */
  async issueForMany(actor: StaffContext, customerIds: string[]): Promise<Map<string, BarcodeRecord>> {
    const out = new Map<string, BarcodeRecord>();
    for (const customerId of new Set(customerIds)) {
      out.set(customerId, await this.issueFor(actor, customerId));
    }
    return out;
  }

  /** Read-only lookup; returns null when the customer has never been issued a barcode. */
  async getForCustomer(customerId: string): Promise<BarcodeRecord | null> {
    return this.findActive(this.pool, customerId);
  }

  /**
   * Resolve a scanned value to its owning customer. Alias rows (created by a merge) resolve to the
   * surviving customer, so labels printed before the merge keep working. Disabled rows do not
   * resolve — a replaced barcode must stop working.
   */
  async resolve(scanned: string): Promise<ResolvedBarcode | null> {
    const value = normalizeScannedBarcode(scanned ?? '');
    if (!isValidBarcodeValue(value)) return null;
    const { rows } = await this.pool.query(
      `SELECT id, customer_id, barcode_value, status FROM customer_barcode
       WHERE barcode_value = $1 AND status IN ('active','alias') LIMIT 1`,
      [value],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      barcode_id: r.id as string, customer_id: r.customer_id as string,
      barcode_value: r.barcode_value as string, status: r.status as BarcodeStatus,
    };
  }

  /**
   * Exceptional administrative replacement: the current barcode is disabled with a recorded reason
   * and a fresh one issued. Labels carrying the old value stop resolving — that is the point.
   */
  async replace(actor: StaffContext, customerId: string, reason: string): Promise<BarcodeRecord> {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BarcodeError('validation_failed', { field: 'reason' });

    const current = await this.findActive(this.pool, customerId);
    if (!current) throw new BarcodeError('not_found', { customer_id: customerId });

    for (let attempt = 0; attempt < ISSUE_ATTEMPTS; attempt += 1) {
      try {
        return await withTransaction(this.pool, async (client) => {
          const value = formatBarcodeValue(generateBarcodePayload((max) => randomInt(max)));
          const id = newId();
          // Disable first so the partial unique index has room for the replacement.
          await client.query(
            `UPDATE customer_barcode
                SET status='disabled', replacement_reason=$2, disabled_at=now(), disabled_by=$3,
                    updated_at=now(), updated_by=$3, version=version+1
              WHERE id=$1 AND status='active'`,
            [current.id, trimmed, actor.staffId],
          );
          const { rows } = await client.query(
            `INSERT INTO customer_barcode (id, customer_id, barcode_value, status, issued_by, created_by)
             VALUES ($1,$2,$3,'active',$4,$4) RETURNING *`,
            [id, customerId, value, actor.staffId],
          );
          await client.query(
            `UPDATE customer_barcode SET replaced_by_id=$2, updated_at=now(), updated_by=$3 WHERE id=$1`,
            [current.id, id, actor.staffId],
          );
          await this.audit.writeInTx(client, {
            eventType: 'barcode.replaced', actor: this.actor(actor),
            entityType: 'customer_barcode', entityId: id, severity: 'warn', reason: trimmed,
            relatedRefs: { customer_id: customerId, previous_barcode_id: current.id },
            before: { barcode_value: current.barcode_value, status: 'active' },
            after: { barcode_value: value, status: 'active' },
          });
          return this.row(rows[0]);
        });
      } catch (e) {
        if (!this.isUniqueViolation(e)) throw e;
      }
    }
    throw new BarcodeError('conflict', { reason: 'could_not_allocate_barcode', customer_id: customerId });
  }

  /**
   * Merge/undo hook registered with m04's MergeService, running inside the merge transaction — the
   * sanctioned extension point, so no foreign-table write and no change to m04's merge internals.
   *
   * Every barcode the loser held is repointed at the winner and demoted to 'alias'. Nothing is
   * deleted, so a label printed before the merge still scans and now resolves to the survivor.
   * The merge's own HIGH `customer.merged` audit event records this step and its row count.
   */
  static customerRelinkStep(): RelinkStep {
    return {
      name: 'customer_barcode',
      merge: async (client, winnerId, loserId) => {
        const { rows } = await client.query(
          `UPDATE customer_barcode
              SET customer_id=$1, pre_merge_status=status, status='alias',
                  merged_from_customer_id=$2, merged_at=now(), updated_at=now(), version=version+1
            WHERE customer_id=$2 AND status IN ('active','alias')
            RETURNING id`,
          [winnerId, loserId],
        );
        return rows.map((r) => r.id as string);
      },
      undo: async (client, _winnerId, loserId, moved) => {
        const ids = (moved as string[]) ?? [];
        if (ids.length === 0) return;
        await client.query(
          `UPDATE customer_barcode
              SET customer_id=$1, status=coalesce(pre_merge_status,'active'),
                  pre_merge_status=NULL, merged_from_customer_id=NULL, merged_at=NULL,
                  updated_at=now(), version=version+1
            WHERE id = ANY($2)`,
          [loserId, ids],
        );
      },
    };
  }

  // ---- helpers ----
  private async findActive(q: Pool | PoolClient, customerId: string): Promise<BarcodeRecord | null> {
    const { rows } = await q.query(
      `SELECT * FROM customer_barcode WHERE customer_id=$1 AND status='active' LIMIT 1`,
      [customerId],
    );
    return rows.length ? this.row(rows[0]) : null;
  }

  private async assertCustomerExists(customerId: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT 1 FROM customer WHERE id=$1', [customerId]);
    if (rows.length === 0) throw new BarcodeError('not_found', { customer_id: customerId });
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;
  }

  private row(r: Record<string, unknown>): BarcodeRecord {
    return {
      id: r.id as string,
      customer_id: r.customer_id as string,
      barcode_value: r.barcode_value as string,
      status: r.status as BarcodeStatus,
      issued_at: r.issued_at instanceof Date ? r.issued_at.toISOString() : String(r.issued_at),
      replacement_reason: (r.replacement_reason as string) ?? null,
    };
  }

  private actor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }
}
