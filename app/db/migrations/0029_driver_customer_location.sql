-- 0029_driver_customer_location.sql
-- WP-LOC-A30 — append-only exact-location captures for Partner customers whose authoritative
-- location is missing/invalid. Partner and Fleetbase remain read-only from this module.

CREATE TABLE driver_customer_location_capture (
  id                    text PRIMARY KEY,
  partner_customer_ref  text NOT NULL
                          CHECK (btrim(partner_customer_ref) <> '' AND char_length(partner_customer_ref) <= 255),
  fleetbase_order_id    text NOT NULL CHECK (btrim(fleetbase_order_id) <> ''),
  source_order_number   text,
  delivery_date         date NOT NULL,
  fleetbase_user_uuid   text,
  fleetbase_driver_id   text,
  latitude              double precision NOT NULL CHECK (latitude BETWEEN 28.4 AND 30.2),
  longitude             double precision NOT NULL CHECK (longitude BETWEEN 46.4 AND 48.6),
  accuracy_meters       double precision CHECK (accuracy_meters IS NULL OR accuracy_meters BETWEEN 0 AND 5000),
  capture_method        text NOT NULL
                          CHECK (capture_method IN ('current_gps','shared_coordinates','operator_correction')),
  supersedes_id         text UNIQUE REFERENCES driver_customer_location_capture(id) ON DELETE RESTRICT,
  correction_reason     text CHECK (correction_reason IS NULL OR char_length(correction_reason) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  created_by_role       text NOT NULL,
  CHECK (
    (capture_method = 'operator_correction'
      AND supersedes_id IS NOT NULL
      AND correction_reason IS NOT NULL
      AND btrim(correction_reason) <> '')
    OR
    (capture_method <> 'operator_correction'
      AND supersedes_id IS NULL
      AND correction_reason IS NULL)
  )
);

CREATE INDEX driver_customer_location_ref_idx
  ON driver_customer_location_capture (partner_customer_ref, created_at DESC);
CREATE INDEX driver_customer_location_driver_date_idx
  ON driver_customer_location_capture (fleetbase_driver_id, delivery_date)
  WHERE fleetbase_driver_id IS NOT NULL;
CREATE INDEX driver_customer_location_order_idx
  ON driver_customer_location_capture (fleetbase_order_id, delivery_date);

CREATE TRIGGER driver_customer_location_capture_append_only
  BEFORE UPDATE OR DELETE ON driver_customer_location_capture
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE driver_customer_location_capture IS
  'A30 append-only exact-location ledger. The effective row is the capture not superseded by a later row. A valid Partner pin always wins at consumption time; no row is written back to Partner.';
COMMENT ON COLUMN driver_customer_location_capture.partner_customer_ref IS
  'Stable opaque Partner customer reference used only for exact joins; never name/phone matching.';
COMMENT ON COLUMN driver_customer_location_capture.supersedes_id IS
  'Fleet-Ops correction link. The previous row remains immutable and auditable.';
