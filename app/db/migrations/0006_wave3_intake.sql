-- 0006_wave3_intake.sql — Wave 3 intake slice (WP-07: M01 + M17 only)
-- Source: physical_schema_design.md §2 wave 3 and ASSUMPTION_REGISTER.md ASM-003..024.
-- M02 review_queue_item/review_decision intentionally wait for WP-08.

CREATE TABLE draft_order (
  id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','submitted','returned','converted','rejected','cancelled','expired')),
  channel text NOT NULL CHECK (channel IN ('whatsapp','phone','walk_in','staff','other')),
  customer_id text REFERENCES customer(id) ON DELETE RESTRICT,
  unverified_customer boolean NOT NULL DEFAULT false,
  unverified_reason text,
  package_id text REFERENCES package(id) ON DELETE RESTRICT,
  start_date date,
  end_date date,
  address_id text REFERENCES address(id) ON DELETE RESTRICT,
  address_inline jsonb,                              -- PII shadow for one-off address
  slot_id text REFERENCES delivery_slot(id) ON DELETE RESTRICT,
  method_id text REFERENCES delivery_method(id) ON DELETE RESTRICT,
  coupon_code text,
  expected_payment_method text,
  price_estimate bigint CHECK (price_estimate IS NULL OR price_estimate >= 0),
  completeness jsonb NOT NULL DEFAULT '{"missing":[],"warnings":[]}',
  allergy_conflicts jsonb NOT NULL DEFAULT '[]',
  notes text,
  submitted_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1,
  CHECK (end_date IS NULL OR start_date IS NULL OR start_date <= end_date)
);
CREATE INDEX draft_order_state_created ON draft_order (state, created_at);
CREATE INDEX draft_order_open_incomplete ON draft_order (created_at)
  WHERE state = 'open';
CREATE INDEX draft_order_customer ON draft_order (customer_id);

CREATE TABLE draft_item (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES draft_order(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX draft_item_draft ON draft_item (draft_id);

CREATE TABLE whatsapp_message_ref (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES draft_order(id) ON DELETE RESTRICT,
  sender_phone text NOT NULL,                        -- PII; normalized by M04 phone API
  message_at timestamptz NOT NULL,
  ref_note text,
  captured_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id)
);
CREATE TRIGGER whatsapp_message_ref_append_only
  BEFORE UPDATE OR DELETE ON whatsapp_message_ref
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- M01/M17 permissions + matrix slice (role content remains assumption-carried).
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-draft.read','draft.read','["pii","health","payment"]','migration-0006'),
 ('seed-perm-draft.create','draft.create','["pii","health","payment"]','migration-0006'),
 ('seed-perm-draft.update','draft.update','["pii","health","payment"]','migration-0006'),
 ('seed-perm-draft.submit','draft.submit','["pii","health","payment"]','migration-0006'),
 ('seed-perm-draft.cancel','draft.cancel','["pii"]','migration-0006'),
 ('seed-perm-draft.incomplete.read','draft.incomplete.read','["pii","health","payment"]','migration-0006'),
 ('seed-perm-whatsapp.ref.attach','whatsapp.ref.attach','["pii"]','migration-0006');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0006'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND (p.code LIKE 'draft.%' OR p.code = 'whatsapp.ref.attach'))
  OR (r.code = 'ops_manager' AND (p.code LIKE 'draft.%' OR p.code = 'whatsapp.ref.attach'))
  OR (r.code = 'order_agent' AND p.code IN
      ('draft.read','draft.create','draft.update','draft.submit','draft.cancel',
       'draft.incomplete.read','whatsapp.ref.attach'))
  OR (r.code = 'support_agent' AND p.code = 'draft.read')
);

-- Assumption-carried required set (ASM-005), intentionally configurable.
INSERT INTO setting (id, key, value, value_type, scope, editable_by_roles, created_by) VALUES
 ('seed-set-draft_submit_required_fields','draft_submit_required_fields',
  '["customer","channel","selection","start_date","address","area","delivery_slot","delivery_method","expected_payment_method"]',
  'json','intake','["ops_manager"]','migration-0006');
