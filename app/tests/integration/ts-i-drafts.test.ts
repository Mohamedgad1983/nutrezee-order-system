import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;

beforeAll(async () => {
  pool = await freshDb();
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-I integration — WP-07 append-only WhatsApp refs', () => {
  it('rejects UPDATE and DELETE on whatsapp_message_ref at the database', async () => {
    const draftId = newId();
    await pool.query(
      `INSERT INTO draft_order (id, channel, unverified_customer, unverified_reason, created_by)
       VALUES ($1,'whatsapp',true,'manual test','test')`,
      [draftId],
    );
    const refId = newId();
    await pool.query(
      `INSERT INTO whatsapp_message_ref (id, draft_id, sender_phone, message_at, captured_by)
       VALUES ($1,$2,'+966500000000',now(),'test')`,
      [refId, draftId],
    );
    await expect(pool.query(`UPDATE whatsapp_message_ref SET ref_note = 'x' WHERE id = $1`, [refId]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM whatsapp_message_ref WHERE id = $1', [refId]))
      .rejects.toThrow(/append-only/);
  });
});
