-- 0008_wave4_orders.sql — Wave 4 order core slice (WP-09: M03 only)
-- Payment tables wait for WP-11; kitchen tickets wait for WP-10.

CREATE TABLE customer_order (
  id text PRIMARY KEY,
  order_number text UNIQUE NOT NULL,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  package_id text REFERENCES package(id) ON DELETE RESTRICT,
  package_name_frozen_en text,
  package_name_frozen_ar text,
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft','pending_review','approved','active','paused','completed','expired','cancelled','rejected')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  off_days jsonb NOT NULL DEFAULT '[]',
  off_days_unverified boolean NOT NULL DEFAULT false,
  channel text NOT NULL,
  source_draft_id text UNIQUE REFERENCES draft_order(id) ON DELETE RESTRICT,
  coupon_code_frozen text,
  package_amount bigint NOT NULL DEFAULT 0 CHECK (package_amount >= 0),
  discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  currency char(3) NOT NULL DEFAULT 'SAR',
  site_ref text,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1,
  CHECK (start_date <= end_date)
);
CREATE INDEX customer_order_status_start ON customer_order (status, start_date);
CREATE INDEX customer_order_customer ON customer_order (customer_id);

CREATE TABLE order_item (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  product_id text REFERENCES product(id) ON DELETE RESTRICT,
  name_frozen_en text NOT NULL,
  name_frozen_ar text,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price_frozen bigint NOT NULL DEFAULT 0 CHECK (unit_price_frozen >= 0),
  allergens_frozen jsonb NOT NULL DEFAULT '[]',
  routing_hint_frozen jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);
CREATE INDEX order_item_order ON order_item (order_id);
CREATE TRIGGER order_item_frozen
  BEFORE UPDATE OR DELETE ON order_item
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE fulfillment_day (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','kitchen_queued','in_preparation','ready_to_pack','packed',
                      'assigned_to_driver','out_for_delivery','delivered','failed','rescheduled',
                      'skipped','cancelled_day')),
  slot_id text REFERENCES delivery_slot(id) ON DELETE RESTRICT,
  address_frozen jsonb NOT NULL,
  reschedule_link_id text REFERENCES fulfillment_day(id) ON DELETE RESTRICT,
  reason_code_id text REFERENCES reason_code(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1,
  UNIQUE(order_id, date)
);
CREATE INDEX fulfillment_day_date_status ON fulfillment_day (date, status);

CREATE TABLE order_status_history (
  id text PRIMARY KEY,
  subject text NOT NULL CHECK (subject IN ('order','fulfillment_day')),
  subject_ref text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id text,
  actor_note text,
  at timestamptz NOT NULL DEFAULT now(),
  reason_code_id text REFERENCES reason_code(id) ON DELETE RESTRICT
);
CREATE INDEX order_status_history_subject ON order_status_history (subject, subject_ref, at);
CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE change_request (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  diff jsonb NOT NULL,
  impact jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','applied')),
  requested_by text NOT NULL,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX change_request_order_state ON change_request (order_id, state);

CREATE TABLE exception_case (
  id text PRIMARY KEY,
  type_code_id text NOT NULL REFERENCES reason_code(id) ON DELETE RESTRICT,
  refs jsonb NOT NULL DEFAULT '{}',
  severity text NOT NULL CHECK (severity IN ('info','warn','high')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_progress','resolved')),
  owner_id text REFERENCES staff_user(id) ON DELETE RESTRICT,
  resolution_code_id text REFERENCES reason_code(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX exception_case_state_severity ON exception_case (state, severity);

INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-order.read','order.read','["pii","health","payment"]','migration-0008'),
 ('seed-perm-order.create_from_review','order.create_from_review','["pii","health","payment"]','migration-0008'),
 ('seed-perm-order.transition','order.transition','["pii","payment"]','migration-0008'),
 ('seed-perm-fulfillment.read','fulfillment.read','["pii"]','migration-0008'),
 ('seed-perm-fulfillment.transition','fulfillment.transition','["pii"]','migration-0008'),
 ('seed-perm-change_request.create','change_request.create','["pii","payment"]','migration-0008'),
 ('seed-perm-change_request.decide','change_request.decide','["pii","payment"]','migration-0008'),
 ('seed-perm-exception.create','exception.create','["pii","health"]','migration-0008'),
 ('seed-perm-exception.resolve','exception.resolve','["pii","health"]','migration-0008');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0008'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND (p.code LIKE 'order.%' OR p.code LIKE 'fulfillment.%'
    OR p.code LIKE 'change_request.%' OR p.code LIKE 'exception.%'))
  OR (r.code = 'ops_manager' AND (p.code LIKE 'order.%' OR p.code LIKE 'fulfillment.%'
    OR p.code LIKE 'change_request.%' OR p.code LIKE 'exception.%'))
  OR (r.code = 'order_agent' AND p.code IN ('order.read','fulfillment.read','change_request.create','exception.create'))
  OR (r.code = 'support_agent' AND p.code IN ('order.read','fulfillment.read','change_request.create','exception.create'))
  OR (r.code = 'kitchen_user' AND p.code IN ('fulfillment.read','exception.create'))
);
