// WP-OPS-A85 — "do the labels match the legacy admin right now?" on the print page itself.
// The comparison is done by the owner-run host check (the only reader of the legacy screen); it writes
// each result to label_print_check. This module reads the latest result and records an operator's
// need for a fresh check (recorded automatically when the print page is opened on a stale result),
// which the host picks up within a minute. The operator never has to ask for anything.
import type { Pool } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { withTransaction } from '../../platform/db/tx';
import { newId } from '../../platform/ids';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A request older than this was not served (host check down); the page stops waiting for it. */
const REQUEST_TTL_MIN = 20;
/** A result older than this no longer proves anything about "now". */
export const PRINT_CHECK_FRESH_MIN = 10;

export class PrintCheckError extends Error {
  constructor(readonly code: 'validation_failed', readonly detail?: unknown) { super(code); }
}

export interface PrintCheckResult {
  status: 'ok' | 'differences' | 'failed';
  finished_at: string;
  age_seconds: number;
  fresh: boolean;
  screen_orders: number | null;
  labels: number | null;
  differences: number | null;
  without_driver: number | null;
  whatsapp_labels: number | null;
  detail: Record<string, unknown>;
}

export interface PrintCheckState {
  delivery_date: string;
  latest: PrintCheckResult | null;
  pending: { id: string; requested_at: string } | null;
  /** The only state in which the page says "matches legacy": a fresh check with zero differences. */
  verified: boolean;
}

export class PrintCheckService {
  constructor(private readonly pool: Pool, private readonly audit: AuditService) {}

  async state(deliveryDate: string): Promise<PrintCheckState> {
    if (!DATE_RE.test(deliveryDate ?? '')) throw new PrintCheckError('validation_failed', { field: 'delivery_date' });
    const [latest, pending] = await Promise.all([
      this.pool.query(
        `SELECT status, finished_at, extract(epoch FROM now() - finished_at)::int AS age_seconds,
                screen_orders, labels, differences, without_driver, whatsapp_labels, detail
           FROM label_print_check
          WHERE delivery_date = $1 AND status <> 'requested'
          ORDER BY finished_at DESC LIMIT 1`, [deliveryDate]),
      this.pool.query(
        `SELECT id, requested_at FROM label_print_check
          WHERE delivery_date = $1 AND status = 'requested'
            AND requested_at > now() - make_interval(mins => $2)
          ORDER BY requested_at ASC LIMIT 1`, [deliveryDate, REQUEST_TTL_MIN]),
    ]);
    const row = latest.rows[0] as Record<string, unknown> | undefined;
    const result: PrintCheckResult | null = row ? {
      status: row.status as PrintCheckResult['status'],
      finished_at: (row.finished_at as Date).toISOString(),
      age_seconds: Number(row.age_seconds),
      fresh: Number(row.age_seconds) <= PRINT_CHECK_FRESH_MIN * 60,
      screen_orders: numberOrNull(row.screen_orders), labels: numberOrNull(row.labels),
      differences: numberOrNull(row.differences), without_driver: numberOrNull(row.without_driver),
      whatsapp_labels: numberOrNull(row.whatsapp_labels),
      detail: (row.detail as Record<string, unknown>) ?? {},
    } : null;
    const open = pending.rows[0] as { id: string; requested_at: Date } | undefined;
    return {
      delivery_date: deliveryDate,
      latest: result,
      pending: open ? { id: open.id, requested_at: open.requested_at.toISOString() } : null,
      verified: !!result && result.status === 'ok' && result.fresh && result.differences === 0,
    };
  }

  /**
   * Called when the print page opens or refreshes: nobody presses anything. When the latest check
   * is no longer fresh, a request is recorded so the host runs one within a minute.
   */
  async ensureFresh(actor: StaffContext, deliveryDate: string): Promise<PrintCheckState> {
    const current = await this.state(deliveryDate);
    if (current.pending || current.latest?.fresh) return current;
    return this.request(actor, deliveryDate);
  }

  /** Ask the host for a check now. A request already waiting for that day is reused. */
  async request(actor: StaffContext, deliveryDate: string): Promise<PrintCheckState> {
    if (!DATE_RE.test(deliveryDate ?? '')) throw new PrintCheckError('validation_failed', { field: 'delivery_date' });
    await withTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`label_print_check:${deliveryDate}`]);
      const open = await client.query(
        `SELECT 1 FROM label_print_check
          WHERE delivery_date = $1 AND status = 'requested' AND requested_at > now() - make_interval(mins => $2)`,
        [deliveryDate, REQUEST_TTL_MIN],
      );
      if ((open.rowCount ?? 0) > 0) return;
      const id = newId();
      await client.query(
        `INSERT INTO label_print_check (id, delivery_date, status, requested_by) VALUES ($1, $2, 'requested', $3)`,
        [id, deliveryDate, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'label.print_check_requested',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'label_print_check', entityId: id,
        severity: 'info',
        relatedRefs: { delivery_date: deliveryDate },
      });
    });
    return this.state(deliveryDate);
  }
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
