-- 0032_import_batch_source_meta.sql
-- WP-OPS-07 (part 1) — Partner feed freshness. Each M19 batch may record where its rows came from
-- (for `partner_daily`: delivery_date, delivery_rows, the newest Partner `updated_at`, fetched_at) so
-- Fleet-Ops can show "Partner data checked / last changed at …". Additive, nullable; no data changes.
ALTER TABLE import_batch ADD COLUMN IF NOT EXISTS source_meta jsonb;
CREATE INDEX IF NOT EXISTS import_batch_partner_daily_date_idx
  ON import_batch ((source_meta->>'delivery_date'), created_at DESC)
  WHERE type = 'partner_daily';
