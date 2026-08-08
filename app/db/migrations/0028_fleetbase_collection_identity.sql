-- 0028_fleetbase_collection_identity.sql
-- A28 correction — Fleetbase identity and Fleetbase-assigned orders are the sole collection
-- authority. This migration is additive so the append-only A27 ledger and its existing evidence
-- remain intact; the retired Nutrezee driver/route columns stay nullable for historical rows only.

ALTER TABLE box_collection
  ADD COLUMN IF NOT EXISTS fleetbase_user_uuid text,
  ADD COLUMN IF NOT EXISTS fleetbase_driver_id text,
  ADD COLUMN IF NOT EXISTS fleetbase_order_id text;

CREATE INDEX IF NOT EXISTS box_collection_fleetbase_driver_date_idx
  ON box_collection (fleetbase_driver_id, delivery_date)
  WHERE fleetbase_driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS box_collection_fleetbase_order_idx
  ON box_collection (fleetbase_order_id)
  WHERE fleetbase_order_id IS NOT NULL;

COMMENT ON COLUMN box_collection.fleetbase_user_uuid IS
  'Fleetbase session user UUID verified server-side from the bearer token at scan time.';
COMMENT ON COLUMN box_collection.fleetbase_driver_id IS
  'Fleetbase driver public id resolved server-side from the verified Fleetbase session user.';
COMMENT ON COLUMN box_collection.fleetbase_order_id IS
  'Fleetbase order public id proven assigned to fleetbase_driver_id at scan time.';

COMMENT ON COLUMN box_collection.driver_id IS
  'Historical A27 Nutrezee driver reference only. A28 scans leave this NULL and use fleetbase_driver_id.';
COMMENT ON COLUMN box_collection.route_id IS
  'Historical A27 Nutrezee route reference only. A28 scans leave this NULL; Fleetbase order assignment is authoritative.';

