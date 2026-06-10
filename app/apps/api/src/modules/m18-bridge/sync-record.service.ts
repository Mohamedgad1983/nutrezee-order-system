import type { PoolClient } from 'pg';
import { newId } from '../../platform/ids';

export type SyncObjectType = 'customer' | 'product' | 'package' | 'order' | 'payment' | 'master';

// M18 owns sync_record (data_ownership); M19 import flows call this service —
// never the table directly (ADR-010 single write path).
export class SyncRecordService {
  /** Returns the existing new_ref if this legacy key is already mapped (idempotency). */
  async lookup(client: PoolClient, objectType: SyncObjectType, legacyKey: string): Promise<string | null> {
    const { rows } = await client.query(
      'SELECT new_ref FROM sync_record WHERE object_type = $1 AND legacy_key = $2',
      [objectType, legacyKey],
    );
    return rows.length > 0 ? (rows[0].new_ref as string) : null;
  }

  /** Rollback support: clear mappings whose new_ref rows were deleted (M19 rollback). */
  async clearByNewRefs(client: PoolClient, newRefs: string[]): Promise<void> {
    if (newRefs.length === 0) return;
    await client.query('DELETE FROM sync_record WHERE new_ref = ANY($1)', [newRefs]);
  }

  async record(
    client: PoolClient,
    objectType: SyncObjectType,
    legacyKey: string,
    newRef: string,
    snapshotHash?: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sync_record (id, object_type, legacy_key, new_ref, snapshot_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,'import')
       ON CONFLICT (object_type, legacy_key)
       DO UPDATE SET new_ref = EXCLUDED.new_ref, last_seen_at = now(), snapshot_hash = EXCLUDED.snapshot_hash`,
      [newId(), objectType, legacyKey, newRef, snapshotHash ?? null],
    );
  }
}
