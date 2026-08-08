import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

// m20-packing — packing workflow foundation. Batches orders by delivery date/time/area, marks
// each packed (or flags an issue), previews/prints a label, then hands the batch to driver
// assignment (m21-delivery). Writes ONLY packing_* tables (single write path); reads order/customer
// data and copies a FROZEN delivery snapshot into packing_batch_order. Status changes are guarded +
// audited in the same transaction and recorded append-only in packing_status_history. Promotion of
// these machines into the seeded transition engine is the documented follow-up (doc 26).

export type BatchStatus = 'draft' | 'in_progress' | 'packed' | 'handed_to_driver' | 'cancelled';
export type OrderPackStatus = 'pending' | 'packed' | 'missing_item' | 'issue' | 'handed_to_driver';

export class PackingError extends Error {
  constructor(readonly code: 'validation_failed' | 'not_found' | 'conflict', readonly detail?: unknown) {
    super(code);
  }
}

export interface BatchRow {
  id: string; kitchen_id: string | null; branch_id: string | null;
  delivery_date: string; delivery_time: string | null; area: string | null;
  status: BatchStatus; notes: string | null; created_at: string; created_by: string;
  order_count?: number; packed_count?: number;
}
export interface BatchOrderRow {
  id: string; batch_id: string; order_id: string; customer_id: string | null;
  package_name: string | null; delivery_method_frozen: string | null;
  delivery_time_frozen: string | null; delivery_area_frozen: string | null;
  packing_status: OrderPackStatus; label_printed_at: string | null;
  packed_by: string | null; packed_at: string | null; notes: string | null;
  customer_name?: string | null;
}
export interface LabelPreview {
  order_id: string; label_code: string; customer_display_name: string | null;
  package_name: string | null; delivery_date: string | null; delivery_time: string | null;
  area: string | null; allergy_warning: string | null; special_notes: string | null;
  printed_at: string | null; printed_by: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class PackingService {
  constructor(private readonly pool: Pool, private readonly audit: AuditService) {}

  async listBatches(filters: { date?: string; status?: string }): Promise<BatchRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.date) { params.push(filters.date); clauses.push(`pb.delivery_date = $${params.length}`); }
    if (filters.status) { params.push(filters.status); clauses.push(`pb.status = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT pb.*,
              (SELECT count(*) FROM packing_batch_order o WHERE o.batch_id = pb.id)::int AS order_count,
              (SELECT count(*) FROM packing_batch_order o WHERE o.batch_id = pb.id
                 AND o.packing_status IN ('packed','handed_to_driver'))::int AS packed_count
       FROM packing_batch pb ${where}
       ORDER BY pb.delivery_date DESC, pb.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => this.batchRow(r));
  }

  /** Create a batch and auto-include matching unpacked orders by delivery date/time/area. */
  async createBatch(
    actor: StaffContext,
    input: { kitchen_id?: string; branch_id?: string; delivery_date: string; delivery_time?: string; area?: string },
  ): Promise<{ batch: BatchRow; included: number }> {
    if (!input.delivery_date || !DATE_RE.test(input.delivery_date)) throw new PackingError('validation_failed', { field: 'delivery_date' });
    return withTransaction(this.pool, async (client) => {
      const id = newId();
      let rows: Record<string, unknown>[];
      try {
        // The partial-unique index (active rows only) is the source of truth; catch its violation
        // rather than relying on ON CONFLICT inference against an expression index.
        ({ rows } = await client.query(
          `INSERT INTO packing_batch (id, kitchen_id, branch_id, delivery_date, delivery_time, area, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *`,
          [id, input.kitchen_id ?? null, input.branch_id ?? null, input.delivery_date, input.delivery_time ?? null, input.area ?? null, actor.staffId],
        ));
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new PackingError('conflict', { reason: 'an active batch already exists for this date/time/area' });
        throw e;
      }
      const inserted = rows[0];
      if (!inserted) throw new PackingError('conflict', { reason: 'batch insert returned no row' });
      const batch = this.batchRow(inserted);
      const included = await this.includeMatchingOrders(client, actor, batch);
      await this.audit.writeInTx(client, {
        eventType: 'packing.batch_created', actor: this.actor(actor),
        entityType: 'packing_batch', entityId: batch.id, severity: 'info',
        after: { delivery_date: batch.delivery_date, delivery_time: batch.delivery_time, area: batch.area, included },
      });
      await this.history(client, 'packing_batch', batch.id, null, 'draft', actor);
      return { batch: { ...batch, order_count: included, packed_count: 0 }, included };
    });
  }

  private async includeMatchingOrders(client: PoolClient, actor: StaffContext, batch: BatchRow): Promise<number> {
    // Candidate orders: active/approved, the delivery_date falls in the plan window, and the frozen
    // legacy delivery area/time match (when supplied). Skip orders already in an active batch.
    const params: unknown[] = [batch.delivery_date];
    let areaClause = '';
    let timeClause = '';
    if (batch.area) { params.push(batch.area); areaClause = `AND co.delivery_area_frozen = $${params.length}`; }
    if (batch.delivery_time) { params.push(batch.delivery_time); timeClause = `AND co.delivery_time_frozen = $${params.length}`; }
    const { rows } = await client.query(
      `SELECT co.id, co.customer_id,
              coalesce(co.package_name_frozen_en, '') AS package_name,
              co.delivery_method_frozen, co.delivery_time_frozen, co.delivery_area_frozen
       FROM customer_order co
       WHERE co.start_date <= $1 AND co.end_date >= $1
         AND co.status IN ('approved','active')
         ${areaClause} ${timeClause}
         AND NOT EXISTS (
           SELECT 1 FROM packing_batch_order pbo JOIN packing_batch pb ON pb.id = pbo.batch_id
           WHERE pbo.order_id = co.id AND pb.status <> 'cancelled')
       ORDER BY co.id LIMIT 1000`,
      params,
    );
    let included = 0;
    for (const o of rows) {
      const ins = await client.query(
        `INSERT INTO packing_batch_order
           (id, batch_id, order_id, customer_id, package_name, delivery_method_frozen,
            delivery_time_frozen, delivery_area_frozen, packing_status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
         ON CONFLICT (batch_id, order_id) DO NOTHING RETURNING id`,
        [newId(), batch.id, o.id, o.customer_id, o.package_name, o.delivery_method_frozen,
          o.delivery_time_frozen, o.delivery_area_frozen, actor.staffId],
      );
      if (ins.rows.length > 0) included += 1;
    }
    return included;
  }

  async getBatch(batchId: string): Promise<{ batch: BatchRow; orders: BatchOrderRow[] }> {
    const b = await this.pool.query(`SELECT * FROM packing_batch WHERE id = $1`, [batchId]);
    if (b.rows.length === 0) throw new PackingError('not_found');
    const o = await this.pool.query(
      `SELECT pbo.*, c.full_name_en AS customer_name
       FROM packing_batch_order pbo LEFT JOIN customer c ON c.id = pbo.customer_id
       WHERE pbo.batch_id = $1 ORDER BY pbo.created_at`,
      [batchId],
    );
    return { batch: this.batchRow(b.rows[0]), orders: o.rows.map((r) => this.orderRow(r)) };
  }

  async markPacked(actor: StaffContext, batchId: string, orderId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const row = await this.lockOrder(client, batchId, orderId);
      if (row.packing_status === 'handed_to_driver') throw new PackingError('conflict', { reason: 'already handed to driver' });
      if (row.packing_status === 'packed') return; // idempotent
      await client.query(
        `UPDATE packing_batch_order SET packing_status='packed', packed_by=$2, packed_at=now(),
         updated_at=now(), updated_by=$2, version=version+1 WHERE id=$1`,
        [row.id, actor.staffId],
      );
      await this.bumpBatchInProgress(client, batchId, actor);
      await this.audit.writeInTx(client, {
        eventType: 'packing.order_packed', actor: this.actor(actor),
        entityType: 'packing_batch_order', entityId: row.id, severity: 'info',
        relatedRefs: { batch_id: batchId, order_id: orderId },
        before: { packing_status: row.packing_status }, after: { packing_status: 'packed' },
      });
      await this.history(client, 'packing_batch_order', row.id, row.packing_status, 'packed', actor);
    });
  }

  async flagIssue(
    actor: StaffContext, batchId: string, orderId: string,
    input: { status?: string; reason?: string; notes?: string },
  ): Promise<void> {
    const to = input.status === 'missing_item' ? 'missing_item' : 'issue';
    await withTransaction(this.pool, async (client) => {
      const row = await this.lockOrder(client, batchId, orderId);
      if (row.packing_status === 'handed_to_driver') throw new PackingError('conflict', { reason: 'already handed to driver' });
      await client.query(
        `UPDATE packing_batch_order SET packing_status=$2, notes=$3,
         updated_at=now(), updated_by=$4, version=version+1 WHERE id=$1`,
        [row.id, to, input.notes ?? row.notes ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'packing.order_issue', actor: this.actor(actor),
        entityType: 'packing_batch_order', entityId: row.id, severity: 'warn',
        relatedRefs: { batch_id: batchId, order_id: orderId },
        before: { packing_status: row.packing_status }, after: { packing_status: to },
        reason: input.reason ? `${input.reason}${input.notes ? `: ${input.notes}` : ''}` : (input.notes ?? undefined),
      });
      await this.history(client, 'packing_batch_order', row.id, row.packing_status, to, actor, input.reason);
    });
  }

  /** Hand a fully-packed batch to driver assignment (the packing -> driver bridge). */
  async handoff(actor: StaffContext, batchId: string): Promise<{ handed: number }> {
    return withTransaction(this.pool, async (client) => {
      const b = await client.query(`SELECT * FROM packing_batch WHERE id=$1 FOR UPDATE`, [batchId]);
      if (b.rows.length === 0) throw new PackingError('not_found');
      const batch = this.batchRow(b.rows[0]);
      if (batch.status === 'cancelled') throw new PackingError('conflict', { reason: 'batch cancelled' });
      const unpacked = await client.query(
        `SELECT count(*)::int AS n FROM packing_batch_order WHERE batch_id=$1 AND packing_status NOT IN ('packed','handed_to_driver')`,
        [batchId],
      );
      if ((unpacked.rows[0]?.n as number) > 0) throw new PackingError('conflict', { reason: 'not all orders packed', unpacked: unpacked.rows[0].n });
      const upd = await client.query(
        `UPDATE packing_batch_order SET packing_status='handed_to_driver', updated_at=now(), updated_by=$2, version=version+1
         WHERE batch_id=$1 AND packing_status='packed' RETURNING id`,
        [batchId, actor.staffId],
      );
      await client.query(
        `UPDATE packing_batch SET status='handed_to_driver', updated_at=now(), updated_by=$2, version=version+1 WHERE id=$1`,
        [batchId, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'packing.batch_handoff', actor: this.actor(actor),
        entityType: 'packing_batch', entityId: batchId, severity: 'info',
        before: { status: batch.status }, after: { status: 'handed_to_driver', handed: upd.rows.length },
      });
      await this.history(client, 'packing_batch', batchId, batch.status, 'handed_to_driver', actor);
      return { handed: upd.rows.length };
    });
  }

  /** Build a label preview from the order + its batch row (no persistence). */
  async previewLabel(orderId: string): Promise<LabelPreview> {
    const { rows } = await this.pool.query(
      `SELECT co.id AS order_id, c.full_name_en AS customer_display_name,
              coalesce(co.package_name_frozen_en,'') AS package_name,
              co.delivery_time_frozen AS delivery_time, co.delivery_area_frozen AS area,
              pbo.delivery_time_frozen AS pbo_time, pbo.delivery_area_frozen AS pbo_area
       FROM customer_order co
       LEFT JOIN customer c ON c.id = co.customer_id
       LEFT JOIN packing_batch_order pbo ON pbo.order_id = co.id
       WHERE co.id = $1 LIMIT 1`,
      [orderId],
    );
    if (rows.length === 0) throw new PackingError('not_found');
    const r = rows[0];
    const allergy = await this.allergyWarning(orderId);
    return {
      order_id: orderId,
      label_code: this.labelCode(orderId),
      customer_display_name: r.customer_display_name ?? null,
      package_name: r.package_name || null,
      delivery_date: null,
      delivery_time: r.pbo_time ?? r.delivery_time ?? null,
      area: r.pbo_area ?? r.area ?? null,
      allergy_warning: allergy,
      special_notes: null,
      printed_at: null,
      printed_by: null,
    };
  }

  /** Persist a printed label + stamp the batch_order. */
  async markPrinted(actor: StaffContext, orderId: string): Promise<{ label_code: string }> {
    const preview = await this.previewLabel(orderId);
    return withTransaction(this.pool, async (client) => {
      const id = newId();
      await client.query(
        `INSERT INTO packing_label
           (id, order_id, batch_order_id, label_code, customer_display_name, package_name,
            delivery_date, delivery_time, area, allergy_warning, special_notes, printed_at, printed_by, created_by)
         SELECT $1,$2, pbo.id, $3,$4,$5,$6,$7,$8,$9,$10, now(), $11, $11
         FROM customer_order co LEFT JOIN packing_batch_order pbo ON pbo.order_id = co.id
         WHERE co.id = $2 LIMIT 1`,
        [id, orderId, preview.label_code, preview.customer_display_name, preview.package_name,
          preview.delivery_date, preview.delivery_time, preview.area, preview.allergy_warning, preview.special_notes, actor.staffId],
      );
      await client.query(
        `UPDATE packing_batch_order SET label_printed_at=now(), updated_at=now(), updated_by=$2, version=version+1
         WHERE order_id=$1 AND batch_id IN (SELECT batch_id FROM packing_batch_order WHERE order_id=$1)`,
        [orderId, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'packing.label_printed', actor: this.actor(actor),
        entityType: 'packing_label', entityId: id, severity: 'info',
        relatedRefs: { order_id: orderId }, after: { label_code: preview.label_code },
      });
      return { label_code: preview.label_code };
    });
  }

  // ---- helpers ----
  private async lockOrder(client: PoolClient, batchId: string, orderId: string): Promise<BatchOrderRow> {
    const { rows } = await client.query(
      `SELECT * FROM packing_batch_order WHERE batch_id=$1 AND order_id=$2 FOR UPDATE`,
      [batchId, orderId],
    );
    if (rows.length === 0) throw new PackingError('not_found', { batch_id: batchId, order_id: orderId });
    return this.orderRow(rows[0]);
  }

  private async bumpBatchInProgress(client: PoolClient, batchId: string, actor: StaffContext): Promise<void> {
    const { rows } = await client.query(
      `UPDATE packing_batch SET status='in_progress', updated_at=now(), updated_by=$2, version=version+1
       WHERE id=$1 AND status='draft' RETURNING id`,
      [batchId, actor.staffId],
    );
    if (rows.length > 0) await this.history(client, 'packing_batch', batchId, 'draft', 'in_progress', actor);
  }

  private async allergyWarning(orderId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM order_item WHERE order_id=$1 AND jsonb_array_length(allergens_frozen) > 0`,
      [orderId],
    );
    return (rows[0]?.n as number) > 0 ? 'ALLERGY — check items' : null;
  }

  private async history(
    client: PoolClient, entityType: 'packing_batch' | 'packing_batch_order',
    entityId: string, from: string | null, to: string, actor: StaffContext, reason?: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO packing_status_history (id, entity_type, entity_id, from_status, to_status, actor, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newId(), entityType, entityId, from, to, JSON.stringify(this.actor(actor)), reason ?? null],
    );
  }

  private labelCode(orderId: string): string {
    return `NZ-${orderId.slice(-8).toUpperCase()}`;
  }

  private actor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }

