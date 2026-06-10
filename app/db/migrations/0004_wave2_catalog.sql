-- 0004_wave2_catalog.sql — Wave 2 (WP-05): M05 catalog cluster.
-- physical_schema §2 wave 2. AMENDMENT A6 (logged in build_progress_register):
-- ingredient_allergen link table added — the logical model's AllergenResolver
-- ("derived_from_ingredient") requires ingredient->allergen knowledge that no
-- modeled table carried. Discovered during WP-05 build; structure-only addition.

CREATE TABLE product (
  id text PRIMARY KEY,
  code text,
  name_en text NOT NULL, name_ar text NOT NULL,
  meal_type_id text REFERENCES meal_type(id),
  price bigint CHECK (price >= 0),
  currency char(3) NOT NULL DEFAULT 'SAR',          -- [NC single currency assumed]
  description_en text, description_ar text,
  tags jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE product_component (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  name_en text NOT NULL, name_ar text NOT NULL,
  sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);

CREATE TABLE product_ingredient (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  ingredient_id text NOT NULL REFERENCES ingredient(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (product_id, ingredient_id)
);

CREATE TABLE ingredient_allergen (  -- AMENDMENT A6
  id text PRIMARY KEY,
  ingredient_id text NOT NULL REFERENCES ingredient(id) ON DELETE RESTRICT,
  allergen_id text NOT NULL REFERENCES allergen(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (ingredient_id, allergen_id)
);

CREATE TABLE product_allergen (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  allergen_id text NOT NULL REFERENCES allergen(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('declared','derived_from_ingredient')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (product_id, allergen_id)
);

CREATE TABLE nutrition_facts (
  id text PRIMARY KEY,
  product_id text NOT NULL UNIQUE REFERENCES product(id) ON DELETE RESTRICT,
  calories integer CHECK (calories >= 0),
  protein_g numeric(6,1) CHECK (protein_g >= 0),
  carbs_g numeric(6,1) CHECK (carbs_g >= 0),
  fat_g numeric(6,1) CHECK (fat_g >= 0),
  notes_en text, notes_ar text,                    -- nullable until content work [NC S8 set]
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE package (
  id text PRIMARY KEY,
  name_en text NOT NULL, name_ar text NOT NULL,
  parent_package_id text REFERENCES package(id),    -- "sub-package" (C7 [I], workshop S1)
  duration_days integer CHECK (duration_days > 0),
  meals_per_day integer CHECK (meals_per_day > 0),
  price bigint CHECK (price >= 0),
  currency char(3) NOT NULL DEFAULT 'SAR',
  package_for_id text REFERENCES package_for_type(id),
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

-- parent-chain cycle guard (C7): walking up from NEW must never revisit a node
CREATE OR REPLACE FUNCTION package_no_cycle() RETURNS trigger AS $$
DECLARE cur text; hops int := 0;
BEGIN
  cur := NEW.parent_package_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN RAISE EXCEPTION 'package parent cycle detected'; END IF;
    SELECT parent_package_id INTO cur FROM package WHERE id = cur;
    hops := hops + 1;
    IF hops > 50 THEN RAISE EXCEPTION 'package parent chain too deep'; END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER package_cycle_guard
  BEFORE INSERT OR UPDATE OF parent_package_id ON package
  FOR EACH ROW EXECUTE FUNCTION package_no_cycle();

CREATE TABLE routing_rule (
  id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('product','component','meal_type')),
  target_ref text NOT NULL,
  section_id text NOT NULL REFERENCES section_master(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  effective_from date,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);  -- zero rows until DEC-006 (ADR-006: rules are data)

-- ===== M05 permissions + matrix slice [Proposed — catalog owner NC (RBAC Q1)] =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-catalog.read','catalog.read','[]','migration-0004'),
 ('seed-perm-catalog.manage','catalog.manage','[]','migration-0004'),
 ('seed-perm-catalog.enrich','catalog.enrich','[]','migration-0004'),
 ('seed-perm-routing.manage','routing.manage','[]','migration-0004');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0004'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND p.code LIKE 'catalog.%')
  OR (r.code = 'super_admin' AND p.code = 'routing.manage')
  OR (r.code = 'admin' AND p.code IN ('catalog.read','catalog.manage','catalog.enrich'))
  OR (r.code = 'ops_manager' AND p.code IN ('catalog.read','catalog.enrich','routing.manage'))
  OR (r.code IN ('order_agent','kitchen_user','support_agent') AND p.code = 'catalog.read')
);
