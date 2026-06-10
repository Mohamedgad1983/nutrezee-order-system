-- 0009_wave5_kitchen.sql — Wave 5 kitchen slice (WP-10: M08 only)
-- Notifications/reports/bridge follow later wave-5 WPs.

INSERT INTO section_master (id, code, name_en, name_ar, created_by) VALUES
 ('seed-section-hot','hot','Hot','Hot','migration-0009'),
 ('seed-section-cold','cold','Cold','Cold','migration-0009'),
 ('seed-section-bakery','bakery','Bakery','Bakery','migration-0009'),
 ('seed-section-prep','prep','Prep','Prep','migration-0009'),
 ('seed-section-unrouted','unrouted','Unrouted','Unrouted','migration-0009');

CREATE TABLE kitchen_ticket (
  id text PRIMARY KEY,
  fulfillment_day_id text NOT NULL REFERENCES fulfillment_day(id) ON DELETE RESTRICT,
  section_id text REFERENCES section_master(id) ON DELETE RESTRICT,
  unrouted boolean NOT NULL DEFAULT false,
  item_refs jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','prepared','blocked')),
  allergy_marker boolean NOT NULL DEFAULT false,
  blocked_reason_id text REFERENCES reason_code(id) ON DELETE RESTRICT,
  generation_batch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1,
  CHECK ((section_id IS NOT NULL AND unrouted = false) OR (section_id IS NULL AND unrouted = true))
);
CREATE UNIQUE INDEX kitchen_ticket_section_batch
  ON kitchen_ticket (fulfillment_day_id, section_id, generation_batch)
  WHERE section_id IS NOT NULL;
CREATE UNIQUE INDEX kitchen_ticket_unrouted_batch
  ON kitchen_ticket (fulfillment_day_id, generation_batch)
  WHERE unrouted;
CREATE INDEX kitchen_ticket_section_status ON kitchen_ticket (section_id, status);
CREATE INDEX kitchen_ticket_unrouted ON kitchen_ticket (fulfillment_day_id) WHERE unrouted;

CREATE TABLE ticket_status_event (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES kitchen_ticket(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  actor jsonb NOT NULL,
  reason_code_id text REFERENCES reason_code(id) ON DELETE RESTRICT,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_status_event_ticket ON ticket_status_event (ticket_id, at);
CREATE TRIGGER ticket_status_event_append_only
  BEFORE UPDATE OR DELETE ON ticket_status_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE escalation (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES kitchen_ticket(id) ON DELETE RESTRICT,
  type_code_id text NOT NULL REFERENCES reason_code(id) ON DELETE RESTRICT,
  proposed_substitute_id text REFERENCES product(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','rejected')),
  notes text,
  resolved_by text REFERENCES staff_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  resolved_at timestamptz,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX escalation_state ON escalation (state);
CREATE INDEX escalation_ticket ON escalation (ticket_id);

INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-kitchen.board.read','kitchen.board.read','["pii","health"]','migration-0009'),
 ('seed-perm-kitchen.ticket.generate','kitchen.ticket.generate','["pii","health"]','migration-0009'),
 ('seed-perm-kitchen.ticket.transition','kitchen.ticket.transition','["pii","health"]','migration-0009'),
 ('seed-perm-kitchen.day.pack','kitchen.day.pack','["pii","health"]','migration-0009'),
 ('seed-perm-kitchen.escalation.raise','kitchen.escalation.raise','["pii","health"]','migration-0009'),
 ('seed-perm-kitchen.escalation.resolve','kitchen.escalation.resolve','["pii","health"]','migration-0009');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0009'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND p.code LIKE 'kitchen.%')
  OR (r.code = 'ops_manager' AND p.code LIKE 'kitchen.%')
  OR (r.code = 'kitchen_user' AND p.code IN
      ('kitchen.board.read','kitchen.ticket.transition','kitchen.day.pack','kitchen.escalation.raise'))
  OR (r.code = 'support_agent' AND p.code = 'kitchen.board.read')
);
