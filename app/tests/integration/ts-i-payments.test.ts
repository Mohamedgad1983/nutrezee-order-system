import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let orderId: string;
let orderSeq = 0;

beforeAll(async () => {
  pool = await freshDb();
  orderId = await seedOrder();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedOrder(): Promise<string> {
  const customerId = newId();
  const id = newId();
  orderSeq += 1;
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Payment Persist','test')`, [customerId]);
  await pool.query(
    `INSERT INTO customer_order
      (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by)
     VALUES ($1,$2,$3,'approved','2099-03-01','2099-03-02','phone',1000,'test')`,
    [id, `N-I-PAY-${orderSeq}`, customerId],
  );
  return id;
}

describe('TS-I integration — WP-11 payment persistence guards', () => {
  it('enforces one payment_record per order', async () => {
    await pool.query(
      `INSERT INTO payment_record (id, order_id, status, amount, created_by)
       VALUES ($1,$2,'unpaid',1000,'test')`,
      [newId(), orderId],
    );
    await expect(pool.query(
      `INSERT INTO payment_record (id, order_id, status, amount, created_by)
       VALUES ($1,$2,'unpaid',1000,'test')`,
      [newId(), orderId],
    )).rejects.toThrow(/duplicate key/);
  });

  it('rejects unknown payment statuses at the database', async () => {
    const otherOrder = await seedOrder();
    await expect(pool.query(
      `INSERT INTO payment_record (id, order_id, status, amount, created_by)
       VALUES ($1,$2,'gateway_pending',1000,'test')`,
      [newId(), otherOrder],
    )).rejects.toThrow(/violates check constraint/);
  });

  it('requires payment review items to point at existing payment records', async () => {
    await expect(pool.query(
      `INSERT INTO payment_review_item (id, payment_id, requested_status, requested_by)
       VALUES ($1,$2,'paid','agent')`,
      [newId(), 'missing-payment'],
    )).rejects.toThrow(/violates foreign key constraint/);
  });
});
