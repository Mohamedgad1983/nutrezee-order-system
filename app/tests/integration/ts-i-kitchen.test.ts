import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let dayId: string;

beforeAll(async () => {
  pool = await freshDb();
  dayId = await seedDay();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function seedDay(): Promise<string> {
  const customerId = newId();
  const orderId = newId();
  const id = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,'Kitchen I','test')`, [customerId]);
  await pool.query(
    `INSERT INTO customer_order
      (id, order_number, customer_id, status, start_date, end_date, channel, created_by)
     VALUES ($1,'N-K-I-1',$2,'approved','2099-02-01','2099-02-01','phone','test')`,
    [orderId, customerId],
  );
  await pool.query(
    `INSERT INTO fulfillment_day (id, order_id, date, status, address_frozen, created_by)
     VALUES ($1,$2,'2099-02-01','kitchen_queued','{}','test')`,
    [id, orderId],
  );
  return id;
}

describe('TS-I integration — WP-10 kitchen persistence guards', () => {
  it('enforces idempotent section and unrouted ticket batches', async () => {
    await pool.query(
      `INSERT INTO kitchen_ticket (id, fulfillment_day_id, section_id, item_refs, generation_batch, created_by)
       VALUES ($1,$2,'seed-section-hot','[]','batch-i','test')`,
      [newId(), dayId],
    );
    await expect(pool.query(
      `INSERT INTO kitchen_ticket (id, fulfillment_day_id, section_id, item_refs, generation_batch, created_by)
       VALUES ($1,$2,'seed-section-hot','[]','batch-i','test')`,
      [newId(), dayId],
    )).rejects.toThrow(/duplicate key/);

    await pool.query(
      `INSERT INTO kitchen_ticket (id, fulfillment_day_id, section_id, unrouted, item_refs, generation_batch, created_by)
       VALUES ($1,$2,NULL,true,'[]','batch-i','test')`,
      [newId(), dayId],
    );
    await expect(pool.query(
      `INSERT INTO kitchen_ticket (id, fulfillment_day_id, section_id, unrouted, item_refs, generation_batch, created_by)
       VALUES ($1,$2,NULL,true,'[]','batch-i','test')`,
      [newId(), dayId],
    )).rejects.toThrow(/duplicate key/);
  });

  it('rejects UPDATE and DELETE on ticket_status_event at the database', async () => {
    const ticketId = newId();
    await pool.query(
      `INSERT INTO kitchen_ticket (id, fulfillment_day_id, section_id, item_refs, generation_batch, created_by)
       VALUES ($1,$2,'seed-section-cold','[]','batch-history','test')`,
      [ticketId, dayId],
    );
    const eventId = newId();
    await pool.query(
      `INSERT INTO ticket_status_event (id, ticket_id, from_status, to_status, actor)
       VALUES ($1,$2,'queued','in_progress','{"staff_id":"chef"}')`,
      [eventId, ticketId],
    );
    await expect(pool.query(`UPDATE ticket_status_event SET to_status = 'prepared' WHERE id = $1`, [eventId]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM ticket_status_event WHERE id = $1`, [eventId]))
      .rejects.toThrow(/append-only/);
  });
});
