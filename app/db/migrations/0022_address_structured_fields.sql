-- 0022_address_structured_fields.sql
-- Additive, nullable structured-address columns recovered from the legacy "Address Details"
-- block (House no / Building / block-floor / Street), parsed from the already-scraped
-- customer_details.jsonl. Driver-App needs these as real fields, not free text.
-- Idempotent (IF NOT EXISTS) so it is safe to re-apply on the next image deploy.
-- Applied to staging 2026-06-26 (recorded in schema_migrations).
ALTER TABLE address ADD COLUMN IF NOT EXISTS house_no        text;
ALTER TABLE address ADD COLUMN IF NOT EXISTS building        text;
ALTER TABLE address ADD COLUMN IF NOT EXISTS block_floor_raw text;
ALTER TABLE address ADD COLUMN IF NOT EXISTS street          text;

COMMENT ON COLUMN address.block_floor_raw IS
  'Raw numeric pair from legacy "Building Name : <a, b>"; labels lost in legacy template (likely block/floor) — confirm via re-scrape before relying on it.';
