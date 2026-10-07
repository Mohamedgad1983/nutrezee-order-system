-- 0033_delivery_area_move.sql
-- WP-OPS-A77 — the drivers' manager moves one area from a loaded driver to another for ONE delivery day.
-- The legacy admin stays the reference for every other order and day; an active row here is the only
-- thing that makes the Fleetbase sync give that day's orders of the area to another driver.

CREATE TABLE delivery_area_move (
  id                 text PRIMARY KEY,
  delivery_date      date NOT NULL,
  area_key           text NOT NULL CHECK (btrim(area_key) <> '' AND char_length(area_key) <= 200),
  area_label         text NOT NULL CHECK (char_length(area_label) <= 200),
  from_driver_id     text CHECK (from_driver_id IS NULL OR char_length(from_driver_id) <= 100),
  from_driver_name   text CHECK (from_driver_name IS NULL OR char_length(from_driver_name) <= 200),
  to_driver_id       text NOT NULL CHECK (btrim(to_driver_id) <> '' AND char_length(to_driver_id) <= 100),
  to_driver_name     text CHECK (to_driver_name IS NULL OR char_length(to_driver_name) <= 200),
  orders_at_request  integer NOT NULL DEFAULT 0 CHECK (orders_at_request >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  cancelled_at       timestamptz,
  cancelled_by       text,
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);

-- One live decision per area and day; history stays in the cancelled rows.
CREATE UNIQUE INDEX delivery_area_move_active_idx
  ON delivery_area_move (delivery_date, area_key) WHERE cancelled_at IS NULL;
CREATE INDEX delivery_area_move_date_idx ON delivery_area_move (delivery_date);

COMMENT ON TABLE delivery_area_move IS
  'A77 one-day area reassignment between drivers. Read by the Fleetbase sync and the night check; written only by m25-label.';
COMMENT ON COLUMN delivery_area_move.area_key IS
  'Lower-cased, space-collapsed routing area of the Fleetbase orders of that day; the sync matches it the same way.';
COMMENT ON COLUMN delivery_area_move.to_driver_id IS
  'Fleetbase driver public id (driver_…). The sync resolves it to the legacy driver id through its own driver map.';
