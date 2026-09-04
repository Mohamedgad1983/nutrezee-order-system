-- 0020_wave7_dish_per_day.sql — Dish-per-day intelligence foundation (WP m23).
-- Additive, forward-only, staging-safe. NO bridge. Captures the ACTUAL dish assigned per customer per
-- day, which is already embedded in the m22 grid HTML (the selected <option> in each meal_select_<id>).
-- m23 re-archives the FULL grid HTML at full fidelity (the m22 DB raw kept only a parsed skeleton) and
-- parses the dish layer into a clean model + exceptions. Unknown fields are preserved in extra_json /
-- raw_json — NEVER dropped. Dish names may contain free text and are treated as PII-adjacent (never
-- logged). This migration only creates destination tables; importing is a separate gated tool.

-- ===== import runs (every dish-detail import is its own auditable run) =====
CREATE TABLE dish_detail_import_run (
  id           text PRIMARY KEY,
  scope        text NOT NULL CHECK (scope IN ('sample','last_7_days','last_30_days','last_90_days','last_year','full','custom')),
  mode         text NOT NULL CHECK (mode IN ('dry_run','apply')),
  source       text NOT NULL,                 -- e.g. 'm22_grid_files' | 'getMealsByType'
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  counts       jsonb NOT NULL DEFAULT '{}',
  errors       jsonb NOT NULL DEFAULT '[]',
  applied      boolean NOT NULL DEFAULT false,
  created_by   text NOT NULL
);
CREATE INDEX ddir_started_idx ON dish_detail_import_run (started_at);

-- ===== raw archive (FULL legacy response, lossless, idempotent via hash) =====
CREATE TABLE legacy_dish_detail_raw (
  id                  text PRIMARY KEY,
  source_system       text NOT NULL,                       -- 'nutreeze.com'
  source_name         text NOT NULL,                       -- 'getMealsDateWiseFilter' (grid) | 'getMealsByType'
  source_endpoint     text,                                -- relative URL
  source_method       text,                                -- 'GET' | 'POST'
  legacy_internal_id  text NOT NULL,                       -- legacy order internal id
  legacy_order_number text,
  legacy_order_meal_id text,                               -- null for whole-grid responses
  legacy_meal_id      text,
  legacy_meal_type    text,
  legacy_meal_date    date,
  request_params      jsonb NOT NULL DEFAULT '{}',         -- exact params to reproduce the response
  response_status     integer,
  raw_content_type    text,                                -- 'text/html' | 'application/json' | 'mixed'
  raw_html            text,                                -- full HTML if HTML (PII may be present; never logged)
  raw_json            jsonb,                               -- full JSON if JSON
  raw_text            text,                                -- fallback / mixed
  raw_sha             text NOT NULL,                       -- hash of the raw response (dedup/idempotency)
  fetched_at          timestamptz,
  parsed_at           timestamptz,
  parse_status        text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','ok','partial','failed')),
  parse_error_code    text,
  import_run_id       text REFERENCES dish_detail_import_run(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_sha)                                          -- re-archiving the same response is a no-op
);
CREATE INDEX ldd_raw_internal_idx ON legacy_dish_detail_raw (legacy_internal_id);
CREATE INDEX ldd_raw_parse_idx    ON legacy_dish_detail_raw (parse_status);

