import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export class IdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict';
}

export interface IdempotencyResult {
  replay: boolean;
  responseRef: string | null;
}

// api_standards: create operations carry an Idempotency-Key; replays return the
// original result; same key with a different request is a conflict. Claimed inside
// the business transaction so a rolled-back attempt releases its claim.
export class IdempotencyService {
  hashRequest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  }

  async claimInTx(
    client: PoolClient,
    key: string,
    operation: string,
    requestHash: string,
  ): Promise<IdempotencyResult> {
    const inserted = await client.query(
      `INSERT INTO idempotency_key (key, operation, request_hash)
       VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING`,
      [key, operation, requestHash],
    );
    if (inserted.rowCount === 1) return { replay: false, responseRef: null };
    const { rows } = await client.query(
      'SELECT operation, request_hash, response_ref FROM idempotency_key WHERE key = $1',
      [key],
    );
    const existing = rows[0];
    if (!existing || existing.operation !== operation || existing.request_hash !== requestHash) {
      throw new IdempotencyConflictError(`idempotency key reused with different request`);
    }
    return { replay: true, responseRef: existing.response_ref };
  }

  async storeResponseInTx(client: PoolClient, key: string, responseRef: string): Promise<void> {
    await client.query('UPDATE idempotency_key SET response_ref = $2 WHERE key = $1', [key, responseRef]);
  }
}
