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

describe('TS-I integration — notification persistence guards (WP-12)', () => {
  it('keeps notification_log append-only', async () => {
    const id = await insertLog('evt-append-only');

    await expect(pool.query(`UPDATE notification_log SET status = 'failed' WHERE id = $1`, [id]))
      .rejects.toThrow(/append-only table/);
    await expect(pool.query(`DELETE FROM notification_log WHERE id = $1`, [id]))
      .rejects.toThrow(/append-only table/);
  });

  it('dedupes delivery per source event, template, and recipient', async () => {
    await insertLog('evt-dedupe');
    await expect(insertLog('evt-dedupe')).rejects.toThrow(/duplicate key/);
  });
});

async function insertLog(sourceEventId: string): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO notification_log
      (id, template_id, template_version, source_event_id, recipient_type, recipient_ref, channel, status, payload_summary)
     VALUES ($1,'seed-nt-unrouted-items',1,$2,'staff_role','ops_manager','internal','sent',$3)`,
    [id, sourceEventId, JSON.stringify({ test: true })],
  );
  return id;
}
