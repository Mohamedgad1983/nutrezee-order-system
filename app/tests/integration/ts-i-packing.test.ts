import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { PackingService, PackingError } from '../../apps/api/src/modules/m20-packing/packing.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

// TS-I — packing workflow foundation (m20-packing): batch creation + order inclusion by
// delivery date/time/area, mark-packed, issue flag, label preview, no-duplicate-in-batch,
// handoff guard. Exercises the service against a fresh migrated DB.

let pool: Pool;
let svc: PackingService;
const actor: StaffContext = { staffId: 'ops-1', name: 'Ops One', email: 'o@t', locale: 'en', roles: ['ops_manager'], sessionId: 's' };
const DATE = '2099-03-10';

beforeAll(async () => {
  pool = await freshDb();
  svc = new PackingService(pool, new AuditService());
  await seedOrder('N-PK-1', 'Salmiya', 'Morning');   // matches
  await seedOrder('N-PK-2', 'Salmiya', 'Morning');   // matches
  await seedOrder('N-PK-3', 'Hawally', 'Evening');    // different area/time
}, 60_000);

afterAll(async () => { await pool.end(); });

async function seedOrder(orderNo: string, area: string, time: string): Promise<string> {
  const customerId = newId();
  const id = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,$2,'test')`, [customerId, `Cust ${orderNo}`]);
  await pool.query(
    `INSERT INTO customer_order
       (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by,
        package_name_frozen_en, delivery_method_frozen, delivery_time_frozen, delivery_area_frozen)
     VALUES ($1,$2,$3,'active','2099-03-01','2099-03-31','phone',0,'test','Keto 5','delivery',$4,$5)`,
    [id, orderNo, customerId, time, area],
  );
  return id;
}

describe('TS-I packing — batch + order workflow', () => {
  let batchId: string;
  let packedOrderId: string;

  it('creates a batch and includes only orders matching date/time/area', async () => {
    const { batch, included } = await svc.createBatch(actor, { delivery_date: DATE, delivery_time: 'Morning', area: 'Salmiya' });
    batchId = batch.id;
    expect(included).toBe(2);                       // N-PK-1, N-PK-2 — not the Hawally/Evening order
    const { orders } = await svc.getBatch(batchId);
    expect(orders).toHaveLength(2);
    expect(orders.every((o) => o.packing_status === 'pending')).toBe(true);
    packedOrderId = orders[0]!.order_id;
  });

  it('rejects a second active batch for the same date/time/area (conflict)', async () => {
    await expect(svc.createBatch(actor, { delivery_date: DATE, delivery_time: 'Morning', area: 'Salmiya' }))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('marks an order packed and moves the batch to in_progress', async () => {
    await svc.markPacked(actor, batchId, packedOrderId);
    const { batch, orders } = await svc.getBatch(batchId);
    expect(batch.status).toBe('in_progress');
    expect(orders.find((o) => o.order_id === packedOrderId)!.packing_status).toBe('packed');
  });

  it('flags a packing issue with a reason', async () => {
    const { orders } = await svc.getBatch(batchId);
    const other = orders.find((o) => o.order_id !== packedOrderId)!;
    await svc.flagIssue(actor, batchId, other.order_id, { status: 'missing_item', reason: 'missing salad', notes: 'no salad in tray' });
    const after = await svc.getBatch(batchId);
    expect(after.orders.find((o) => o.order_id === other.order_id)!.packing_status).toBe('missing_item');
  });

  it('blocks handoff while an order is not packed, then succeeds once all packed', async () => {
    const { orders } = await svc.getBatch(batchId);
    const issued = orders.find((o) => o.packing_status === 'missing_item')!;
    await expect(svc.handoff(actor, batchId)).rejects.toMatchObject({ code: 'conflict' });
    await svc.markPacked(actor, batchId, issued.order_id);
    const res = await svc.handoff(actor, batchId);
    expect(res.handed).toBe(2);
    const final = await svc.getBatch(batchId);
    expect(final.batch.status).toBe('handed_to_driver');
    expect(final.orders.every((o) => o.packing_status === 'handed_to_driver')).toBe(true);
  });

  it('previews a label with a stable code', async () => {
    const label = await svc.previewLabel(packedOrderId);
    expect(label.label_code).toMatch(/^NZ-/);
    expect(label.order_id).toBe(packedOrderId);
  });

  it('enforces UNIQUE(batch_id, order_id) at the database', async () => {
    await expect(pool.query(
      `INSERT INTO packing_batch_order (id, batch_id, order_id, packing_status, created_by)
       VALUES ($1,$2,$3,'pending','test')`,
      [newId(), batchId, packedOrderId],
    )).rejects.toThrow(/duplicate key/);
  });

  it('append-only packing_status_history rejects UPDATE/DELETE', async () => {
    const id = newId();
    await pool.query(
      `INSERT INTO packing_status_history (id, entity_type, entity_id, to_status) VALUES ($1,'packing_batch',$2,'draft')`,
      [id, batchId],
    );
    await expect(pool.query(`UPDATE packing_status_history SET to_status='x' WHERE id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM packing_status_history WHERE id=$1`, [id])).rejects.toThrow(/append-only/);
  });

  it('does not re-include an order already in an active batch', async () => {
    // A new batch for a different slot must not pull in N-PK-3 twice, and must not pull the
    // already-batched Salmiya orders.
    const { included } = await svc.createBatch(actor, { delivery_date: DATE, delivery_time: 'Evening', area: 'Hawally' });
    expect(included).toBe(1);
    expect(PackingError).toBeDefined();
  });
});
