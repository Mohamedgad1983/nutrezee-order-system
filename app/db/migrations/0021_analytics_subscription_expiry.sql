-- 0021_analytics_subscription_expiry.sql
-- ----------------------------------------------------------------------------
-- ADDITIVE, READ-ONLY analytics layer: subscription expiry derived from the
-- scheduled service/meal days in `fulfillment_day` (the source of truth for the
-- subscription service period). Forward-only (DEC-011).
--
-- Business rule (see docs/evidence/subscription_expiry/01_business_rule.md):
--   * subscription_start_date  = MIN(fulfillment_day.date) per order
--   * subscription_expire_date = MAX(fulfillment_day.date) per order
--   * customer's current/latest subscription = the order with the LATEST
--     subscription_expire_date (no status exclusion — see tie-breaker below).
--   * Expiry = entitlement/service-schedule expiry, NOT confirmed delivery
--     completion (delivery outcome is not captured — fulfillment_day.status is
--     uniformly 'scheduled'). Payment date / order created date / package name /
--     dish data are NOT used.
--
-- "Today" anchor: (now() AT TIME ZONE 'Asia/Kuwait')::date — Kuwait is UTC+3
--   year-round (no DST), so the business date is deterministic regardless of the
--   database server's session timezone.
--
-- Safety: creates only a new `analytics` schema and two VIEWS. No business table
--   is read-mutated, altered, or dropped. Idempotent (IF NOT EXISTS / OR REPLACE).
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA analytics IS
  'Read-only derived analytics (views/matviews). No business writes. Droppable with zero business impact.';

-- ---------------------------------------------------------------------------
-- View 1 — analytics.order_subscription_periods  (grain: one row per order
--          that has at least one scheduled fulfillment_day)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.order_subscription_periods AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS d
),
fd AS (
  SELECT
    order_id,
    MIN(date) AS subscription_start_date,
    MAX(date) AS subscription_expire_date,
    COUNT(*)  AS scheduled_day_count
  FROM fulfillment_day
  GROUP BY order_id
)
SELECT
  co.customer_id,
  co.id                                   AS order_id,
  co.package_id,
  COALESCE(co.package_name_frozen_en, p.name_en) AS package_name,
  co.status                               AS order_status,
  fd.subscription_start_date,
  fd.subscription_expire_date,
  fd.scheduled_day_count,
  (fd.subscription_expire_date - t.d)     AS days_remaining,  -- signed: <0 means expired N days ago
  (fd.subscription_expire_date <  t.d)    AS is_expired,
  (t.d BETWEEN fd.subscription_start_date AND fd.subscription_expire_date) AS is_active_today,
  (fd.subscription_start_date >  t.d)     AS is_future,
  -- source_confidence: all periods derive from fulfillment_day (high); orders in
  -- a cancelled/rejected state still carry a schedule but the entitlement is
  -- questionable, so they are flagged 'low' rather than excluded (no over-filter).
  CASE
    WHEN co.status IN ('cancelled','rejected') THEN 'low'
    ELSE 'high'
  END                                     AS source_confidence,
  now()                                   AS calculated_at
FROM customer_order co
JOIN fd        ON fd.order_id = co.id
LEFT JOIN package p ON p.id = co.package_id
CROSS JOIN today t;

COMMENT ON VIEW analytics.order_subscription_periods IS
  'One row per order with >=1 scheduled fulfillment_day. start=MIN(date), expire=MAX(date). '
  'Expiry is service-schedule entitlement, not delivery completion. Read-only.';

-- ---------------------------------------------------------------------------
-- View 2 — analytics.customer_subscription_status  (grain: one row per customer;
--          customers with no scheduled days appear with status 'unknown')
--
-- Current/latest subscription selection: the order with the LATEST
--   subscription_expire_date. Tie-breaker (documented): expire_date DESC,
--   then customer_order.created_at DESC NULLS LAST, then order_id DESC.
--   No status exclusion (per business rule: do not over-filter). A cancelled/
--   rejected order with future scheduled days can therefore be selected — this
--   is surfaced via source_confidence='low' and active_subscription_count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.customer_subscription_status AS
WITH today AS (
  SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS d
),
pick AS (  -- latest subscription period per customer, with tie-breaker
  SELECT DISTINCT ON (osp.customer_id)
    osp.customer_id,
    osp.order_id,
    osp.package_id,
    osp.package_name,
    osp.order_status,
    osp.subscription_start_date,
    osp.subscription_expire_date,
    osp.scheduled_day_count,
    osp.days_remaining,
    osp.source_confidence
  FROM analytics.order_subscription_periods osp
  JOIN customer_order co ON co.id = osp.order_id
  ORDER BY osp.customer_id,
           osp.subscription_expire_date DESC,
           co.created_at DESC NULLS LAST,
           osp.order_id DESC
),
agg AS (  -- per-customer aggregates across ALL their subscription periods
  SELECT
    customer_id,
    COUNT(*) FILTER (WHERE is_active_today)        AS active_subscription_count,
    MAX(subscription_expire_date)                  AS latest_order_expire_date
  FROM analytics.order_subscription_periods
  GROUP BY customer_id
)
SELECT
  c.id                                    AS customer_id,
  pk.order_id                             AS current_order_id,
  pk.package_id                           AS current_package_id,
  pk.package_name                         AS current_package_name,
  pk.subscription_start_date,
  pk.subscription_expire_date,
  pk.scheduled_day_count,
  pk.days_remaining,
  CASE
    WHEN pk.order_id IS NULL                                   THEN 'unknown'
    WHEN pk.subscription_start_date > t.d                      THEN 'future'
    WHEN t.d BETWEEN pk.subscription_start_date AND pk.subscription_expire_date
         AND pk.days_remaining BETWEEN 0 AND 7                 THEN 'expiring_soon'
    WHEN t.d BETWEEN pk.subscription_start_date AND pk.subscription_expire_date
                                                               THEN 'active'
    WHEN pk.subscription_expire_date < t.d                     THEN 'expired'
    ELSE 'unknown'
  END                                     AS subscription_status,
  (pk.subscription_expire_date < t.d)     AS is_expired,
  (t.d BETWEEN pk.subscription_start_date AND pk.subscription_expire_date
       AND pk.days_remaining BETWEEN 0 AND 7) AS is_expiring_soon,
  COALESCE(ag.active_subscription_count, 0) AS active_subscription_count,
  pk.order_id                             AS latest_order_id,            -- == current (selected by latest expire)
  ag.latest_order_expire_date,
  COALESCE(pk.source_confidence, 'none')  AS source_confidence,          -- 'none' when no scheduled days
  now()                                   AS calculated_at
FROM customer c
CROSS JOIN today t
LEFT JOIN pick pk ON pk.customer_id = c.id
LEFT JOIN agg  ag ON ag.customer_id = c.id;

COMMENT ON VIEW analytics.customer_subscription_status IS
  'One row per customer. Current/latest subscription = order with latest expire date '
  '(no status exclusion; cancelled/rejected flagged via source_confidence). '
  'status: active|expiring_soon|expired|future|unknown. Read-only; no PII.';