-- ===== clean model: one row per (order, date, meal slot) =====
CREATE TABLE customer_dish_day (
  id                   text PRIMARY KEY,
  customer_id          text REFERENCES customer(id) ON DELETE SET NULL,
  customer_order_id    text REFERENCES customer_order(id) ON DELETE SET NULL,
  legacy_customer_id   text,
  legacy_internal_id   text NOT NULL,
  legacy_order_number  text,
  legacy_order_meal_id text,                               -- the legacy slot id
  meal_date            date NOT NULL,
  meal_slot            text,                                -- meal type label (lunch/dinner/...) when known
  package_id           text REFERENCES package(id) ON DELETE SET NULL,
  package_name         text,
  source_raw_id        text REFERENCES legacy_dish_detail_raw(id) ON DELETE SET NULL,
  import_run_id        text REFERENCES dish_detail_import_run(id) ON DELETE SET NULL,
  link_status          text NOT NULL DEFAULT 'unlinked'
                         CHECK (link_status IN ('linked','order_only','unlinked')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz
);
-- one slot per (order, date, legacy slot id); no duplicate dish-days
CREATE UNIQUE INDEX cdd_no_dup_day
  ON customer_dish_day (legacy_internal_id, meal_date, coalesce(legacy_order_meal_id,''));
CREATE INDEX cdd_order_idx    ON customer_dish_day (customer_order_id);
CREATE INDEX cdd_customer_idx ON customer_dish_day (customer_id);
CREATE INDEX cdd_date_idx     ON customer_dish_day (meal_date);

-- ===== clean model: one row per actual dish / component item =====
CREATE TABLE customer_dish_day_item (
  id                   text PRIMARY KEY,
  customer_dish_day_id text NOT NULL REFERENCES customer_dish_day(id) ON DELETE CASCADE,
  legacy_dish_id       text,
  legacy_meal_id       text,
  legacy_order_meal_id text,
  dish_name            text,                                -- PII-adjacent; never logged
  dish_name_normalized text,
  quantity             numeric,
  portion              text,
  unit                 text,
  calories             numeric,
  protein              numeric,
  carbs                numeric,
  fat                  numeric,
  fiber                numeric,
  sodium               numeric,
  ingredients_text     text,
  allergen_text        text,
  category             text,
  meal_component_type  text,                                -- 'meal'|'protein'|'carb'|'raw_eggs'|'white_eggs'|...
  is_replacement       boolean,
  is_deleted           boolean,
  is_edited            boolean,
  extra_json           jsonb NOT NULL DEFAULT '{}',         -- UNKNOWN fields preserved here, never dropped
  source_raw_id        text REFERENCES legacy_dish_detail_raw(id) ON DELETE SET NULL,
  import_run_id        text REFERENCES dish_detail_import_run(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
-- deterministic dedup of dish/component items within a slot
CREATE UNIQUE INDEX cddi_no_dup_item
  ON customer_dish_day_item (customer_dish_day_id, coalesce(meal_component_type,''),
                             coalesce(legacy_meal_id,''), coalesce(legacy_dish_id,''));
CREATE INDEX cddi_day_idx     ON customer_dish_day_item (customer_dish_day_id);
CREATE INDEX cddi_meal_idx    ON customer_dish_day_item (legacy_meal_id);

-- ===== exceptions (failed parse/link go HERE, never forced into clean tables, never deleted) =====
CREATE TABLE dish_detail_exception (
  id                   text PRIMARY KEY,
  import_run_id        text REFERENCES dish_detail_import_run(id) ON DELETE SET NULL,
  source_raw_id        text REFERENCES legacy_dish_detail_raw(id) ON DELETE SET NULL,
  legacy_internal_id   text NOT NULL,
  legacy_order_number  text,
  legacy_order_meal_id text,
  legacy_meal_id       text,
  meal_date            date,
  meal_slot            text,
  reason               text NOT NULL CHECK (reason IN
                         ('missing_order_link','missing_customer_link','missing_required_params',
                          'parse_failed','no_dish_found','invalid_date','duplicate_hash',
                          'duplicate_dish_item','unknown_fields','other')),
  detail               jsonb NOT NULL DEFAULT '{}',         -- ids/counts only; never raw PII
  resolution_status    text NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open','resolved','superseded')),
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dde_run_idx    ON dish_detail_exception (import_run_id);
CREATE INDEX dde_reason_idx ON dish_detail_exception (reason);
CREATE INDEX dde_status_idx ON dish_detail_exception (resolution_status);

-- ===== RBAC (read + import perms for the future validated UI) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-dish_detail.read','dish_detail.read','[]','seed'),
 ('seed-perm-dish_detail.import','dish_detail.import','[]','seed');
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code LIKE 'dish_detail.%'
WHERE r.code IN ('super_admin','admin','ops_manager');

COMMENT ON TABLE legacy_dish_detail_raw IS
  'm23 raw archive: FULL legacy dish-detail response (grid HTML / catalog JSON) + raw_sha dedup. Re-archives full fidelity the m22 DB layer did not keep. PII may be present; never logged.';
COMMENT ON TABLE customer_dish_day IS
  'm23 clean model: one row per (legacy order, meal_date, legacy slot). UNIQUE blocks duplicate dish-days. Links to customer_order/customer when deterministically resolvable.';
COMMENT ON TABLE customer_dish_day_item IS
  'm23 clean model: one row per actual dish/component. extra_json preserves UNKNOWN parsed fields (never dropped). dish_name PII-adjacent (never logged).';
COMMENT ON TABLE dish_detail_exception IS
  'm23 exceptions: parse/link failures land here instead of polluting clean tables; never deleted. ids/counts only, no PII.';
