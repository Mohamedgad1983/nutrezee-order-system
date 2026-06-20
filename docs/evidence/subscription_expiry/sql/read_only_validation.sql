-- ============================================================================
-- Subscription Expiry — Read-Only Validation
-- ----------------------------------------------------------------------------
-- Target : staging only — docker `nutrezee-postgres-1`, db `nutrezee`, user `nutrezee`.
--          Connect: docker exec -i nutrezee-postgres-1 psql -U nutrezee -d nutrezee
-- Safety : Section 1 is SELECT-only (run after the views are applied). Section 2
--          is the EXACT block executed on 2026-06-20 — it creates the views inside
--          a transaction and ROLLS BACK, leaving the database byte-for-byte unchanged
--          (used to validate the DDL + counts without persisting anything).
-- Business date anchor: (now() AT TIME ZONE 'Asia/Kuwait')::date  (Kuwait = UTC+3, no DST)
-- ============================================================================


-- ===========================================================================
-- SECTION 1 — Canonical validation (SELECT-only; requires analytics.* applied)
-- ===========================================================================

-- 1. Total customers
SELECT count(*) AS total_customers FROM customer;

-- 2. Customers WITH a subscription expiry vs WITHOUT fulfillment days
SELECT
  count(*) FILTER (WHERE current_order_id IS NOT NULL) AS customers_with_expiry,
  count(*) FILTER (WHERE current_order_id IS NULL)     AS customers_without_fulfillment_days
FROM analytics.customer_subscription_status;

-- 3. Customer-level status distribution (active / expiring_soon / expired / future / unknown)
SELECT subscription_status, count(*)
FROM analytics.customer_subscription_status
GROUP BY 1 ORDER BY 2 DESC;

-- 4. Headline counts
SELECT
  count(*) FILTER (WHERE subscription_status = 'active')        AS active,
  count(*) FILTER (WHERE subscription_status = 'expiring_soon') AS expiring_in_7_days,
  count(*) FILTER (WHERE subscription_status = 'expired')       AS expired,
  count(*) FILTER (WHERE subscription_status = 'future')        AS future,
  count(*) FILTER (WHERE subscription_status = 'unknown')       AS unknown
FROM analytics.customer_subscription_status;

-- 5. Order-level coverage: orders with a derived period vs all orders
SELECT
  (SELECT count(*) FROM analytics.order_subscription_periods) AS orders_with_periods,
  (SELECT count(DISTINCT order_id) FROM fulfillment_day)      AS distinct_orders_in_fulfillment_day,
  (SELECT count(*) FROM customer_order)                       AS total_orders;

-- 6. Integrity: null or inverted date ranges (expect 0 / 0)
SELECT
  count(*) FILTER (WHERE subscription_start_date IS NULL OR subscription_expire_date IS NULL) AS null_dates,
  count(*) FILTER (WHERE subscription_start_date > subscription_expire_date)                  AS start_after_expire
FROM analytics.order_subscription_periods;

-- 7. Multiplicity: customers with >1 active subscription period
SELECT count(*) AS customers_multi_active
FROM analytics.customer_subscription_status
WHERE active_subscription_count > 1;

-- 8. Cancelled/rejected influence on non-expired picks (source_confidence='low')
SELECT subscription_status, source_confidence, count(*)
FROM analytics.customer_subscription_status
WHERE subscription_status IN ('active','expiring_soon','future')
GROUP BY 1,2 ORDER BY 1,3 DESC;

-- 9. Top 20 masked examples (customer_id surrogate only — NO PII)
SELECT customer_id, subscription_status, subscription_start_date,
       subscription_expire_date, days_remaining, source_confidence
FROM analytics.customer_subscription_status
WHERE current_order_id IS NOT NULL
ORDER BY subscription_expire_date DESC, customer_id
LIMIT 20;


