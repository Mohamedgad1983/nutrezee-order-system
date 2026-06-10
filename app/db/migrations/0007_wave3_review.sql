-- 0007_wave3_review.sql — Wave 3 review queue slice (WP-08: M02)
-- Source: physical_schema_design.md §2 wave 3 and ASSUMPTION_REGISTER.md ASM-025.
-- Approval records a review decision; M03 order conversion waits for WP-09.

CREATE TABLE review_queue_item (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES draft_order(id) ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  sla_due_at timestamptz NOT NULL,
  reviewer_id text REFERENCES staff_user(id) ON DELETE RESTRICT,
  queue_state text NOT NULL DEFAULT 'waiting'
    CHECK (queue_state IN ('waiting','in_review','decided')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX review_queue_active_draft ON review_queue_item (draft_id)
  WHERE queue_state != 'decided';
CREATE INDEX review_queue_state_sla ON review_queue_item (queue_state, sla_due_at);

CREATE TABLE review_decision (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES draft_order(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve','reject','return','hold')),
  reason_code_id text REFERENCES reason_code(id) ON DELETE RESTRICT,
  note text,
  warnings_overridden jsonb NOT NULL DEFAULT '[]',
  decided_by text NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision NOT IN ('reject','return') OR reason_code_id IS NOT NULL)
);
CREATE INDEX review_decision_draft ON review_decision (draft_id, decided_at);
CREATE TRIGGER review_decision_append_only
  BEFORE UPDATE OR DELETE ON review_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-review.queue.read','review.queue.read','["pii","health","payment"]','migration-0007'),
 ('seed-perm-review.claim','review.claim','["pii","health","payment"]','migration-0007'),
 ('seed-perm-review.decide','review.decide','["pii","health","payment"]','migration-0007');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0007'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND p.code LIKE 'review.%')
  OR (r.code = 'ops_manager' AND p.code LIKE 'review.%')
  OR (r.code = 'order_agent' AND p.code = 'review.queue.read')
);
