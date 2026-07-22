-- 0026_driver_order_reassignment.sql — WP-OPS-03 / A22
-- Unlimited-count driver-to-driver Fleetbase order reassignment with per-order outcomes.

INSERT INTO permission (id, code, visibility_grants, created_by)
VALUES (
  'seed-perm-delivery.order.reassign',
  'delivery.order.reassign',
  '[]',
  'migration-0026'
)
ON CONFLICT (code) DO NOTHING;

-- A22 grants the Logistics Manager every current Nutrezee delivery/driver capability,
-- but no finance, staff/RBAC, catalog, or system-administration permissions.
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0026'
FROM role r
JOIN permission p ON p.code IN (
  'delivery.driver.read',
  'delivery.driver.manage',
  'delivery.assign',
  'delivery.route.read',
  'delivery.route.manage',
  'delivery.status.update',
  'delivery.driver.credentials.rotate',
  'delivery.order.reassign'
)
WHERE r.code = 'logistics_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-super_admin-' || p.code, r.id, p.id, 'migration-0026'
FROM role r
JOIN permission p ON p.code = 'delivery.order.reassign'
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE driver_order_reassignment (
  id                       text PRIMARY KEY,
  source_driver_public_id  text NOT NULL,
  target_driver_public_id  text NOT NULL,
  status                   text NOT NULL CHECK (status IN ('requested', 'completed', 'partial', 'failed')),
  requested_count          integer NOT NULL CHECK (requested_count > 0),
  completed_count          integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count             integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  requested_by             text NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text,
  updated_at               timestamptz,
  updated_by               text,
  version                  integer NOT NULL DEFAULT 1,
  CHECK (source_driver_public_id <> target_driver_public_id),
  CHECK (completed_count + failed_count <= requested_count),
  CHECK (
    (status = 'requested' AND completed_at IS NULL AND completed_count = 0 AND failed_count = 0)
    OR (status <> 'requested' AND completed_at IS NOT NULL AND completed_count + failed_count = requested_count)
  )
);

CREATE TABLE driver_order_reassignment_item (
  id                         text PRIMARY KEY,
  reassignment_id            text NOT NULL REFERENCES driver_order_reassignment(id) ON DELETE RESTRICT,
  fleetbase_order_public_id  text NOT NULL,
  status                     text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  failure_code               text,
  completed_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 text,
  updated_at                 timestamptz,
  updated_by                 text,
  version                    integer NOT NULL DEFAULT 1,
  UNIQUE (reassignment_id, fleetbase_order_public_id),
  CHECK (
    (status = 'pending' AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX driver_order_reassignment_source_idx
  ON driver_order_reassignment (source_driver_public_id, requested_at DESC);
CREATE INDEX driver_order_reassignment_target_idx
  ON driver_order_reassignment (target_driver_public_id, requested_at DESC);
CREATE INDEX driver_order_reassignment_actor_idx
  ON driver_order_reassignment (requested_by, requested_at DESC);
CREATE INDEX driver_order_reassignment_item_status_idx
  ON driver_order_reassignment_item (reassignment_id, status);
CREATE UNIQUE INDEX driver_order_reassignment_item_pending_order_uidx
  ON driver_order_reassignment_item (fleetbase_order_public_id)
  WHERE status = 'pending';

COMMENT ON TABLE driver_order_reassignment IS
  'A22 secret/PII-free driver-to-driver Fleetbase order reassignment batch ledger.';
COMMENT ON TABLE driver_order_reassignment_item IS
  'A22 per-order public-id outcome ledger; pending rows serialize concurrent reassignment attempts and never store customer/payload data or upstream UUIDs.';
