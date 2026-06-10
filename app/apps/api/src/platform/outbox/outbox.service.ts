import type { Pool, PoolClient } from 'pg';
import { newId } from '../ids';

export interface DomainEvent {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  actor: { id: string; role: string } | { system: string };
  refs: Record<string, string>;
  payload: Record<string, unknown>;
}

// Transactional outbox (amendment A4a, backend_foundation §5): events are written in
// the SAME transaction as the business change; the dispatcher delivers after commit.
export class OutboxService {
  async writeInTx(
    client: PoolClient,
    e: Omit<DomainEvent, 'eventId' | 'occurredAt' | 'version'> & { version?: number },
  ): Promise<string> {
    const id = newId();
    await client.query(
      `INSERT INTO outbox_event (id, event_type, version, actor, refs, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, e.eventType, e.version ?? 1, JSON.stringify(e.actor), JSON.stringify(e.refs), JSON.stringify(e.payload)],
    );
    return id;
  }
}

export type EventHandler = (e: DomainEvent) => Promise<void>;

// In-process dispatcher [Proposed for MVP]. At-least-once: consumers dedupe on
// eventId (event_catalog rule). Security families are never written to the outbox.
export class OutboxDispatcher {
  private readonly handlers: EventHandler[] = [];

  constructor(private readonly pool: Pool) {}

  register(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /** One sweep over undispatched events. Returns number dispatched. */
  async sweep(limit = 100): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id, event_type, version, occurred_at, actor, refs, payload
       FROM outbox_event WHERE dispatched_at IS NULL ORDER BY occurred_at LIMIT $1`,
      [limit],
    );
    let dispatched = 0;
    for (const row of rows) {
      const event: DomainEvent = {
        eventId: row.id,
        eventType: row.event_type,
        version: row.version,
        occurredAt: row.occurred_at,
        actor: row.actor,
        refs: row.refs,
        payload: row.payload,
      };
      try {
        for (const h of this.handlers) await h(event);
        await this.pool.query('UPDATE outbox_event SET dispatched_at = now() WHERE id = $1', [row.id]);
        dispatched += 1;
      } catch {
        break; // leave undispatched (ordering per subject preserved); retried next sweep
      }
    }
    return dispatched;
  }

  /** Outbox lag gauge (backend_foundation §9). */
  async undispatchedCount(): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS n FROM outbox_event WHERE dispatched_at IS NULL',
    );
    return rows[0]?.n ?? 0;
  }
}
