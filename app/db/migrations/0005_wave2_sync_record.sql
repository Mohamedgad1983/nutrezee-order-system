-- 0005_wave2_sync_record.sql — M18 bridge sync records (WP-06).
-- Import idempotency anchor: UNIQUE(object_type, legacy_key) (physical_schema wave 2).
CREATE TABLE sync_record (
  id text PRIMARY KEY,
  source text NOT NULL DEFAULT 'legacy' CHECK (source = 'legacy'),
  object_type text NOT NULL CHECK (object_type IN ('customer','product','package','order','payment','master')),
  legacy_key text NOT NULL,
  new_ref text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  snapshot_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (object_type, legacy_key)
);