-- ===========================================================================
-- SECTION 2 — Exactly what was executed 2026-06-20 (self-contained, net-zero).
--   Creates the views in a transaction, validates, and ROLLS BACK.
--   Run as:  docker exec -i nutrezee-postgres-1 psql -U nutrezee -d nutrezee \
--              -v ON_ERROR_STOP=1 -f read_only_validation.sql   (this section)
-- ===========================================================================
BEGIN;
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE OR REPLACE VIEW analytics.order_subscription_periods AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS d),
fd AS (
  SELECT order_id, MIN(date) AS subscription_start_date, MAX(date) AS subscription_expire_date, COUNT(*) AS scheduled_day_count
  FROM fulfillment_day GROUP BY order_id
)
SELECT co.customer_id, co.id AS order_id, co.package_id,
  COALESCE(co.package_name_frozen_en, p.name_en) AS package_name,
  co.status AS order_status,
  fd.subscription_start_date, fd.subscription_expire_date, fd.scheduled_day_count,
  (fd.subscription_expire_date - t.d) AS days_remaining,
  (fd.subscription_expire_date < t.d) AS is_expired,
  (t.d BETWEEN fd.subscription_start_date AND fd.subscription_expire_date) AS is_active_today,
  (fd.subscription_start_date > t.d) AS is_future,
  CASE WHEN co.status IN ('cancelled','rejected') THEN 'low' ELSE 'high' END AS source_confidence,
  now() AS calculated_at
FROM customer_order co
JOIN fd ON fd.order_id = co.id
LEFT JOIN package p ON p.id = co.package_id
CROSS JOIN today t;

CREATE OR REPLACE VIEW analytics.customer_subscription_status AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS d),
pick AS (
  SELECT DISTINCT ON (osp.customer_id) osp.customer_id, osp.order_id, osp.package_id, osp.package_name,
    osp.order_status, osp.subscription_start_date, osp.subscription_expire_date, osp.scheduled_day_count,
    osp.days_remaining, osp.source_confidence
  FROM analytics.order_subscription_periods osp
  JOIN customer_order co ON co.id = osp.order_id
  ORDER BY osp.customer_id, osp.subscription_expire_date DESC, co.created_at DESC NULLS LAST, osp.order_id DESC
),
agg AS (
  SELECT customer_id, COUNT(*) FILTER (WHERE is_active_today) AS active_subscription_count,
    MAX(subscription_expire_date) AS latest_order_expire_date
  FROM analytics.order_subscription_periods GROUP BY customer_id
)
SELECT c.id AS customer_id, pk.order_id AS current_order_id, pk.package_id AS current_package_id,
  pk.package_name AS current_package_name, pk.subscription_start_date, pk.subscription_expire_date,
  pk.scheduled_day_count, pk.days_remaining,
  CASE
    WHEN pk.order_id IS NULL THEN 'unknown'
    WHEN pk.subscription_start_date > t.d THEN 'future'
    WHEN t.d BETWEEN pk.subscription_start_date AND pk.subscription_expire_date AND pk.days_remaining BETWEEN 0 AND 7 THEN 'expiring_soon'
    WHEN t.d BETWEEN pk.subscription_start_date AND pk.subscription_expire_date THEN 'active'
    WHEN pk.subscription_expire_date < t.d THEN 'expired'
    ELSE 'unknown'
  END AS subscription_status,
  (pk.subscription_expire_date < t.d) AS is_expired,
  (t.d BETWEEN pk.subscription_start_date AND pk.subscription_expire_date AND pk.days_remaining BETWEEN 0 AND 7) AS is_expiring_soon,
  COALESCE(ag.active_subscription_count, 0) AS active_subscription_count,
  pk.order_id AS latest_order_id, ag.latest_order_expire_date,
  COALESCE(pk.source_confidence, 'none') AS source_confidence, now() AS calculated_at
FROM customer c CROSS JOIN today t
LEFT JOIN pick pk ON pk.customer_id = c.id
LEFT JOIN agg ag ON ag.customer_id = c.id;

-- run Section-1 queries here against the in-transaction views, then:
ROLLBACK;   -- nothing persists; staging unchanged
