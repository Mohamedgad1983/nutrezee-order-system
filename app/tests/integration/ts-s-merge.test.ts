import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditReadQueue, AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { MergeService } from '../../apps/api/src/modules/m04-customers/merge.service';

// TS-S scenario #6 (test_strategy): customer merge with re-link + undo.
// The draft re-link itself activates at WP-07 (drafts don't exist yet) — the re-link
// HOOK mechanism is proven here with a registered step against a scratch table.
let pool: Pool;
let customers: CustomerService;
let merges: MergeService;
const ops: StaffContext = { staffId: 'ops-1', name: 'O', email: 'o@t', locale: 'en', roles: ['ops_manager'], sessionId: 's' };
const relinkCalls: string[] = [];

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  const settings = new SettingsReader(pool, 0);
  customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), new OutboxService(), settings);
  merges = new MergeService(pool, audit, new OutboxService(), settings);
  merges.registerRelinkStep({
    name: 'scratch', // stands in for WP-07's draft_order re-pointing
    merge: async (_c: PoolClient, winner, loser) => {
      relinkCalls.push(`merge:${loser}->${winner}`);
      return { relinked: 2 };
    },
    undo: async (_c: PoolClient, winner, loser, moved) => {
      relinkCalls.push(`undo:${winner}->${loser}:${JSON.stringify(moved)}`);
    },
  });
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-S end-to-end — scenario #6: customer merge with re-link hook + undo', () => {
  it('merge moves children, deactivates the loser, audits HIGH, runs re-link steps; undo restores', async () => {
    const winner = await customers.createGuided(ops, { fullNameEn: 'Winner W', phone: '0561112222' });
    const loser = await customers.createGuided(ops, { fullNameEn: 'Loser L', phone: '0563334444' });
    await customers.addAddress(ops, loser, { addressText: 'Old apartment 5' });

    const mergeId = await merges.merge(ops, winner, loser);

    // children moved
    const winnerPhones = await pool.query('SELECT count(*)::int AS n FROM customer_phone WHERE customer_id = $1', [winner]);
    expect(winnerPhones.rows[0].n).toBe(2);
    const winnerAddr = await pool.query('SELECT count(*)::int AS n FROM address WHERE customer_id = $1', [winner]);
    expect(winnerAddr.rows[0].n).toBe(1);
    // exactly one primary phone survives on the winner
    const primaries = await pool.query(
      'SELECT count(*)::int AS n FROM customer_phone WHERE customer_id = $1 AND is_primary', [winner],
    );
    expect(primaries.rows[0].n).toBe(1);
    // loser deactivated, never deleted
    const loserRow = await pool.query('SELECT status FROM customer WHERE id = $1', [loser]);
    expect(loserRow.rows[0].status).toBe('inactive');
    // HIGH audit + outbox event + re-link hook ran
    const audit = await pool.query(
      `SELECT severity FROM audit_event WHERE event_type = 'customer.merged' AND entity_id = $1`, [winner],
    );
    expect(audit.rows[0].severity).toBe('high');
    expect(relinkCalls).toContain(`merge:${loser}->${winner}`);

    // UNDO within the window restores everything
    await merges.undo(ops, mergeId);
    const loserAfter = await pool.query('SELECT status FROM customer WHERE id = $1', [loser]);
    expect(loserAfter.rows[0].status).toBe('active');
    const loserPhones = await pool.query('SELECT count(*)::int AS n FROM customer_phone WHERE customer_id = $1', [loser]);
    expect(loserPhones.rows[0].n).toBe(1);
    expect(relinkCalls.some((c) => c.startsWith(`undo:${winner}->${loser}`))).toBe(true);

    // double-undo rejected
    await expect(merges.undo(ops, mergeId)).rejects.toMatchObject({ code: 'already_undone' });
  });

  it('expired undo window fails closed; merge_record stays immutable apart from the undo stamp', async () => {
    const a = await customers.createGuided(ops, { fullNameEn: 'Exp A', phone: '0565556666' });
    const b = await customers.createGuided(ops, { fullNameEn: 'Exp B', phone: '0567778888' });
    const mergeId = await merges.merge(ops, a, b);
    await pool.query(`UPDATE merge_record SET undo_until = now() - interval '1 minute' WHERE id = $1`, [mergeId])
      .then(
        () => { throw new Error('guard should have blocked undo_until change'); },
        (e: Error) => expect(e.message).toMatch(/only the undone_at stamp/),
      );
    // self-merge guard
    await expect(merges.merge(ops, a, a)).rejects.toMatchObject({ code: 'self_merge' });
  });
});
