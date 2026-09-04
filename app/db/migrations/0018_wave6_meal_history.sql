-- 0018_wave6_meal_history.sql — Customer meal-history controlled transfer (WP m22, Phase 1).
-- Additive, forward-only, staging-safe. NO bridge: meal history is transferred INTO PostgreSQL via
-- a raw archive + a clean model, never read live from the legacy system for display. Meal history
-- has its OWN import runs, exceptions, and validation trail — it is never mixed into the order sync.
--
-- Source: legacy ajax `/orders/getMealsDateWiseFilter/all/<internal_id>` (date-wise meal grid).
-- Per-dish detail is secondary-ajax-gated; the reliable signal is meal dates + types + meal ids.
-- This migration only creates the destination tables; importing is a separate dry-run tool, and the
-- first real candidate scope is last-30-days only (see docs/evidence/meal_history/).

-- ===== import runs (every meal-history import is its own auditable run) =====
CREATE TABLE customer_meal_history_import_runs (
  id           text PRIMARY KEY,
  mode         text NOT NULL CHECK (mode IN ('dry_run','apply')),
  scope        text NOT NULL CHECK (scope IN ('last_30_days','last_90_days','last_year','full')),
  window_from  date,
  window_to    date,
  source_system text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_ms  integer,
  counts       jsonb NOT NULL DEFAULT '{}',   -- records_seen, records_candidate, would_archive, ...
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  created_by   text NOT NULL
);
CREATE INDEX cmh_import_runs_started_idx ON customer_meal_history_import_runs (started_at);

-- ===== raw archive (lossless original payload, idempotent via hash) =====
CREATE TABLE legacy_meal_history_raw (
  id               text PRIMARY KEY,
  source_system    text NOT NULL,                 -- e.g. 'nutreeze.com'
  source_name      text NOT NULL,                 -- e.g. 'getMealsDateWiseFilter'
  source_record_id text NOT NULL,                 -- legacy internal order id
  legacy_order_number text,                        -- resolved when possible (orders_index)
  payload          jsonb NOT NULL,                -- parsed skeleton (dates, meal_types, meal_ids, ...)
  raw_sha          text NOT NULL,                 -- hash of the raw source for dedup/idempotency
  extracted_at     timestamptz,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  import_run_id    text REFERENCES customer_meal_history_import_runs(id) ON DELETE SET NULL,
  UNIQUE (raw_sha)                                 -- re-archiving the same payload is a no-op
);
CREATE INDEX lmh_raw_source_idx ON legacy_meal_history_raw (source_record_id);

-- ===== clean model: one row per order's meal history =====
CREATE TABLE customer_meal_history (
  id                 text PRIMARY KEY,
  import_run_id      text REFERENCES customer_meal_history_import_runs(id) ON DELETE SET NULL,
  legacy_order_id    text NOT NULL,               -- legacy internal_id, preserved for traceability
  legacy_order_number text,
  legacy_customer_id text,
  order_id           text REFERENCES customer_order(id) ON DELETE SET NULL,   -- link when resolvable
  customer_id        text REFERENCES customer(id) ON DELETE SET NULL,
  meal_date_from     date,
  meal_date_to       date,
  meal_day_count     integer NOT NULL DEFAULT 0,
  meal_types         jsonb NOT NULL DEFAULT '[]',
  package_name       text,
  subpackage_name    text,
  status             text,
  source_sha         text,
  import_status      text NOT NULL DEFAULT 'imported' CHECK (import_status IN ('imported','partial','exception')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz,
  UNIQUE (legacy_order_id)                          -- one meal-history row per legacy order
);
CREATE INDEX cmh_order_idx    ON customer_meal_history (order_id);
CREATE INDEX cmh_customer_idx ON customer_meal_history (customer_id);

-- ===== clean model: one row per meal-day (no duplicate meal days) =====
CREATE TABLE customer_meal_history_items (
  id               text PRIMARY KEY,
  meal_history_id  text NOT NULL REFERENCES customer_meal_history(id) ON DELETE CASCADE,
  legacy_order_id  text NOT NULL,
  order_id         text REFERENCES customer_order(id) ON DELETE SET NULL,
  meal_date        date NOT NULL,
  meal_type        text,
  meal_name        text,                           -- nullable: dish detail is ajax-gated (later phase)
  meal_ref         text,                           -- legacy meal_id
  package_name     text,
  subpackage_name  text,
  delivery_status  text,
  source_sha       text,
  import_run_id    text REFERENCES customer_meal_history_import_runs(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- no duplicate meal days (expression unique => index, not an inline constraint)
CREATE UNIQUE INDEX cmh_items_no_dup_meal_day
  ON customer_meal_history_items (legacy_order_id, meal_date, coalesce(meal_type,''));
CREATE INDEX cmh_items_history_idx ON customer_meal_history_items (meal_history_id);
CREATE INDEX cmh_items_date_idx    ON customer_meal_history_items (meal_date);

-- ===== exceptions (bad records go HERE, never forced into the clean tables) =====
CREATE TABLE customer_meal_history_exceptions (
  id              text PRIMARY KEY,
  import_run_id   text REFERENCES customer_meal_history_import_runs(id) ON DELETE SET NULL,
  legacy_order_id text,
  meal_date       date,
  reason          text NOT NULL CHECK (reason IN
                    ('missing_order_link','missing_customer_link','invalid_date',
                     'duplicate_hash','parse_error','duplicate_meal_day','other')),
  detail          jsonb NOT NULL DEFAULT '{}',     -- ids + reason only; never raw PII
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cmh_exceptions_run_idx    ON customer_meal_history_exceptions (import_run_id);
CREATE INDEX cmh_exceptions_reason_idx ON customer_meal_history_exceptions (reason);

-- ===== RBAC (read + import perms; granted to active ops roles for the future validated UI) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-meal_history.read','meal_history.read','[]','seed'),
 ('seed-perm-meal_history.import','meal_history.import','[]','seed');
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code LIKE 'meal_history.%'
WHERE r.code IN ('super_admin','admin','ops_manager');

COMMENT ON TABLE legacy_meal_history_raw IS
  'm22 raw archive: lossless legacy meal-history payload (JSONB) + raw_sha dedup. No bridge — controlled transfer into PG.';
COMMENT ON TABLE customer_meal_history IS
  'm22 clean model: one row per legacy order''s meal history; links to customer_order/customer when resolvable, legacy ids preserved.';
COMMENT ON TABLE customer_meal_history_items IS
  'm22 clean model: one row per meal-day. UNIQUE(legacy_order_id, meal_date, meal_type) blocks duplicate meal days. meal_name nullable (dish detail ajax-gated).';
COMMENT ON TABLE customer_meal_history_exceptions IS
  'm22 exceptions: records that fail linking/validation land here instead of polluting the clean tables. ids + reason only, no PII.';
