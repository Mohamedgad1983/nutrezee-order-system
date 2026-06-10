-- 0010_wave4_payments.sql — Wave 4 payment-lite slice (WP-11: M07 only)
-- Gateway integrations and refunds are intentionally dormant; this migration adds
-- the local payment state machine persistence and finance review queue.

CREATE TABLE payment_record (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES customer_order(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid','link_sent','paid','failed','cod_pending','collected',
                      'refund_requested','refunded')),
  method text,
  amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'SAR',
  transaction_ref text,
  link_ref text,
  evidence_note text,
  origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')),
  import_batch_id text REFERENCES import_batch(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX payment_record_status ON payment_record (status);

CREATE TABLE payment_review_item (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payment_record(id) ON DELETE RESTRICT,
  requested_status text NOT NULL,
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','in_review','decided')),
  evidence_note text,
  requested_by text NOT NULL,
  decision text CHECK (decision IN ('approve','reject')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz, updated_by text, version integer NOT NULL DEFAULT 1
);
CREATE INDEX payment_review_state ON payment_review_item (state, created_at);
CREATE INDEX payment_review_payment ON payment_review_item (payment_id);

INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-payment.read','payment.read','["payment"]','migration-0010'),
 ('seed-perm-payment.link.record','payment.link.record','["payment"]','migration-0010'),
 ('seed-perm-payment.review.request','payment.review.request','["payment"]','migration-0010'),
 ('seed-perm-payment.review.decide','payment.review.decide','["payment"]','migration-0010'),
 ('seed-perm-payment.refund.request','payment.refund.request','["payment"]','migration-0010'),
 ('seed-perm-payment.refund.decide','payment.refund.decide','["payment"]','migration-0010');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0010'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND p.code LIKE 'payment.%')
  OR (r.code = 'finance' AND p.code LIKE 'payment.%')
  OR (r.code = 'ops_manager' AND p.code IN ('payment.read','payment.refund.request'))
  OR (r.code = 'order_agent' AND p.code IN ('payment.read','payment.link.record','payment.review.request'))
  OR (r.code = 'support_agent' AND p.code = 'payment.read')
);
