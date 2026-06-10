-- 0001_wave1_foundation.sql — Wave 1 DDL (WP-01)
-- Source: 10_Data_Model/physical_schema_design.md §1-2 (wave 1 + platform tables A3/A4).
-- Conventions (§0): text ULID ids (app-generated), timestamptz UTC, std lifecycle columns.
-- created_by/updated_by are plain text staff ids (no FK: avoids staff_user bootstrap
-- circularity and allows the 'system' actor); attribution integrity lives in audit_event.
-- Forward-only migration; rollback = corrective migration (16_Deployment runbook).

-- ===== M12 / M13 — staff, roles, permissions =====
CREATE TABLE staff_user (
  id            text PRIMARY KEY,
  name_en       text NOT NULL,
  name_ar       text,
  email         text NOT NULL UNIQUE,            -- PII
  phone         text,                            -- PII
  active        boolean NOT NULL DEFAULT true,   -- deactivate, never delete
  locale        text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
  password_hash text,                            -- argon2id; set by bootstrap/invite
  failed_logins integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE role (
  id text PRIMARY KEY, code text NOT NULL UNIQUE,
  name_en text NOT NULL, name_ar text,
  active boolean NOT NULL DEFAULT true, dormant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE permission (
  id text PRIMARY KEY, code text NOT NULL UNIQUE,            -- module.action[.scope]
  visibility_grants jsonb NOT NULL DEFAULT '[]',             -- subset of pii|health|payment
  created_at timestamptz NOT NULL DEFAULT now(), created_by text
);

CREATE TABLE role_permission (
  id text PRIMARY KEY,
  role_id text NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
  permission_id text NOT NULL REFERENCES permission(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE role_assignment (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT,
  role_id  text NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
  assigned_by text, assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, role_id)
);

CREATE TABLE session (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at   timestamptz,
  source     jsonb
);
CREATE INDEX session_staff_expiry ON session (staff_id, expires_at);

-- ===== M14 — audit (append-only, immutable, partitioned by month [Proposed]) =====
-- MVP start: DEFAULT partition only; monthly partition automation is an ops task
-- (audit_architecture retention tiers) added before pilot volume warrants it.
CREATE TABLE audit_event (
  id            text NOT NULL,
  event_type    text NOT NULL,
  actor_id      text,                             -- null => system actor
  actor_role    text,
  on_behalf_of  text,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  related_refs  jsonb NOT NULL DEFAULT '{}',
  before        jsonb,
  after         jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  source        jsonb,
  severity      text NOT NULL CHECK (severity IN ('info','warn','high')),
  reason        text,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE audit_event_default PARTITION OF audit_event DEFAULT;
CREATE INDEX audit_entity   ON audit_event (entity_type, entity_id, occurred_at);
CREATE INDEX audit_type     ON audit_event (event_type, occurred_at);
CREATE INDEX audit_high     ON audit_event (occurred_at) WHERE severity = 'high';

-- Append-only enforcement (physical_schema §4): triggers + revoked grants pattern.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % does not allow %', TG_TABLE_NAME, TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== M16 — settings, flags, reason codes, ops masters, transition config (A3) =====
CREATE TABLE setting (
  id text PRIMARY KEY, key text NOT NULL UNIQUE,
  value jsonb,
  value_type text NOT NULL CHECK (value_type IN ('text','number','time','flag','enum','json')),
  scope text, effective_from timestamptz,
  editable_by_roles jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE feature_flag (
  id text PRIMARY KEY, key text NOT NULL UNIQUE,
  on_flag boolean NOT NULL DEFAULT false, note text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE reason_code (
  id text PRIMARY KEY,
  domain text NOT NULL CHECK (domain IN
    ('rejection','cancellation','return_to_draft','day_cancel','ticket_block',
     'escalation','complaint','payment_fail','merge')),
  code text NOT NULL, label_en text NOT NULL, label_ar text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1,
  UNIQUE (domain, code)
);

CREATE TABLE section_master (
  id text PRIMARY KEY, code text NOT NULL UNIQUE,
  name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  manager_id text, site_ref text,                  -- site dormant [NC multi-site]
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);  -- zero rows until DEC-006 (workshop)

CREATE TABLE area (
  id text PRIMARY KEY, code text NOT NULL UNIQUE,
  name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);  -- zero rows until workshop

CREATE TABLE delivery_slot (
  id text PRIMARY KEY,
  label_en text NOT NULL, label_ar text NOT NULL,
  start_time time NOT NULL, end_time time NOT NULL CHECK (start_time < end_time),
  capacity integer,                                -- null = warn-only mode [NC unit]
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE delivery_method (
  id text PRIMARY KEY,
  name_en text NOT NULL, name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);

CREATE TABLE transition_config (             -- amendment A3 (state machines as config)
  id text PRIMARY KEY,
  machine text NOT NULL CHECK (machine IN ('order','fulfillment','payment','ticket','draft')),
  from_status text NOT NULL, to_status text NOT NULL,
  allowed_roles jsonb NOT NULL DEFAULT '[]',  -- role codes; 'system' allowed literal
  validations  jsonb NOT NULL DEFAULT '[]',   -- named validator slots (validation binding §4)
  requires_reason boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1,
  UNIQUE (machine, from_status, to_status)
);

-- ===== Platform (amendment A4) =====
CREATE TABLE outbox_event (
  id text PRIMARY KEY,
  event_type text NOT NULL, version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor jsonb, refs jsonb NOT NULL DEFAULT '{}', payload jsonb NOT NULL DEFAULT '{}',
  dispatched_at timestamptz
);
CREATE INDEX outbox_undispatched ON outbox_event (occurred_at) WHERE dispatched_at IS NULL;

CREATE TABLE idempotency_key (
  key text PRIMARY KEY,
  operation text NOT NULL, request_hash text NOT NULL,
  response_ref text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_read_queue (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  drained_at timestamptz
);
CREATE INDEX read_queue_undrained ON audit_read_queue (enqueued_at) WHERE drained_at IS NULL;
