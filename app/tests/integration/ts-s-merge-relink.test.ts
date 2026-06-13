import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditReadQueue, AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { MergeService } from '../../apps/api/src/modules/m04-customers/merge.service';
import { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { newId } from '../../apps/api/src/platform/ids';

// WP-API-02: the merge re-link HOOK was proven against a scratch step in ts-s-merge.
// This exercises the REAL owning-module steps (DraftService/OrderService customerRelinkStep)
// end-to-end against draft_order + customer_order — the FKs a live merge previously left
// pointing at the deactivated loser.
let pool: Pool;
let customers: CustomerService;
let merges: MergeService;
const ops: StaffContext = { staffId: 'ops-1', name: 'O', email: 'o@t', locale: 'en', roles: ['ops_manager'], sessionId: 's' };

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  const settings = new SettingsReader(pool, 0);
  customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), new OutboxService(), settings);
  merges = new MergeService(pool, audit, new OutboxService(), settings);
  merges.registerRelinkStep(DraftService.customerRelinkStep());
  merges.registerRelinkStep(OrderService.customerRelinkStep());
}, 60_000);
afterAll(async () => { await pool.end(); });

describe('WP-API-02 — real draft_order + customer_order re-link on merge/undo', () => {
  it('re-points the loser\'s draft + order FKs to the winner, and restores them on undo', async () => {
    const winner = await customers.createGuided(ops, { fullNameEn: 'Win', phone: '0561110000' });
    const loser = await customers.createGuided(ops, { fullNameEn: 'Lose', phone: '0562220000' });

    const draftId = newId();
    await pool.query('INSERT INTO draft_order (id, channel, customer_id) VALUES ($1, $2, $3)', [draftId, 'phone', loser]);
    const orderId = newId();
    await pool.query(
      `INSERT INTO customer_order (id, order_number, customer_id, start_date, end_date, channel)
       VALUES ($1, $2, $3, '2026-07-01', '2026-07-07', 'phone')`,
      [orderId, `N-${orderId.slice(-8)}`, loser],
    );

    const mergeId = await merges.merge(ops, winner, loser);

    const draftAfter = await pool.query('SELECT customer_id FROM draft_order WHERE id = $1', [draftId]);
    const orderAfter = await pool.query('SELECT customer_id FROM customer_order WHERE id = $1', [orderId]);
    const loserAfter = await pool.query('SELECT status FROM customer WHERE id = $1', [loser]);
    expect(draftAfter.rows[0].customer_id).toBe(winner);
    expect(orderAfter.rows[0].customer_id).toBe(winner);
    expect(loserAfter.rows[0].status).toBe('inactive');

    await merges.undo(ops, mergeId);

    const draftUndone = await pool.query('SELECT customer_id FROM draft_order WHERE id = $1', [draftId]);
    const orderUndone = await pool.query('SELECT customer_id FROM customer_order WHERE id = $1', [orderId]);
    const loserUndone = await pool.query('SELECT status FROM customer WHERE id = $1', [loser]);
    expect(draftUndone.rows[0].customer_id).toBe(loser);
    expect(orderUndone.rows[0].customer_id).toBe(loser);
    expect(loserUndone.rows[0].status).toBe('active');
  });
});
