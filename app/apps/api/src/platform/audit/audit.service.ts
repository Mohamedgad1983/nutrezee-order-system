import type { Pool, PoolClient } from 'pg';
import { newId } from '../ids';

export type Severity = 'info' | 'warn' | 'high';

export interface AuditInput {
  eventType: string;
  actor: { id: string; role: string } | 'system';
  onBehalfOf?: string;
  entityType: string;
  entityId: string;
  relatedRefs?: Record<string, string>;
  before?: unknown;
  after?: unknown;
  severity: Severity;
  reason?: string;
  source?: Record<string, unknown>;
}

// ADR-005: the audit write happens INSIDE the business transaction — callers pass the
// transaction client. If this insert fails, the business write rolls back with it
// (TS-A acceptance test #3). No update/delete path exists anywhere in this module.
export class AuditService {
  async writeInTx(client: PoolClient, e: AuditInput): Promise<string> {
    const id = newId();
    const actorId = e.actor === 'system' ? null : e.actor.id;
    const actorRole = e.actor === 'system' ? 'system' : e.actor.role;
    await client.query(
      `INSERT INTO audit_event
        (id, event_type, actor_id, actor_role, on_behalf_of, entity_type, entity_id,
         related_refs, before, after, source, severity, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id, e.eventType, actorId, actorRole, e.onBehalfOf ?? null,
        e.entityType, e.entityId, JSON.stringify(e.relatedRefs ?? {}),
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
        e.source ? JSON.stringify(e.source) : null, e.severity, e.reason ?? null,
      ],
    );
    return id;
  }
}

// Sensitive READS are queued async-tolerant (audit_architecture §2): a cheap insert in
// the request path; a background drain moves rows into audit_event. Reads never block
// on audit-store health; state-changing writes do (they use writeInTx above).
export class AuditReadQueue {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  async enqueue(e: AuditInput): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_read_queue (id, payload) VALUES ($1, $2)',
      [newId(), JSON.stringify(e)],
    );
  }

  /** Drain queued read-audits into audit_event. Returns number drained. */
  async drain(limit = 100): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id, payload FROM audit_read_queue
       WHERE drained_at IS NULL ORDER BY enqueued_at LIMIT $1`,
      [limit],
    );
    let drained = 0;
    for (const row of rows) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await this.audit.writeInTx(client, row.payload as AuditInput);
        await client.query('UPDATE audit_read_queue SET drained_at = now() WHERE id = $1', [row.id]);
        await client.query('COMMIT');
        drained += 1;
      } catch {
        await client.query('ROLLBACK'); // stays queued; alarmed via queue-depth gauge
      } finally {
        client.release();
      }
    }
    return drained;
  }
}
