import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { FeatureFlagService } from '../../apps/api/src/platform/feature-flags/feature-flag.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CutoverFlagService } from '../../apps/api/src/modules/m18-bridge/cutover-flag.service';
import { ReconciliationService } from '../../apps/api/src/modules/m18-bridge/reconciliation.service';

let pool: Pool;
let reconciliation: ReconciliationService;
let cutover: CutoverFlagService;

const ops: StaffContext = {
  staffId: 'ops-wp13', name: 'Ops WP13', email: 'ops-wp13@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-ops',
};

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  reconciliation = new ReconciliationService(pool, audit, new OutboxService());
  cutover = new CutoverFlagService(pool, audit, new FeatureFlagService(pool));
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-I integration — bridge reconciliation and cutover flags (WP-13)', () => {
  it('records divergent reconciliation runs as append-only records with audit and outbox', async () => {
    const run = await reconciliation.record(ops, {
      runType: 'payments',
      counts: { legacy: 10, new: 9 },
      diffs: { missing: ['legacy-pay-9'] },
    });
    expect(run).toMatchObject({ run_type: 'payments', state: 'divergent' });

    await expect(pool.query(`UPDATE reconciliation_run SET state = 'ok' WHERE id = $1`, [run.id]))
      .rejects.toThrow(/append-only table/);
    await expect(pool.query(`DELETE FROM reconciliation_run WHERE id = $1`, [run.id]))
      .rejects.toThrow(/append-only table/);

    const audit = await pool.query(`SELECT severity FROM audit_event WHERE event_type = 'bridge.reconciliation_run' AND entity_id = $1`, [run.id]);
    expect(audit.rows[0].severity).toBe('warn');
    const outbox = await pool.query(`SELECT payload FROM outbox_event WHERE event_type = 'bridge.reconciliation_run'`);
    expect(outbox.rows[0].payload).toMatchObject({ run_type: 'payments', state: 'divergent' });
  });

  it('toggles cutover flags with HIGH audit while keeping flag writes in the platform owner path', async () => {
    await cutover.toggle(ops, 'cutover_intake', true, 'WP-13 rehearsal');

    const flag = await pool.query(`SELECT on_flag, note FROM feature_flag WHERE key = 'cutover_intake'`);
    expect(flag.rows[0]).toMatchObject({ on_flag: true, note: 'WP-13 rehearsal' });
    const audit = await pool.query(`SELECT severity, after FROM audit_event WHERE event_type = 'bridge.cutover_flag_changed'`);
    expect(audit.rows[0].severity).toBe('high');
    expect(audit.rows[0].after).toMatchObject({ key: 'cutover_intake', on_flag: true });
  });
});
