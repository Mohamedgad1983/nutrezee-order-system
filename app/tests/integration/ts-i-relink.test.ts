import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';

// TS-I — m22 relink SQL contract (migration 0019): promoting a now-resolvable missing_order_link
// exception is idempotent, never duplicates a meal-day, marks the exception resolved WITHOUT
// deleting it, and leaves still-unresolvable exceptions open.

let pool: Pool;
let orderId: string;
let customerId: string;
let parentId: string;
let runId: string;

beforeAll(async () => {
  pool = await freshDb();
  customerId = newId();
  orderId = newId();
  parentId = newId();
  runId = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Relink Cust','test')`, [customerId]);
  await pool.query(
    `INSERT INTO customer_order (id, order_number, customer_id, status, start_date, end_date, channel, created_by)
     VALUES ($1,'N-RL-1',$2,'active','2026-06-01','2026-06-30','phone','test')`,
    [orderId, customerId],
  );
  // the order is NOW in sync_record under legacy order_number 24640 (it advanced past the watermark)
  await pool.query(
    `INSERT INTO sync_record (id, object_type, legacy_key, new_ref, created_by) VALUES ($1,'order','24640',$2,'test')`,
    [newId(), orderId],
  );
  await pool.query(
    `INSERT INTO customer_meal_history_import_runs (id, mode, scope, status, created_by) VALUES ($1,'apply','relink','running','test')`,
    [runId],
  );
  await pool.query(
    `INSERT INTO legacy_meal_history_raw (id, source_system, source_name, source_record_id, payload, raw_sha)
     VALUES ($1,'nutreeze.com','getMealsDateWiseFilter','23640','{"dates":["2026-06-05"]}','SHA-RL')`,
    [newId()],
  );
  // parent imported earlier as an exception (unlinked), with an open missing_order_link exception
  await pool.query(
    `INSERT INTO customer_meal_history (id, legacy_order_id, legacy_order_number, meal_day_count, import_status, source_sha)
     VALUES ($1,'23640','24640',1,'exception','SHA-RL')`,
    [parentId],
  );
  await pool.query(
    `INSERT INTO customer_meal_history_exceptions (id, legacy_order_id, meal_date, reason, detail)
     VALUES ($1,'23640','2026-06-05','missing_order_link','{"order_number":"24640"}')`,
    [newId()],
  );
  // a second exception whose order is NOT in sync_record -> must stay open
  await pool.query(
    `INSERT INTO customer_meal_history_exceptions (id, legacy_order_id, meal_date, reason, detail)
     VALUES ($1,'23999','2026-06-06','missing_order_link','{"order_number":"24670"}')`,
    [newId()],
  );
}, 60_000);

afterAll(async () => { await pool.end(); });

async function relinkResolvableOrder(): Promise<{ promoted: number; marked: number }> {
  // mirrors meal-history-relink.mjs apply for the one resolvable order (23640 -> 24640 -> orderId)
  const ins = await pool.query(
    `INSERT INTO customer_meal_history_items (id, meal_history_id, legacy_order_id, order_id, meal_date, source_sha, import_run_id)
     VALUES ($1,$2,'23640',$3,'2026-06-05','SHA-RL',$4) ON CONFLICT DO NOTHING RETURNING id`,
    [newId(), parentId, orderId, runId],
  );
  await pool.query(
    `UPDATE customer_meal_history SET order_id=$1, customer_id=$2, import_status='imported', updated_at=now()
     WHERE legacy_order_id='23640' AND order_id IS NULL`,
    [orderId, customerId],
  );
  const marked = await pool.query(
    `UPDATE customer_meal_history_exceptions
       SET resolution_status='resolved', resolved_at=now(), resolved_by_run_id=$1,
           resolution_note='relinked: order now resolvable via sync_record'
     WHERE legacy_order_id='23640' AND reason='missing_order_link' AND resolution_status='open' RETURNING id`,
    [runId],
  );
  return { promoted: ins.rows.length, marked: marked.rows.length };
}

describe('TS-I meal-history relink', () => {
  it('promotes a now-resolvable exception, links the parent, and marks (not deletes) the exception', async () => {
    const r = await relinkResolvableOrder();
    expect(r.promoted).toBe(1);
    expect(r.marked).toBe(1);
    const item = await pool.query(`SELECT order_id FROM customer_meal_history_items WHERE legacy_order_id='23640'`);
    expect(item.rows[0].order_id).toBe(orderId);
    const parent = await pool.query(`SELECT order_id, import_status FROM customer_meal_history WHERE legacy_order_id='23640'`);
    expect(parent.rows[0].order_id).toBe(orderId);
    expect(parent.rows[0].import_status).toBe('imported');
    const exc = await pool.query(`SELECT resolution_status FROM customer_meal_history_exceptions WHERE legacy_order_id='23640'`);
    expect(exc.rows[0].resolution_status).toBe('resolved');   // marked
  });

  it('is idempotent: a second relink promotes 0 items and re-marks 0 exceptions', async () => {
    const r = await relinkResolvableOrder();
    expect(r.promoted).toBe(0);         // ON CONFLICT DO NOTHING -> no duplicate meal-day
    expect(r.marked).toBe(0);           // already resolved -> WHERE resolution_status='open' matches nothing
    const n = await pool.query(`SELECT count(*)::int AS n FROM customer_meal_history_items WHERE legacy_order_id='23640' AND meal_date='2026-06-05'`);
    expect(n.rows[0].n).toBe(1);        // still exactly one clean meal-day
  });

  it('never deletes a resolved exception (audit trail survives)', async () => {
    const n = await pool.query(`SELECT count(*)::int AS n FROM customer_meal_history_exceptions WHERE legacy_order_id='23640'`);
    expect(n.rows[0].n).toBe(1);        // the row is still there, just marked resolved
  });

  it('leaves a still-unresolvable exception open (order not in sync_record)', async () => {
    const exc = await pool.query(`SELECT resolution_status FROM customer_meal_history_exceptions WHERE legacy_order_id='23999'`);
    expect(exc.rows[0].resolution_status).toBe('open');
    const promoted = await pool.query(`SELECT count(*)::int AS n FROM customer_meal_history_items WHERE legacy_order_id='23999'`);
    expect(promoted.rows[0].n).toBe(0);   // nothing promoted for the unresolved order
  });
});
