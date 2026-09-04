-- 0024_fleetbase_dispatch.sql
-- m24-fleetbase bridge table: tracks the nutrezee → Fleetbase dispatch state per order.
-- This is OUR integration record (Fleetbase stays config-only/AGPL). Additive & idempotent.
-- It does NOT modify any existing table; FK to customer_order is a read-only reference.
CREATE TABLE IF NOT EXISTS fleetbase_dispatch (
  id                   text PRIMARY KEY,
  order_id             text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  order_number         text NOT NULL,
  fleetbase_order_id   text,                       -- Fleetbase order public id (order_xxx); NULL until created
  fleetbase_status     text,                       -- last Fleetbase status (created/dispatched/.../completed/canceled)
  geo_state            text NOT NULL,              -- 'ready' | 'pending_geocoding'
  has_real_coordinate  boolean NOT NULL DEFAULT false,
  frozen_address       jsonb NOT NULL,             -- snapshot at dispatch time (area/block/street/house/pin/notes)
  area_id              text,                        -- frozen area for area->fleet routing
  fleet_id             text,                        -- resolved Fleetbase fleet (NULL until fleets + area-map exist)
  dispatch_state       text NOT NULL,              -- pending_geocoding|ready|created|dispatched|completed|canceled|failed
  last_event           text,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_at           timestamptz,
  updated_by           text,
  version              integer NOT NULL DEFAULT 1
);

-- one bridge row per order (idempotency anchor; internal_id = order_number on the Fleetbase side)
CREATE UNIQUE INDEX IF NOT EXISTS fleetbase_dispatch_order_id_uq ON fleetbase_dispatch(order_id);
CREATE INDEX IF NOT EXISTS fleetbase_dispatch_geo_state_idx ON fleetbase_dispatch(geo_state);
CREATE INDEX IF NOT EXISTS fleetbase_dispatch_fb_order_idx ON fleetbase_dispatch(fleetbase_order_id);

COMMENT ON TABLE fleetbase_dispatch IS
  'm24-fleetbase: nutrezee->Fleetbase order bridge. geo_state=pending_geocoding rows are HELD (never sent to Fleetbase) until a real location_pin exists — we never send Point(0,0).';
