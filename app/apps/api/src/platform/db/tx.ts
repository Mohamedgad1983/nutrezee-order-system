import type { Pool, PoolClient } from 'pg';

// The one transaction helper (backend_foundation §2): business write + audit_event +
// outbox_event commit together or not at all. Services receive the client, never
// open nested transactions.
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
