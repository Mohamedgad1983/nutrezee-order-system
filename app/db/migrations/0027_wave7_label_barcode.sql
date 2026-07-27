-- 0027_wave7_label_barcode.sql
-- WP-LBL-A27 (amendment A27) — exact legacy label + ONE permanent Code128 barcode per customer.
-- Module m25-label owns every table created here. Additive and forward-only: no existing table,
-- column, constraint or seed row is modified. All reads of customer/order/address/dish data stay
-- read-only through the owning modules' tables (single write path preserved).

-- ===== customer_barcode — the permanent, PII-free customer barcode =====
-- One ACTIVE barcode per customer (partial unique). A value is globally unique, so a barcode can
-- never belong to two customers. Merge does NOT delete the loser's barcode: it is repointed at the
-- surviving customer with status 'alias', so every label already printed keeps resolving.
CREATE TABLE customer_barcode (
  id                      text PRIMARY KEY,
  customer_id             text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  barcode_value           text NOT NULL UNIQUE,          -- NZC-XXXX-XXXX-CC; carries no PII
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','alias','disabled')),
  issued_at               timestamptz NOT NULL DEFAULT now(),
  issued_by               text NOT NULL,
  -- administrative replacement (exceptional, audited)
  replaced_by_id          text REFERENCES customer_barcode(id) ON DELETE SET NULL,
  replacement_reason      text,
  disabled_at             timestamptz,
  disabled_by             text,
  -- merge provenance: the customer this row belonged to before a merge repointed it, and the
  -- status it held then, so an undone merge restores ownership unambiguously
  merged_from_customer_id text,
  merged_at               timestamptz,
  pre_merge_status        text CHECK (pre_merge_status IN ('active','alias','disabled')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz,
  updated_by              text,
  version                 integer NOT NULL DEFAULT 1,
  -- a disabled row must say why it was disabled
  CHECK (status <> 'disabled' OR (replacement_reason IS NOT NULL AND btrim(replacement_reason) <> ''))
);
-- exactly one active barcode per customer; alias/disabled rows are unlimited
CREATE UNIQUE INDEX customer_barcode_one_active ON customer_barcode (customer_id) WHERE status = 'active';
CREATE INDEX customer_barcode_customer_idx ON customer_barcode (customer_id);
CREATE INDEX customer_barcode_status_idx   ON customer_barcode (status);

-- ===== label_print_event — append-only record of every print and reprint =====
-- A reprint must carry a reason (DB-enforced). Reprinting never changes the barcode: the value
-- printed is stored here so the trail proves it stayed the same.
CREATE TABLE label_print_event (
  id             text PRIMARY KEY,
  order_id       text NOT NULL REFERENCES customer_order(id) ON DELETE RESTRICT,
  customer_id    text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  delivery_date  date NOT NULL,
  barcode_value  text NOT NULL,
  print_kind     text NOT NULL CHECK (print_kind IN ('print','reprint')),
  reason         text,
  batch_ref      text,                                   -- groups one batch-print run
  printed_by     text NOT NULL,
  printed_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (print_kind = 'print' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);
CREATE INDEX label_print_event_order_idx ON label_print_event (order_id, delivery_date);
CREATE INDEX label_print_event_batch_idx ON label_print_event (batch_ref) WHERE batch_ref IS NOT NULL;
CREATE INDEX label_print_event_cust_idx  ON label_print_event (customer_id);

CREATE TRIGGER label_print_event_append_only
  BEFORE UPDATE OR DELETE ON label_print_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== box_collection — one customer's daily box, collected once =====
-- The daily box holds all of the customer's meals for that date, so collection is recorded per
-- (customer, delivery_date) — NOT per meal and NOT per driver. Enforcing uniqueness on
-- (customer_id, delivery_date) is deliberately stricter than (customer, date, driver): two
-- different drivers must not each be able to collect the same customer's box on the same day.
-- The driver and route that performed the collection are recorded as attributes.
CREATE TABLE box_collection (
  id                 text PRIMARY KEY,
  customer_id        text NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  delivery_date      date NOT NULL,
  order_id           text REFERENCES customer_order(id) ON DELETE RESTRICT,
  fulfillment_day_id text REFERENCES fulfillment_day(id) ON DELETE RESTRICT,
  driver_id          text REFERENCES driver(id) ON DELETE RESTRICT,
  route_id           text REFERENCES delivery_route(id) ON DELETE SET NULL,
  barcode_id         text NOT NULL REFERENCES customer_barcode(id) ON DELETE RESTRICT,
  barcode_value      text NOT NULL,
  device_ref         text,                               -- opaque device identifier; never PII
  scanned_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL
);
-- DB-enforced "collected once per customer per day"
CREATE UNIQUE INDEX box_collection_one_per_day ON box_collection (customer_id, delivery_date);
CREATE INDEX box_collection_driver_date_idx ON box_collection (driver_id, delivery_date);
CREATE INDEX box_collection_order_idx       ON box_collection (order_id);

CREATE TRIGGER box_collection_append_only
  BEFORE UPDATE OR DELETE ON box_collection
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== driver <-> staff_user link =====
-- Collection scanning must attribute a scan to the LOGGED-IN driver and check it against that
-- driver's manifest, but no link between an authenticated staff_user and a `driver` row existed.
-- Additive nullable column on the m21-delivery-owned table; m21 remains its only writer, m25 reads
-- it. Matching by name or phone instead was rejected: it is exactly the fuzzy identity guessing
-- the programme forbids.
ALTER TABLE driver ADD COLUMN IF NOT EXISTS staff_user_id text REFERENCES staff_user(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX driver_staff_user_uq ON driver (staff_user_id) WHERE staff_user_id IS NOT NULL;
COMMENT ON COLUMN driver.staff_user_id IS
  'Links a driver to the staff_user account they sign in with, so a collection scan can be checked against that driver''s own manifest. Nullable: a driver who never signs in has none.';

-- ===== deterministic meal order on the label =====
-- customer_dish_day_item (migration 0020) has no ordering column, so the label's meal rows could
-- only be ordered by created_at + id. Rows imported in one transaction share created_at and ULID
-- ids carry a random component within the same millisecond, so the printed dish order was not the
-- source order. The legacy label lists meals in a meaningful sequence (first meal first), so an
-- explicit nullable position is added; the label orders by it and falls back to created_at, id.
ALTER TABLE customer_dish_day_item ADD COLUMN IF NOT EXISTS sort_order integer;
COMMENT ON COLUMN customer_dish_day_item.sort_order IS
  'Position of this dish within its meal-day, as captured from the source. Drives the printed label order; NULL falls back to created_at, id.';

-- ===== RBAC (granted to active roles only; dormant roles untouched) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-label.read','label.read','["pii"]','seed'),
 ('seed-perm-label.print','label.print','["pii"]','seed'),
 ('seed-perm-label.reprint','label.reprint','["pii"]','seed'),
 ('seed-perm-barcode.read','barcode.read','[]','seed'),
 ('seed-perm-barcode.issue','barcode.issue','[]','seed'),
 ('seed-perm-barcode.replace','barcode.replace','[]','seed'),
 ('seed-perm-collection.scan','collection.scan','[]','seed'),
 -- Deliberately NO "pii" grant. visibility_grants aggregate per ROLE, not per permission, so
 -- attaching pii here would give the `driver` role blanket PII visibility across the whole API —
 -- which ts-r-rbac and ts-r-masking explicitly forbid. Drivers therefore see the customer name
 -- masked and identify the stop by order number, area and time. Granting drivers name visibility
 -- is a governance decision for the owner, not a side effect of this work package.
 ('seed-perm-collection.manifest.read','collection.manifest.read','[]','seed');

-- label.* + barcode.read/issue: ops/kitchen roles that actually print
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code IN ('label.read','label.print','label.reprint','barcode.read','barcode.issue')
WHERE r.code IN ('super_admin','admin','ops_manager','kitchen_user');

-- barcode.replace: exceptional administrative action — admins only
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code = 'barcode.replace'
WHERE r.code IN ('super_admin','admin');

-- collection: drivers scan their own manifest; ops supervise.
-- logistics_manager is deliberately excluded: WP-OPS-03 froze that role's permission set as a
-- security guard (ts-u-driver-order-reassignment asserts it exactly), and collection oversight is
-- already covered by super_admin/admin/ops_manager. Adding it there is an owner decision.
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON p.code IN ('collection.scan','collection.manifest.read')
WHERE r.code IN ('super_admin','admin','ops_manager','driver');

COMMENT ON TABLE customer_barcode IS
  'WP-LBL-A27 (m25-label). Permanent, PII-free Code128 customer barcode. One ACTIVE row per customer (partial unique); values globally unique. Merge repoints the loser row to the survivor with status=alias so previously printed labels keep resolving. Replacement is an exceptional audited admin action.';
COMMENT ON COLUMN customer_barcode.barcode_value IS
  'NZC-XXXX-XXXX-CC. Random over a 32-symbol ambiguity-free alphabet (no I/L/O/U) plus 2 check chars. Never derived from any customer attribute, so it encodes no PII.';
COMMENT ON TABLE label_print_event IS
  'WP-LBL-A27 (m25-label). Append-only print/reprint trail. Reprints require a reason (DB CHECK). Stores the barcode printed, proving reprints do not change it.';
COMMENT ON TABLE box_collection IS
  'WP-LBL-A27 (m25-label). One collected daily box per customer per delivery date (UNIQUE customer_id, delivery_date). Append-only. Driver/route/device recorded as attributes of the single allowed collection.';
