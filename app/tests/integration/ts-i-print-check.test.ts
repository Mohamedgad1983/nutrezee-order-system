// WP-OPS-A85 — print page state of the Batch Labels vs legacy screen check (TS-I).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { PrintCheckError, PrintCheckService } from '../../apps/api/src/modules/m25-label/print-check.service';
import { freshDb } from '../helpers/db';

let pool: Pool;
let checks: PrintCheckService;
const actor = { staffId: 'fleetbase:operator-1', roles: ['fleetbase_operator'], permissions: [] } as unknown as StaffContext;
const DAY = '2099-05-11';

/** What the host check writes when it finishes (same statement shape as print-status.py). */
async function hostResult(status: string, minutesAgo: number, differences: number, extra: Record<string, unknown> = {}) {
  await pool.query(
    `INSERT INTO label_print_check (id, delivery_date, status, requested_at, finished_at, screen_orders, labels,
                                    differences, without_driver, whatsapp_labels, detail)
     VALUES ($1, $2, $3, now() - make_interval(mins => $4), now() - make_interval(mins => $4), 773, 773, $5, 0, 33, $6)`,
    [`r-${Math.random()}`, DAY, status, minutesAgo, differences, JSON.stringify(extra)],
  );
}

describe('TS-I print check on the print page (A85)', () => {
  beforeAll(async () => {
    pool = await freshDb();
    checks = new PrintCheckService(pool, new AuditService(pool));
  });
  afterAll(async () => { await pool.end(); });

  it('a day never checked is not verified, and opening the page asks for a check once', async () => {
    expect(await checks.state(DAY)).toMatchObject({ latest: null, pending: null, verified: false });
    const first = await checks.ensureFresh(actor, DAY);
    expect(first.pending).not.toBeNull();
    const again = await checks.ensureFresh(actor, DAY);
    expect(again.pending?.id).toBe(first.pending?.id);
    const rows = await pool.query(`SELECT count(*)::int n FROM label_print_check WHERE status = 'requested'`);
    expect(rows.rows[0].n).toBe(1);
    const audit = await pool.query(`SELECT count(*)::int n FROM audit_event WHERE event_type = 'label.print_check_requested'`);
    expect(audit.rows[0].n).toBe(1);
  });

  it('only a fresh result with zero differences is verified', async () => {
    await pool.query(`UPDATE label_print_check SET status = 'ok', finished_at = now() - interval '30 minutes', differences = 0`);
    expect(await checks.state(DAY)).toMatchObject({ verified: false, latest: { status: 'ok', fresh: false } });
    await hostResult('ok', 2, 0);
    const ok = await checks.state(DAY);
    expect(ok).toMatchObject({ verified: true, pending: null, latest: { status: 'ok', fresh: true, labels: 773, whatsapp_labels: 33 } });
    // fresh result: opening the page asks for nothing
    expect((await checks.ensureFresh(actor, DAY)).pending).toBeNull();
    await hostResult('differences', 1, 2, { no_label: ['30001', '30002'] });
    expect(await checks.state(DAY)).toMatchObject({
      verified: false, latest: { status: 'differences', differences: 2, detail: { no_label: ['30001', '30002'] } },
    });
    await hostResult('failed', 0, 0);
    expect((await checks.state(DAY)).verified).toBe(false);
  });

  it('a request nobody served stops blocking after its time and a new one can be made', async () => {
    await pool.query(`DELETE FROM label_print_check`);
    await checks.ensureFresh(actor, DAY);
    await pool.query(`UPDATE label_print_check SET requested_at = now() - interval '25 minutes'`);
    expect((await checks.state(DAY)).pending).toBeNull();
    expect((await checks.ensureFresh(actor, DAY)).pending).not.toBeNull();
    await expect(checks.state('tomorrow')).rejects.toBeInstanceOf(PrintCheckError);
  });
});
