import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/tx';
import { newId } from '../ids';

export interface FeatureFlagRecord {
  key: string;
  on_flag: boolean;
  note: string | null;
}

export class FeatureFlagService {
  constructor(private readonly pool: Pool) {}

  async list(prefix?: string): Promise<FeatureFlagRecord[]> {
    const params: string[] = [];
    const where = prefix ? 'WHERE key LIKE $1' : '';
    if (prefix) params.push(`${prefix}%`);
    const { rows } = await this.pool.query(
      `SELECT key, on_flag, note FROM feature_flag ${where} ORDER BY key`,
      params,
    );
    return rows.map((r) => ({
      key: r.key as string,
      on_flag: Boolean(r.on_flag),
      note: r.note as string | null,
    }));
  }

  async set(key: string, onFlag: boolean, note: string | undefined, actorId: string): Promise<FeatureFlagRecord> {
    return withTransaction(this.pool, (client) => this.setInTx(client, key, onFlag, note, actorId));
  }

  async setInTx(
    client: PoolClient,
    key: string,
    onFlag: boolean,
    note: string | undefined,
    actorId: string,
  ): Promise<FeatureFlagRecord> {
    const { rows } = await client.query(
      `INSERT INTO feature_flag (id, key, on_flag, note, created_by, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,now(),$5)
       ON CONFLICT (key) DO UPDATE SET on_flag = EXCLUDED.on_flag,
         note = COALESCE(EXCLUDED.note, feature_flag.note),
         updated_at = now(), updated_by = EXCLUDED.updated_by,
         version = feature_flag.version + 1
       RETURNING key, on_flag, note`,
      [newId(), key, onFlag, note ?? null, actorId],
    );
    return {
      key: rows[0].key as string,
      on_flag: Boolean(rows[0].on_flag),
      note: rows[0].note as string | null,
    };
  }
}
