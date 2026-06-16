-- 0016_wave6_ops_packing.sql — Packing workflow foundation (operational-foundation track).
-- Additive, forward-only, staging-safe. New module m20-packing owns these tables. Packing is the
-- step between kitchen "packed" and driver hand-off: an ops user batches orders by delivery
-- date/time/area, marks each packed (or flags an issue), previews/prints a label, then hands the
-- batch to driver assignment (m21-delivery).
--
-- Governance: these are NEW operational state machines (packing_batch, packing_batch_order). They
-- use guarded + same-transaction-audited status changes recorded in packing_status_history
-- (append-only). Promotion into the seeded transition_config engine is the documented follow-up
-- (see amendment A-xxx, doc 26). Frozen legacy delivery fields are copied as a snapshot at
-- batch-build time (read from customer_order; written only into our own tables = single write path).

-- ===== packing_batch =====
CREATE TABLE packing_batch (
  id            text PRIMARY KEY,
  kitchen_id    text,                       -- nullable: legacy had a single kitchen/branch
  branch_id     text,
  delivery_date date NOT NULL,
  delivery_time text,                        -- slot label (frozen legacy vocabulary)
  area          text,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','in_progress','packed','handed_to_driver','cancelled')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz,
  updated_by    text,
  version       integer NOT NULL DEFAULT 1
);
-- One active batch per (date, time, area) — re-running batch-build is idempotent, cancelled excluded.
CREATE UNIQUE INDEX packing_batch_slot_uq
  ON packing_batch (delivery_date, coalesce(delivery_time,''), coalesce(area,''))
  WHERE status <> 'cancelled';
CREATE INDEX packing_batch_date_idx   ON packing_batch (delivery_date, status);

-- ===== packing_batch_order — one row per order in a batch (frozen delivery snapshot) =====
CREATE TABLE packing_batch_order (
  id                     text PRIMARY KEY,
  batch_id               text NOT NULL REFERENCES packing_batch(id) ON DELETE CASCADE,
  order_id               text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  customer_id            text REFERENCES customer(id) ON DELETE RESTRICT,
  package_name           text,
  delivery_method_frozen text,
  delivery_time_frozen   text,
  delivery_area_frozen   text,
  packing_status         text NOT NULL DEFAULT 'pending'
                           CHECK (packing_status IN ('pending','packed','missing_item','issue','handed_to_driver')),
  label_printed_at       timestamptz,
  packed_by              text,
  packed_at              timestamptz,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  updated_at             timestamptz,
  updated_by             text,
  version                integer NOT NULL DEFAULT 1,
  UNIQUE (batch_id, order_id)                -- no duplicate order in the same batch
);
-- An order may sit in at most ONE active (non-cancelled-parent) batch — enforced in the service
-- (cross-table guard). This partial unique stops two rows for the same order being marked active
-- within the same batch lifecycle is covered by (batch_id, order_id); global guard is service-side.
CREATE INDEX packing_batch_order_order_idx ON packing_batch_order (order_id);
CREATE INDEX packing_batch_order_batch_idx ON packing_batch_order (batch_id, packing_status);

-- ===== packing_item — per-order packing checklist line (meal/component) =====
CREATE TABLE packing_item (
  id             text PRIMARY KEY,
  batch_order_id text NOT NULL REFERENCES packing_batch_order(id) ON DELETE CASCADE,
  product_id     text,                       -- nullable; catalog ref when known
  item_name      text NOT NULL,
  qty            integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  packed         boolean NOT NULL DEFAULT false,
  packed_at      timestamptz,
  packed_by      text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL
);
CREATE INDEX packing_item_order_idx ON packing_item (batch_order_id);

-- ===== packing_label — printable label snapshot (display name is masking-friendly) =====
CREATE TABLE packing_label (
  id                   text PRIMARY KEY,
  order_id             text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  batch_order_id       text REFERENCES packing_batch_order(id) ON DELETE SET NULL,
  label_code           text NOT NULL UNIQUE,
  customer_display_name text,
  package_name         text,
  delivery_date        date,
  delivery_time        text,
  area                 text,
  allergy_warning      text,
  special_notes        text,
  printed_at           timestamptz,
  printed_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL
);
CREATE INDEX packing_label_order_idx ON packing_label (order_id);

-- ===== packing_status_history — append-only audit trail of batch/order status changes =====
CREATE TABLE packing_status_history (
  id          text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('packing_batch','packing_batch_order')),
  entity_id   text NOT NULL,
  from_status text,
  to_status   text NOT NULL,
  actor       jsonb NOT NULL DEFAULT '{}',
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX packing_status_history_entity_idx ON packing_status_history (entity_type, entity_id, created_at);
CREATE TRIGGER packing_status_history_append_only
  BEFORE UPDATE OR DELETE ON packing_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== RBAC permissions (granted to active ops roles; dormant roles untouched) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-packing.batch.read','packing.batch.read','[]','seed'),
 ('seed-perm-packing.batch.create','packing.batch.create','[]','seed'),
 ('seed-perm-packing.batch.pack','packing.batch.pack','[]','seed'),
 ('seed-perm-packing.batch.issue','packing.batch.issue','[]','seed'),
 ('seed-perm-packing.batch.handoff','packing.batch.handoff','[]','seed'),
 ('seed-perm-packing.label.read','packing.label.read','["pii"]','seed'),
 ('seed-perm-packing.label.print','packing.label.print','["pii"]','seed');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code LIKE 'packing.%'
WHERE r.code IN ('super_admin','admin','ops_manager','kitchen_user');

COMMENT ON TABLE packing_batch IS
  'Packing workflow foundation (m20-packing). Batches orders by delivery date/time/area for packing before driver hand-off. Guarded+audited status; promotion to transition engine is follow-up.';
COMMENT ON TABLE packing_batch_order IS
  'One order inside a packing batch with a frozen legacy delivery snapshot. UNIQUE(batch_id,order_id) blocks duplicates.';
COMMENT ON TABLE packing_status_history IS
  'Append-only status trail for packing_batch / packing_batch_order (forbid_mutation).';