  private batchRow(r: Record<string, unknown>): BatchRow {
    return {
      id: r.id as string, kitchen_id: (r.kitchen_id as string) ?? null, branch_id: (r.branch_id as string) ?? null,
      delivery_date: this.dateStr(r.delivery_date), delivery_time: (r.delivery_time as string) ?? null,
      area: (r.area as string) ?? null, status: r.status as BatchStatus, notes: (r.notes as string) ?? null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      created_by: r.created_by as string,
      ...(r.order_count !== undefined ? { order_count: Number(r.order_count) } : {}),
      ...(r.packed_count !== undefined ? { packed_count: Number(r.packed_count) } : {}),
    };
  }

  private orderRow(r: Record<string, unknown>): BatchOrderRow {
    return {
      id: r.id as string, batch_id: r.batch_id as string, order_id: r.order_id as string,
      customer_id: (r.customer_id as string) ?? null, package_name: (r.package_name as string) ?? null,
      delivery_method_frozen: (r.delivery_method_frozen as string) ?? null,
      delivery_time_frozen: (r.delivery_time_frozen as string) ?? null,
      delivery_area_frozen: (r.delivery_area_frozen as string) ?? null,
      packing_status: r.packing_status as OrderPackStatus,
      label_printed_at: r.label_printed_at instanceof Date ? r.label_printed_at.toISOString() : (r.label_printed_at as string) ?? null,
      packed_by: (r.packed_by as string) ?? null,
      packed_at: r.packed_at instanceof Date ? r.packed_at.toISOString() : (r.packed_at as string) ?? null,
      notes: (r.notes as string) ?? null,
      ...(r.customer_name !== undefined ? { customer_name: (r.customer_name as string) ?? null } : {}),
    };
  }

  private dateStr(value: unknown): string {
    if (value instanceof Date) {
      const y = value.getFullYear(); const m = String(value.getMonth() + 1).padStart(2, '0'); const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
  }
}
