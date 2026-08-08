# 07 — Feature Store / Analytics Model Design (PROPOSAL — not implemented)

> Designs only. **No DDL was executed.** Each feature is read-only-derivable from existing reliable
> tables. Money stays in minor units; PII is referenced by id, never materialized into reports.
> Recommend a dedicated `analytics` schema (or `*_v` views) so nothing touches operational tables.

## Conventions
- Build as **views** first (always-fresh, zero storage). Promote to **materialized views** only where
  scan cost matters (the `fulfillment_day`-heavy ones). Refresh nightly via a gated job (no customer
  side effects).
- Privacy class: **P0** safe-aggregate · **P1** internal masked (staff role) · **P2** PII (never export).

### 1. `customer_features` (P1)
- **source:** `customer`, `customer_order`, `payment_record`, `fulfillment_day`.
- **logic:** per customer → orders_count, first/last order dates, lifetime_value (Σ paid amount),
  distinct_packages, top_package_tier, total_meal_days, days_since_last_end, paid_ratio.
- **cadence:** nightly. **type:** materialized view. **use:** Customer 360, segmentation, churn.
```sql
-- pseudo
SELECT co.customer_id,
       count(*)                                   AS orders_count,
       min(co.start_date)                         AS first_order,
       max(co.end_date)                           AS last_end,
       (CURRENT_DATE - max(co.end_date))          AS days_since_last_end,
       count(DISTINCT co.package_name_frozen_en)  AS distinct_packages,
       mode() WITHIN GROUP (ORDER BY co.package_name_frozen_en) AS top_package_tier,
       sum(co.total) FILTER (WHERE co.total>0)    AS lifetime_value_minor
FROM customer_order co GROUP BY 1;
```

### 2. `customer_recency_frequency` (P0/P1)
- **source:** `customer_features`. **logic:** R = days_since_last_end; F = orders_count; M =
  lifetime_value; assign RFM quintiles + segment label. **type:** view. **use:** segmentation, churn,
  win-back targeting.

### 3. `customer_meal_preferences` (P1 — **limited**)
- **source:** `customer_order` (package tier), `fulfillment_day` (weekday cadence).
- **logic:** top_package_tier, avg_plan_length, typical_days_per_week (from fulfillment dates),
  weekday_distribution. **Explicitly NOT dish-level** (content absent). **type:** view. **use:** Level-1
  plan suggestion, renewal. **note:** rename honestly — this is *plan* preference, not *meal* preference.

### 4. `meal_type_popularity` / demand (P0 — **tier/area level**)
- **source:** `fulfillment_day` × `customer_order` (package, area). **logic:** count meal-days by
  (date, package_tier, area). **NOT** dish/meal-type (only Lunch/Dinner exist; content null).
  **type:** materialized view. **use:** Menu Intelligence, kitchen forecast input.

### 5. `package_behavior_summary` (P0)
- **source:** `customer_order`. **logic:** per package tier → orders, distinct_customers, repeat_rate,
  avg_total, area_mix, month trend. **type:** materialized view. **use:** package recommendation, menu
  intelligence.

### 6. `customer_exception_flags` (P1)
- **source:** `customer_meal_history_exceptions`, `migration_exception_review`, `payment_record`.
- **logic:** per customer/order → open meal-history exceptions, MER reason, unpaid flag. **type:** view.
  **use:** Exception Repair Assistant, Customer 360 data-quality badge.

### 7. `recommendation_candidates` (P1)
- **source:** `customer_features` + `package_behavior_summary`. **logic:** for active/lapsed customers,
  candidate next package tier = own top tier ⊕ same-area/same-tier popularity; score + reason string.
  **type:** view. **use:** package recommendation, renewal nudges (staff-reviewed, not auto-sent).

### 8. `menu_demand_forecast_input` (P0)
- **source:** `fulfillment_day` (2024–2026) × package tier × area. **logic:** daily meal-day counts as a
  time series with calendar features (weekday, month, Ramadan/holiday flag — externally supplied).
  **type:** materialized view. **use:** Kitchen Forecasting model input.

## What is intentionally **absent** from the feature store
No `dish_features`, `nutrition_features`, `allergy_profile`, `feedback_features`, or
`delivery_quality_features` — the source data does not exist (doc 09). Adding empty placeholders would
imply capability we don't have; they enter the store only when capture begins.
</content>
