-- ============================================================================
-- Nutrezee Order System — Extracted-Data Read-Only Verification
-- ----------------------------------------------------------------------------
-- Purpose : Re-verify the documented extraction/import counts directly against
--           the STAGING database, using ONLY SELECT / count / metadata queries.
-- Target  : Staging only — docker container `nutrezee-postgres-1` (db `nutrezee`,
--           user `nutrezee`) on VPS vmi3360590. NEVER production.
-- Safety  : Read-only. No INSERT/UPDATE/DELETE/DDL. No PII selected (counts and
--           aggregate distributions only). Connect via the container local
--           socket: `docker exec nutrezee-postgres-1 psql -U nutrezee -d nutrezee`.
--
-- Execution status (this run): EXECUTED 2026-06-20 against staging.
--   The blocks marked [EXECUTED] below were run and their results recorded in
--   ../09_report_manifest.md and ../02_data_inventory.md.
--   The blocks marked [PROPOSED] are safe extensions that were NOT run this run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- [EXECUTED] 1. Core entity row counts (one row per entity)
-- ---------------------------------------------------------------------------
SELECT 'customer'                     AS entity, count(*) FROM customer
UNION ALL SELECT 'address',                     count(*) FROM address
UNION ALL SELECT 'customer_order',              count(*) FROM customer_order
UNION ALL SELECT 'fulfillment_day',             count(*) FROM fulfillment_day
UNION ALL SELECT 'payment_record',              count(*) FROM payment_record
UNION ALL SELECT 'customer_meal_history',       count(*) FROM customer_meal_history
UNION ALL SELECT 'customer_meal_history_items', count(*) FROM customer_meal_history_items
UNION ALL SELECT 'legacy_meal_history_raw',     count(*) FROM legacy_meal_history_raw
UNION ALL SELECT 'product',                     count(*) FROM product
UNION ALL SELECT 'package',                     count(*) FROM package
UNION ALL SELECT 'area',                        count(*) FROM area
UNION ALL SELECT 'sync_record',                 count(*) FROM sync_record
UNION ALL SELECT 'migration_exception_review',  count(*) FROM migration_exception_review
ORDER BY entity;
-- Result 2026-06-20:
--   address 9511 · area 127 · customer 19476 · customer_meal_history 4955 ·
--   customer_meal_history_items 67908 · customer_order 20104 ·
--   fulfillment_day 527724 · legacy_meal_history_raw 4987 ·
--   migration_exception_review 1272 · package 9 · payment_record 11539 ·
--   product 1298 · sync_record 52423


-- ---------------------------------------------------------------------------
-- [EXECUTED] 2. Meal-history exceptions — open backlog by reason
-- ---------------------------------------------------------------------------
SELECT resolution_status, reason, count(*)
FROM customer_meal_history_exceptions
GROUP BY resolution_status, reason
ORDER BY 1, 2;
-- Result 2026-06-20: open | missing_order_link | 77   (no other rows)


-- ---------------------------------------------------------------------------
-- [EXECUTED] 3. Fulfillment-day delivery-outcome reality check
--             (expected: 100% 'scheduled' — no delivered/skipped/failed)
-- ---------------------------------------------------------------------------
SELECT status, count(*)
FROM fulfillment_day
GROUP BY status
ORDER BY 2 DESC;
-- Result 2026-06-20: scheduled | 527724   (single row — confirms no real outcome)


-- ---------------------------------------------------------------------------
-- [EXECUTED] 4. Distinct customers covered by last-90 meal history
-- ---------------------------------------------------------------------------
SELECT count(DISTINCT customer_id) AS distinct_meal_history_customers
FROM customer_meal_history
WHERE customer_id IS NOT NULL;
-- Result 2026-06-20: 2628


-- ---------------------------------------------------------------------------
-- [EXECUTED] 5. Confirm m23 dish-per-day tables are ABSENT on staging
--             (migration 0020 deliberately NOT applied — no dish data exists)
-- ---------------------------------------------------------------------------
SELECT to_regclass('public.customer_dish_day')      AS customer_dish_day,
       to_regclass('public.customer_dish_day_item') AS customer_dish_day_item,
       to_regclass('public.legacy_dish_detail_raw') AS legacy_dish_detail_raw;
-- Result 2026-06-20: NULL | NULL | NULL   (none of the m23 tables exist)


-- ---------------------------------------------------------------------------
-- [EXECUTED] 6. Migration version tracked in schema_migrations
-- ---------------------------------------------------------------------------
SELECT filename, applied_at
FROM schema_migrations
ORDER BY filename DESC
LIMIT 4;
-- Result 2026-06-20 (latest first):
--   0019_wave6_meal_history_exception_resolution.sql | 2026-06-17 11:29:30+00
--   0018_wave6_meal_history.sql                      | 2026-06-17 10:51:31+00
--   0017_wave6_ops_delivery.sql                      | 2026-06-17 10:51:31+00
--   0016_wave6_ops_packing.sql                       | 2026-06-17 10:51:31+00
-- => Staging head = 0019. 0020 not applied (as intended).


-- ---------------------------------------------------------------------------
-- [EXECUTED] 7. Base-table count (metadata)
-- ---------------------------------------------------------------------------
SELECT count(*) AS base_tables
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
-- Result 2026-06-20: 79  (77 non-audit + audit_event + audit_event_default)
-- Note: data_intelligence/00_baseline.md recorded 73 at commit 120ae5f; the
-- delta is a counting-method difference, not new data — every entity count
-- above matched the documented baseline exactly.


-- ===========================================================================
-- [PROPOSED] Extended verification — safe read-only checks NOT run this pass.
-- Run the same way (psql SELECT only) if deeper validation is wanted.
-- ===========================================================================

-- [PROPOSED] P1. Buyers vs non-buyers (drives Customer-360 / segmentation)
-- SELECT count(*) FILTER (WHERE o.customer_id IS NOT NULL) AS buyers,
--        count(*) FILTER (WHERE o.customer_id IS NULL)     AS non_buyers
-- FROM customer c
-- LEFT JOIN (SELECT DISTINCT customer_id FROM customer_order) o
--        ON o.customer_id = c.id;

-- [PROPOSED] P2. Order status distribution
-- SELECT status, count(*) FROM customer_order GROUP BY status ORDER BY 2 DESC;

-- [PROPOSED] P3. Payment paid/unpaid split
-- SELECT status, count(*) FROM payment_record GROUP BY status ORDER BY 2 DESC;

-- [PROPOSED] P4. Package demand (orders per package)
-- SELECT package_id, count(*) FROM customer_order GROUP BY package_id ORDER BY 2 DESC;

-- [PROPOSED] P5. migration_exception_review backlog by reason
-- SELECT reason, review_status, count(*) FROM migration_exception_review
-- GROUP BY reason, review_status ORDER BY 3 DESC;

-- [PROPOSED] P6. Confirm dish content columns remain empty on meal-history items
-- SELECT count(*) FILTER (WHERE meal_name IS NOT NULL) AS with_meal_name,
--        count(*) FILTER (WHERE meal_ref  IS NOT NULL) AS with_meal_ref,
--        count(*) FILTER (WHERE meal_type IS NOT NULL) AS with_meal_type
-- FROM customer_meal_history_items;
