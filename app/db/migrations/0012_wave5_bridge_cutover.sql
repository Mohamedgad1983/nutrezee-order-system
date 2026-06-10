-- 0012_wave5_bridge_cutover.sql — WP-13 M18/M19 bridge and cutover slice.
-- Real legacy apply remains gated by access/export availability; these structures
-- support synthetic dry-runs, active-plan imports, reconciliation records, and
-- cutover flag auditing.

CREATE TABLE reconciliation_run (
  id text PRIMARY KEY,
  run_type text NOT NULL CHECK (run_type IN ('daily_orders','weekly_catalog','payments')),
  counts jsonb NOT NULL DEFAULT '{}',
  diffs jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL CHECK (state IN ('ok','divergent')),
  run_by text,
  run_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_run_type_at ON reconciliation_run (run_type, run_at);
CREATE TRIGGER reconciliation_run_append_only
  BEFORE UPDATE OR DELETE ON reconciliation_run
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-bridge.import.read','bridge.import.read','["pii","payment","health"]','migration-0012'),
 ('seed-perm-bridge.import.run','bridge.import.run','["pii","payment","health"]','migration-0012'),
 ('seed-perm-bridge.import.apply','bridge.import.apply','["pii","payment","health"]','migration-0012'),
 ('seed-perm-bridge.import.rollback','bridge.import.rollback','["pii","payment","health"]','migration-0012'),
 ('seed-perm-bridge.reconciliation.read','bridge.reconciliation.read','["pii","payment"]','migration-0012'),
 ('seed-perm-bridge.reconciliation.record','bridge.reconciliation.record','["pii","payment"]','migration-0012'),
 ('seed-perm-bridge.cutover.read','bridge.cutover.read','[]','migration-0012'),
 ('seed-perm-bridge.cutover.toggle','bridge.cutover.toggle','[]','migration-0012');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0012'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND p.code LIKE 'bridge.%')
  OR (r.code = 'admin' AND p.code IN ('bridge.import.read','bridge.import.run',
                                      'bridge.reconciliation.read','bridge.reconciliation.record',
                                      'bridge.cutover.read'))
  OR (r.code = 'ops_manager' AND p.code IN ('bridge.import.read','bridge.reconciliation.read',
                                            'bridge.reconciliation.record','bridge.cutover.read'))
  OR (r.code = 'finance' AND p.code IN ('bridge.reconciliation.read'))
  OR (r.code = 'report_viewer' AND p.code IN ('bridge.reconciliation.read'))
);
