-- 0025_driver_credential_rotation.sql — WP-OPS-02 / A21
-- Logistics Manager may rotate Fleetbase DRIVER passwords from the Nutrezee admin.
-- The password and linked Fleetbase user UUID are deliberately never persisted.

INSERT INTO role (id, code, name_en, name_ar, active, dormant, created_by)
VALUES (
  'seed-role-logistics_manager',
  'logistics_manager',
  'Logistics Manager',
  'مدير الخدمات اللوجستية',
  true,
  false,
  'migration-0025'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permission (id, code, visibility_grants, created_by)
VALUES (
  'seed-perm-delivery.driver.credentials.rotate',
  'delivery.driver.credentials.rotate',
  '[]',
  'migration-0025'
)
ON CONFLICT (code) DO NOTHING;

-- Unlike the legacy staged roles, this newly activated security-sensitive role starts
-- in deny mode. The credential controller also checks both role and grant fail-closed.
UPDATE setting
SET value = jsonb_set(value, '{logistics_manager}', '"deny"'::jsonb, true),
    updated_at = now(),
    updated_by = 'migration-0025',
    version = version + 1
WHERE key = 'rbac_enforcement_mode';

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0025'
FROM role r
JOIN permission p ON p.code IN ('delivery.driver.read', 'delivery.driver.credentials.rotate')
WHERE r.code IN ('super_admin', 'logistics_manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE driver_credential_rotation (
  id                  text PRIMARY KEY,
  fleetbase_driver_id text NOT NULL,
  status              text NOT NULL CHECK (status IN ('requested', 'completed', 'failed')),
  failure_code        text,
  requested_by        text NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_at          timestamptz,
  updated_by          text,
  version             integer NOT NULL DEFAULT 1,
  CHECK (
    (status = 'requested' AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX driver_credential_rotation_driver_idx
  ON driver_credential_rotation (fleetbase_driver_id, requested_at DESC);
CREATE INDEX driver_credential_rotation_actor_idx
  ON driver_credential_rotation (requested_by, requested_at DESC);

COMMENT ON TABLE driver_credential_rotation IS
  'A21 password-rotation outcome ledger. Never stores password values or Fleetbase user UUIDs.';
