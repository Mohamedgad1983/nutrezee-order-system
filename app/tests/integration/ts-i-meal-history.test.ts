import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';

// TS-I — m22 meal-history schema guards (migration 0018): raw-hash dedup, no-duplicate-meal-day,
// FK links to customer_order/customer, import-run + exceptions trail.

let pool: Pool;
let orderId: string;
let customerId: string;

beforeAll(async () => {
  pool = await freshDb();
  customerId = newId();
  orderId = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Meal Cust','test')`, [customerId]);
  await pool.query(
    `INSERT INTO customer_order (id, order_number, customer_id, status, start_date, end_date, channel, created_by)
     VALUES ($1,'N-MH-1',$2,'active','2026-06-01','2026-06-30','phone','test')`,
    [orderId, customerId],
  );
}, 60_000);

afterAll(async () => { await pool.end(); });

describe('TS-I meal-history schema', () => {
  let runId: string;
  let historyId: string;

  it('records an import run with counts jsonb', async () => {
    runId = newId();
    await pool.query(
      `INSERT INTO customer_meal_history_import_runs (id, mode, scope, window_from, window_to, counts, status, created_by)
       VALUES ($1,'dry_run','last_30_days','2026-05-18','2026-06-17','{"records_seen":3}','ok','test')`,
      [runId],
    );
    const { rows } = await pool.query(`SELECT counts->>'records_seen' AS n FROM customer_meal_history_import_runs WHERE id=$1`, [runId]);
    expect(rows[0].n).toBe('3');
  });

  it('rejects an invalid mode/scope/reason by CHECK', async () => {
    await expect(pool.query(
      `INSERT INTO customer_meal_history_import_runs (id, mode, scope, created_by) VALUES ($1,'live','last_30_days','t')`,
      [newId()],
    )).rejects.toThrow(/check constraint/i);
  });

  it('dedups the raw archive by raw_sha', async () => {
    await pool.query(
      `INSERT INTO legacy_meal_history_raw (id, source_system, source_name, source_record_id, payload, raw_sha, import_run_id)
       VALUES ($1,'nutreeze.com','getMealsDateWiseFilter','21274','{"dates":["2026-06-01"]}','SHA-1',$2)`,
      [newId(), runId],
    );
    await expect(pool.query(
      `INSERT INTO legacy_meal_history_raw (id, source_system, source_name, source_record_id, payload, raw_sha)
       VALUES ($1,'nutreeze.com','getMealsDateWiseFilter','21274','{}','SHA-1')`,
      [newId()],
    )).rejects.toThrow(/duplicate key/);
  });

  it('links a clean meal-history row to the new order + customer', async () => {
    historyId = newId();
    await pool.query(
      `INSERT INTO customer_meal_history
         (id, import_run_id, legacy_order_id, legacy_order_number, order_id, customer_id,
          meal_date_from, meal_date_to, meal_day_count, meal_types, import_status, source_sha)
       VALUES ($1,$2,'21274','24675',$3,$4,'2026-06-01','2026-06-10',2,'["breakfast","snack"]','imported','SHA-1')`,
      [historyId, runId, orderId, customerId],
    );
    const { rows } = await pool.query(
      `SELECT cmh.id, co.order_number, c.full_name_en
       FROM customer_meal_history cmh JOIN customer_order co ON co.id=cmh.order_id
       JOIN customer c ON c.id=cmh.customer_id WHERE cmh.id=$1`, [historyId],
    );
    expect(rows[0].order_number).toBe('N-MH-1');
  });

  it('enforces one meal-history row per legacy order', async () => {
    await expect(pool.query(
      `INSERT INTO customer_meal_history (id, legacy_order_id) VALUES ($1,'21274')`, [newId()],
    )).rejects.toThrow(/duplicate key/);
  });

  it('blocks duplicate meal days but allows different dates/types', async () => {
    await pool.query(
      `INSERT INTO customer_meal_history_items (id, meal_history_id, legacy_order_id, order_id, meal_date, meal_type, source_sha, import_run_id)
       VALUES ($1,$2,'21274',$3,'2026-06-01','breakfast','SHA-1',$4)`,
      [newId(), historyId, orderId, runId],
    );
    // different type same day — allowed
    await pool.query(
      `INSERT INTO customer_meal_history_items (id, meal_history_id, legacy_order_id, order_id, meal_date, meal_type)
       VALUES ($1,$2,'21274',$3,'2026-06-01','snack')`,
      [newId(), historyId, orderId],
    );
    // exact duplicate (order, date, type) — rejected
    await expect(pool.query(
      `INSERT INTO customer_meal_history_items (id, meal_history_id, legacy_order_id, order_id, meal_date, meal_type)
       VALUES ($1,$2,'21274',$3,'2026-06-01','breakfast')`,
      [newId(), historyId, orderId],
    )).rejects.toThrow(/duplicate key/);
  });

  it('apply is idempotent via ON CONFLICT DO NOTHING (raw + items)', async () => {
    // mirrors the runner's exact idempotency statements: a re-applied last-30-days import must not
    // duplicate raw rows or clean meal-day items.
    const insRaw = `INSERT INTO legacy_meal_history_raw
        (id, source_system, source_name, source_record_id, payload, raw_sha)
      VALUES ($1,'nutreeze.com','getMealsDateWiseFilter','30001','{"dates":["2026-06-02"]}','SHA-IDEMP')
      ON CONFLICT (raw_sha) DO NOTHING RETURNING id`;
    const r1 = await pool.query(insRaw, [newId()]);
    const r2 = await pool.query(insRaw, [newId()]);   // re-run
    expect(r1.rowCount).toBe(1);
    expect(r2.rowCount).toBe(0);                       // no duplicate raw archived

    const insItem = `INSERT INTO customer_meal_history_items
        (id, meal_history_id, legacy_order_id, order_id, meal_date)
      VALUES ($1,$2,'21274',$3,'2026-06-02') ON CONFLICT DO NOTHING RETURNING id`;
    const i1 = await pool.query(insItem, [newId(), historyId, orderId]);
    const i2 = await pool.query(insItem, [newId(), historyId, orderId]);   // re-run
    expect(i1.rowCount).toBe(1);
    expect(i2.rowCount).toBe(0);                       // no duplicate clean meal-day
    const total = await pool.query(`SELECT count(*)::int AS n FROM customer_meal_history_items WHERE legacy_order_id='21274' AND meal_date='2026-06-02'`);
    expect(total.rows[0].n).toBe(1);
  });

  it('stores exceptions separately with a constrained reason and no PII', async () => {
    await pool.query(
      `INSERT INTO customer_meal_history_exceptions (id, import_run_id, legacy_order_id, meal_date, reason, detail)
       VALUES ($1,$2,'99999','2026-06-05','missing_order_link','{"order_number":"99999"}')`,
      [newId(), runId],
    );
    await expect(pool.query(
      `INSERT INTO customer_meal_history_exceptions (id, legacy_order_id, reason) VALUES ($1,'1','not_a_reason')`,
      [newId()],
    )).rejects.toThrow(/check constraint/i);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM customer_meal_history_exceptions WHERE reason='missing_order_link'`);
    expect(rows[0].n).toBe(1);
  });
});
