import type { Pool } from 'pg';

// WP-UI-03c audit log (read path). The audit module is append-only and previously had
// no read surface (writes go through AuditService.writeInTx inside business txns). This
// is a filterable, capped, read-only query — all filters are bound params (no interpolation).

export interface AuditRow {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_role: string | null;
  entity_type: string;
  entity_id: string;
  severity: 'info' | 'warn' | 'high';
  reason: string | null;
  occurred_at: string;
  related_refs: Record<string, unknown>;
  before: unknown;
  after: unknown;
}

export interface AuditFilter {
  entityType?: string;
  severity?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

export class AuditQueryService {
  constructor(private readonly pool: Pool) {}

  async list(filter: AuditFilter = {}): Promise<AuditRow[]> {
    const limit = Math.min(Math.max(Math.trunc(Number(filter.limit)) || 100, 1), 100);
    const offset = Math.max(Math.trunc(Number(filter.offset)) || 0, 0);
    const { rows } = await this.pool.query(
      `SELECT id, event_type, actor_id, actor_role, entity_type, entity_id, severity,
              reason, occurred_at, related_refs, before, after
         FROM audit_event
        WHERE ($1::text IS NULL OR entity_type = $1)
          AND ($2::text IS NULL OR severity = $2)
          AND ($3::text IS NULL OR event_type = $3)
        ORDER BY occurred_at DESC
        LIMIT $4 OFFSET $5`,
      [filter.entityType ?? null, filter.severity ?? null, filter.eventType ?? null, limit, offset],
    );
    return rows.map((r) => ({
      id: r.id as string,
      event_type: r.event_type as string,
      actor_id: (r.actor_id as string | null) ?? null,
      actor_role: (r.actor_role as string | null) ?? null,
      entity_type: r.entity_type as string,
      entity_id: r.entity_id as string,
      severity: r.severity as AuditRow['severity'],
      reason: (r.reason as string | null) ?? null,
      occurred_at: r.occurred_at as string,
      related_refs: (r.related_refs ?? {}) as Record<string, unknown>,
      before: r.before ?? null,
      after: r.after ?? null,
    }));
  }
}
