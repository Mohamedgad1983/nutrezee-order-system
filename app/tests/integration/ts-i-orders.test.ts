import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';

let pool: Pool;
let orderId: string;

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
  await pool.query(
    `INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Persistence Customer','test')`,
    [customerId],
  );
  await pool.query(
    `INSERT INTO customer_order
      (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by)
     VALUES ($1,'N-I-ORDER-1',$2,'approved','2099-01-01','2099-01-03','phone',0,'test')`,
    [id, customerId],
  );
  return id;
}

describe('TS-I integration — WP-09 order persistence guards', () => {
  it('rejects UPDATE and DELETE on frozen order_item rows at the database', async () => {
    const itemId = newId();
    await pool.query(
      `INSERT INTO order_item (id, order_id, name_frozen_en, qty, unit_price_frozen, created_by)
       VALUES ($1,$2,'Frozen Meal',1,500,'test')`,
      [itemId, orderId],
    );
    await expect(pool.query(`UPDATE order_item SET qty = 2 WHERE id = $1`, [itemId])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM order_item WHERE id = $1`, [itemId])).rejects.toThrow(/append-only/);
  });

  it('rejects UPDATE and DELETE on order_status_history rows at the database', async () => {
    const historyId = newId();
    await pool.query(
      `INSERT INTO order_status_history (id, subject, subject_ref, from_status, to_status, actor_id)
       VALUES ($1,'order',$2,NULL,'approved','ops-i')`,
      [historyId, orderId],
    );
    await expect(pool.query(`UPDATE order_status_history SET to_status = 'active' WHERE id = $1`, [historyId]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM order_status_history WHERE id = $1`, [historyId]))
      .rejects.toThrow(/append-only/);
  });

  it('enforces one fulfillment_day per order/date', async () => {
    await pool.query(
      `INSERT INTO fulfillment_day (id, order_id, date, address_frozen, created_by)
       VALUES ($1,$2,'2099-01-01','{}','test')`,
      [newId(), orderId],
    );
    await expect(pool.query(
      `INSERT INTO fulfillment_day (id, order_id, date, address_frozen, created_by)
       VALUES ($1,$2,'2099-01-01','{}','test')`,
      [newId(), orderId],
    )).rejects.toThrow(/duplicate key/);
  });

  it('filters rich order lists by customer_id and safely returns no rows for unknown customers', async () => {
    const customerA = newId();
    const customerB = newId();
    await pool.query(
      `INSERT INTO customer (id, full_name_en, created_by) VALUES
        ($1,'Filter Customer A','test'), ($2,'Filter Customer B','test')`,
      [customerA, customerB],
    );
    await pool.query(
      `INSERT INTO customer_order
        (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by)
       VALUES
        ($1,'N-I-FILTER-A',$2,'approved','2099-02-01','2099-02-03','phone',1000,'test'),
        ($3,'N-I-FILTER-B',$4,'approved','2099-02-01','2099-02-03','phone',2000,'test')`,
      [newId(), customerA, newId(), customerB],
    );
    const orders = new OrderService(
      pool,
      {} as ConstructorParameters<typeof OrderService>[1],
      {} as ConstructorParameters<typeof OrderService>[2],
      { get: vi.fn().mockResolvedValue('none') } as unknown as ConstructorParameters<typeof OrderService>[3],
      { registerValidator: vi.fn() } as unknown as ConstructorParameters<typeof OrderService>[4],
      {} as ConstructorParameters<typeof OrderService>[5],
      {} as ConstructorParameters<typeof OrderService>[6],
      {} as ConstructorParameters<typeof OrderService>[7],
      {} as ConstructorParameters<typeof OrderService>[8],
    );

    const filtered = await orders.listOrdersRich({ customerId: customerA, limit: 50, offset: 0 });
    expect(filtered.total).toBe(1);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]).toMatchObject({ order_number: 'N-I-FILTER-A', customer_id: customerA });

    const unknown = await orders.listOrdersRich({ customerId: newId(), limit: 50, offset: 0 });
    expect(unknown.total).toBe(0);
    expect(unknown.rows).toEqual([]);
  });
});
