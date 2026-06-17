-- 0019_wave6_meal_history_exception_resolution.sql — additive resolution trail for m22 exceptions.
-- Forward-only, non-destructive. Adds columns so the deterministic relink job (m22 Phase 4) can mark
-- a missing_order_link exception resolved/superseded WITHOUT deleting it (the audit trail survives).
-- New nullable/defaulted columns only; existing 28 rows backfill to resolution_status='open'.

ALTER TABLE customer_meal_history_exceptions
  ADD COLUMN resolution_status text NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open','resolved','superseded','unresolvable')),
  ADD COLUMN resolved_at        timestamptz,
  ADD COLUMN resolved_by_run_id text REFERENCES customer_meal_history_import_runs(id) ON DELETE SET NULL,
  ADD COLUMN resolution_note    text;

CREATE INDEX cmh_exceptions_resolution_idx ON customer_meal_history_exceptions (resolution_status);

-- Widen the import-run scope vocabulary to include 'relink' (non-destructive: strictly a superset;
-- every existing row still satisfies the constraint). The relink pass records its run here so
-- exceptions.resolved_by_run_id can reference it.
ALTER TABLE customer_meal_history_import_runs DROP CONSTRAINT customer_meal_history_import_runs_scope_check;
ALTER TABLE customer_meal_history_import_runs ADD CONSTRAINT customer_meal_history_import_runs_scope_check
  CHECK (scope IN ('last_30_days','last_90_days','last_year','full','relink'));

COMMENT ON COLUMN customer_meal_history_exceptions.resolution_status IS
  'open|resolved|superseded|unresolvable — relink marks resolved when the deterministic order link becomes available; rows are never deleted.';
