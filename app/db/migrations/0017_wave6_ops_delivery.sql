-- 0017_wave6_ops_delivery.sql — Driver + area assignment foundation (operational-foundation track).
-- Additive, forward-only, staging-safe. New module m21-delivery owns these tables. Picks up where
-- packing hands off: assign packed orders to drivers by area / time / capacity, build delivery
-- routes, track per-stop delivery status. Preserves legacy_driver_id where available.
--
-- Governance: new operational state machines (delivery_route, delivery_route_order). Guarded +
-- same-transaction-audited status changes; append-only driver_assignment_history. This is the
-- foundation for the dormant M09-dispatch / M10-drivers slots and the seeded (inactive)
-- fulfillment dispatch transitions f9..f14 — promotion is the documented follow-up (doc 28).

-- ===== driver =====
CREATE TABLE driver (
  id               text PRIMARY KEY,
  legacy_driver_id text,                      -- preserved when the legacy system exposed one
  name             text NOT NULL,
  phone            text,                       -- PII: masked at serialization, never logged raw
  active           boolean NOT NULL DEFAULT true,
  capacity_per_slot integer NOT NULL DEFAULT 0 CHECK (capacity_per_slot >= 0),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz,
  updated_by       text,
  version          integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX driver_legacy_uq ON driver (legacy_driver_id) WHERE legacy_driver_id IS NOT NULL;
CREATE INDEX driver_active_idx ON driver (active);

-- ===== driver_area — which areas a driver serves, with priority =====
CREATE TABLE driver_area (
  id        text PRIMARY KEY,
  driver_id text NOT NULL REFERENCES driver(id) ON DELETE CASCADE,
  area      text NOT NULL,
  priority  integer NOT NULL DEFAULT 100,      -- lower = preferred
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  UNIQUE (driver_id, area)
);
CREATE INDEX driver_area_area_idx ON driver_area (area, active, priority);

-- ===== driver_shift — driver availability windows =====
CREATE TABLE driver_shift (
  id         text PRIMARY KEY,
  driver_id  text NOT NULL REFERENCES driver(id) ON DELETE CASCADE,
  date       date NOT NULL,
  start_time time,
  end_time   time,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  UNIQUE (driver_id, date, start_time)
);
CREATE INDEX driver_shift_date_idx ON driver_shift (date, active);

-- ===== delivery_route — a driver's run for a date/time/area-group =====
CREATE TABLE delivery_route (
  id            text PRIMARY KEY,
  driver_id     text REFERENCES driver(id) ON DELETE RESTRICT,
  delivery_date date NOT NULL,
  delivery_time text,
  area_group    text,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','assigned','out_for_delivery','completed','failed')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz,
  updated_by    text,
  version       integer NOT NULL DEFAULT 1
);
CREATE INDEX delivery_route_date_idx   ON delivery_route (delivery_date, status);
CREATE INDEX delivery_route_driver_idx ON delivery_route (driver_id, delivery_date);

-- ===== delivery_route_order — one stop on a route (frozen delivery snapshot) =====
CREATE TABLE delivery_route_order (
  id                     text PRIMARY KEY,
  route_id               text NOT NULL REFERENCES delivery_route(id) ON DELETE CASCADE,
  order_id               text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  customer_id            text REFERENCES customer(id) ON DELETE RESTRICT,
  area                   text,
  delivery_method_frozen text,
  delivery_time_frozen   text,
  stop_sequence          integer,
  status                 text NOT NULL DEFAULT 'assigned'
                           CHECK (status IN ('assigned','picked_up','delivered','failed','returned')),
  delivered_at           timestamptz,
  failure_reason         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  updated_at             timestamptz,
  updated_by             text,
  version                integer NOT NULL DEFAULT 1,
  UNIQUE (route_id, order_id)                  -- no duplicate stop on the same route
);
-- DB-enforced "no duplicate active assignment": an order can be in-flight on only ONE route.
CREATE UNIQUE INDEX delivery_route_order_active_uq
  ON delivery_route_order (order_id) WHERE status IN ('assigned','picked_up');
CREATE INDEX delivery_route_order_route_idx ON delivery_route_order (route_id, status);

-- ===== driver_assignment_history — append-only assignment/status trail =====
CREATE TABLE driver_assignment_history (
  id          text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('delivery_route','delivery_route_order')),
  entity_id   text NOT NULL,
  driver_id   text,
  from_status text,
  to_status   text NOT NULL,
  actor       jsonb NOT NULL DEFAULT '{}',
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_assignment_history_entity_idx ON driver_assignment_history (entity_type, entity_id, created_at);
CREATE TRIGGER driver_assignment_history_append_only
  BEFORE UPDATE OR DELETE ON driver_assignment_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== RBAC permissions (active ops roles; dormant driver/fleet_supervisor untouched) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-delivery.driver.read','delivery.driver.read','["pii"]','seed'),
 ('seed-perm-delivery.driver.manage','delivery.driver.manage','["pii"]','seed'),
 ('seed-perm-delivery.assign','delivery.assign','[]','seed'),
 ('seed-perm-delivery.route.read','delivery.route.read','[]','seed'),
 ('seed-perm-delivery.route.manage','delivery.route.manage','[]','seed'),
 ('seed-perm-delivery.status.update','delivery.status.update','[]','seed');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code LIKE 'delivery.%'
WHERE r.code IN ('super_admin','admin','ops_manager');

COMMENT ON TABLE driver IS
  'Driver foundation (m21-delivery). Preserves legacy_driver_id. phone is PII (masked at serialization).';
COMMENT ON TABLE delivery_route IS
  'A driver run for a date/time/area-group. Guarded+audited status; promotion to transition engine / fulfillment f9..f14 is follow-up.';
COMMENT ON TABLE delivery_route_order IS
  'One stop on a route with frozen delivery snapshot. UNIQUE(route_id,order_id) + partial-unique(order_id WHERE active) block duplicate assignment.';
