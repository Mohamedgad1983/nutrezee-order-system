-- 0030_partner_daily_import_type.sql
-- WP-OPS-06 (A47) — Partner daily-deliveries → Nutrezee order feed. The M19 batch runner gains a
-- fourth import type so Partner's per-day delivery rows can be mirrored into customer_order /
-- fulfillment_day through the owning modules (ADR-010). Forward-only, additive: the CHECK is
-- widened; no data changes.

ALTER TABLE import_batch DROP CONSTRAINT import_batch_type_check;
ALTER TABLE import_batch
  ADD CONSTRAINT import_batch_type_check
  CHECK (type IN ('customer', 'catalog', 'active_plans', 'partner_daily'));

COMMENT ON COLUMN import_batch.type IS
  'customer | catalog | active_plans | partner_daily (Partner /integration/daily-deliveries mirror, WP-OPS-06)';
