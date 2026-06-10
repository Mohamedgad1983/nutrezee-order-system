-- 0003_wave2_masters_customers.sql — Wave 2 (WP-04 slice): shared masters,
-- import tracking (FK target for importable rows), customer cluster (M04).
-- physical_schema §2 wave 2. Amendment A1 applied: customer.email (PII), logged.
-- Masters are M05-owned (catalog) but created here for FK ordering; product/package
-- tables follow in the WP-05 migration.

-- ===== M19 import tracking (origin/import_batch_id FK target) =====
CREATE TABLE import_batch (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('customer','catalog','active_plans')),
  source_note text NOT NULL,
  dry_run boolean NOT NULL DEFAULT true,
  counts jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'dry_run' CHECK (state IN ('dry_run','applied','rolled_back')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE import_row_result (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES import_batch(id) ON DELETE RESTRICT,
  row_no integer NOT NULL,
  action text NOT NULL CHECK (action IN ('created','matched','merge_review','skipped','error')),
  target_ref text,
  messages jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_rows_by_batch ON import_row_result (batch_id, action);
CREATE TRIGGER import_row_result_append_only
  BEFORE UPDATE OR DELETE ON import_row_result
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== M05 masters (bilingual, importable — legacy parity [V]) =====
CREATE TABLE meal_type (
  id text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE TABLE diet_status (
  id text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE TABLE tag (
  id text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE TABLE package_for_type (
  id text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE TABLE ingredient (
  id text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE TABLE allergen (
  id text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL,
  default_severity text CHECK (default_severity IN ('note','avoid','severe')), -- scale [NC S8]
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

-- ===== M04 customer cluster =====
CREATE TABLE customer (
  id text PRIMARY KEY,
  full_name_en text NOT NULL,                       -- PII
  full_name_ar text,                                -- PII
  email text,                                       -- PII — AMENDMENT A1
  dob date,                                         -- PII (legacy [V])
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  diet_status_id text REFERENCES diet_status(id),   -- HEALTH
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','merge_pending')),
  notes text,                                       -- PII
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX customer_name_fuzzy ON customer (lower(full_name_en));

CREATE TABLE customer_phone (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  phone_normalized text NOT NULL,                   -- PII; E.164-style [Proposed]
  phone_raw text,                                   -- as-entered shadow (dictionary §5)
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  whatsapp boolean NOT NULL DEFAULT false,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
-- soft uniqueness (family-shared numbers [NC DEC-004]): searchable, not unique;
-- intake-level dup handling per validation binding §1
CREATE INDEX customer_phone_lookup ON customer_phone (phone_normalized);
CREATE UNIQUE INDEX customer_phone_one_primary ON customer_phone (customer_id) WHERE is_primary;

CREATE TABLE address (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  label text,
  area_id text REFERENCES area(id),                 -- areas zero-row until workshop
  address_text text NOT NULL,                       -- PII
  location_pin jsonb,                               -- PII
  delivery_notes text,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE customer_allergy (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  allergen_id text NOT NULL REFERENCES allergen(id) ON DELETE RESTRICT,
  severity text CHECK (severity IN ('note','avoid','severe')), -- HEALTH; scale [NC]
  note text,                                                   -- HEALTH
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (customer_id, allergen_id)
);

CREATE TABLE preference (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  key text NOT NULL CHECK (key IN ('contact_channel','delivery_pref','other')),
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (customer_id, key)
);

CREATE TABLE merge_record (
  id text PRIMARY KEY,
  winner_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  loser_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  field_decisions jsonb NOT NULL DEFAULT '{}',      -- incl. moved child-row ids for undo
  merged_by text NOT NULL,
  undo_until timestamptz NOT NULL,
  undone_at timestamptz,                            -- the ONE permitted mutation: undo stamp
  created_at timestamptz NOT NULL DEFAULT now()
);
-- append-only except the undo stamp (soft-merge with undo window, DM logical model)
CREATE OR REPLACE FUNCTION merge_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append-only table: merge_record does not allow DELETE'; END IF;
  IF NEW.winner_id IS DISTINCT FROM OLD.winner_id OR NEW.loser_id IS DISTINCT FROM OLD.loser_id
     OR NEW.field_decisions IS DISTINCT FROM OLD.field_decisions OR NEW.merged_by IS DISTINCT FROM OLD.merged_by
     OR NEW.undo_until IS DISTINCT FROM OLD.undo_until OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merge_record allows only the undone_at stamp to change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER merge_record_append_guard
  BEFORE UPDATE OR DELETE ON merge_record
  FOR EACH ROW EXECUTE FUNCTION merge_record_guard();

-- ===== M04 permissions + matrix slice (rbac_architecture [Proposed]) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-customer.read','customer.read','["pii"]','migration-0003'),
 ('seed-perm-customer.create','customer.create','["pii"]','migration-0003'),
 ('seed-perm-customer.update','customer.update','["pii"]','migration-0003'),
 ('seed-perm-customer.health.read','customer.health.read','["health"]','migration-0003'),
 ('seed-perm-customer.health.update','customer.health.update','["health"]','migration-0003'),
 ('seed-perm-customer.merge','customer.merge','["pii"]','migration-0003');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0003'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND p.code LIKE 'customer.%')
  OR (r.code = 'ops_manager' AND p.code LIKE 'customer.%')
  OR (r.code = 'order_agent' AND p.code IN
      ('customer.read','customer.create','customer.update','customer.health.read','customer.health.update'))
  OR (r.code = 'support_agent' AND p.code IN ('customer.read'))
);

-- ===== New setting: phone normalization default country [Proposed/NC — workshop] =====
INSERT INTO setting (id, key, value, value_type, scope, editable_by_roles, created_by) VALUES
 ('seed-set-default_phone_country_code','default_phone_country_code','"+966"','text','customers','["super_admin"]','migration-0003');
