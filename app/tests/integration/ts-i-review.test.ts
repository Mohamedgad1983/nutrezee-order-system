import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;

beforeAll(async () => {
  pool = await freshDb();
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, locale)
     VALUES ('ops-i','Ops I','ops-i@t','en') ON CONFLICT (email) DO NOTHING`,
  );
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-I integration — WP-08 review persistence guards', () => {
  it('rejects UPDATE and DELETE on review_decision at the database', async () => {
    const draftId = newId();
    await pool.query(
      `INSERT INTO draft_order (id, channel, unverified_customer, unverified_reason, state, created_by)
       VALUES ($1,'phone',true,'manual test','submitted','agent-i')`,
      [draftId],
    );
    const decisionId = newId();
    await pool.query(
      `INSERT INTO review_decision (id, draft_id, decision, decided_by)
       VALUES ($1,$2,'approve','ops-i')`,
      [decisionId, draftId],
    );
    await expect(pool.query(`UPDATE review_decision SET note = 'x' WHERE id = $1`, [decisionId]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM review_decision WHERE id = $1', [decisionId]))
      .rejects.toThrow(/append-only/);
  });

  it('allows only one active queue item per draft while preserving decided history', async () => {
    const draftId = newId();
    await pool.query(
      `INSERT INTO draft_order (id, channel, unverified_customer, unverified_reason, state, created_by)
       VALUES ($1,'phone',true,'manual test','submitted','agent-i')`,
      [draftId],
    );
    const first = newId();
    await pool.query(
      `INSERT INTO review_queue_item (id, draft_id, sla_due_at)
       VALUES ($1,$2,now() + interval '2 hours')`,
      [first, draftId],
    );
    await expect(pool.query(
      `INSERT INTO review_queue_item (id, draft_id, sla_due_at)
       VALUES ($1,$2,now() + interval '2 hours')`,
      [newId(), draftId],
    )).rejects.toThrow(/duplicate key/);
    await pool.query(`UPDATE review_queue_item SET queue_state = 'decided' WHERE id = $1`, [first]);
    await expect(pool.query(
      `INSERT INTO review_queue_item (id, draft_id, sla_due_at)
       VALUES ($1,$2,now() + interval '2 hours')`,
      [newId(), draftId],
    )).resolves.toBeTruthy();
  });
});
