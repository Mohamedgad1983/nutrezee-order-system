-- Manual Exception Review foundation (M19 migration domain). Persists every legacy
-- record that could NOT be safely auto-imported, for human review. Additive, staging-safe,
-- forward-only. Holds PII (phone/name) — never exported to the repo. Excluded from WhatsApp
-- eligibility by design (see review_status + the segmentation query).
CREATE TABLE migration_exception_review (
  id                  text PRIMARY KEY,
  legacy_customer_id  text,
  legacy_order_id     text,
  phone_original      text,
  normalized_phone    text,
  customer_name       text,
  reason              text NOT NULL,
  repairability       text NOT NULL,
  recommended_action  text,
  risk_level          text NOT NULL CHECK (risk_level IN ('low','medium','high')),
  review_status       text NOT NULL DEFAULT 'pending'
                        CHECK (review_status IN ('pending','approved','rejected','resolved','wont_fix')),
  reviewed_by         text,
  reviewed_at         timestamptz,
  resolution_notes    text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX migration_exception_review_reason_idx ON migration_exception_review(reason);
CREATE INDEX migration_exception_review_status_idx ON migration_exception_review(review_status);
CREATE INDEX migration_exception_review_phone_idx  ON migration_exception_review(normalized_phone);

COMMENT ON TABLE migration_exception_review IS
  'Legacy records not safely auto-imported (Phase-1 accepted exceptions). Manual review workflow. Excluded from WhatsApp eligibility.';
