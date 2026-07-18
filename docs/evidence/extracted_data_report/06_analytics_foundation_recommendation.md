# 06 — Analytics Foundation Recommendation

**Date:** 2026-06-20 · **Status: `RECOMMENDED` (design only — do NOT implement unless explicitly asked).**
This document is a self-contained blueprint sufficient to drive a later execution prompt. It proposes a **read-only `analytics` schema** of views/materializations over the already-trusted, DB-verified backbone. Nothing here is applied; it adds no tables to staging in this pass.

> **Design principles (binding):** read-only (views or refreshable matviews, never writes to business tables); **PII masked at the boundary**; money in minor units; bilingual-safe labels; no dependence on missing data (no dish/nutrition/allergy/feedback/outcome columns); every view validated against the documented baseline before use.

---

## Proposed schema overview

| View | Grain | Primary purpose | Refresh |
|---|---|---|---|
| `analytics.customer_features` | 1 row / customer | Customer 360 + segmentation + churn base | Nightly matview |
| `analytics.package_behavior_summary` | 1 row / package | Package/tier demand & recommendation base | Nightly matview |
| `analytics.customer_meal_cadence` | 1 row / customer | Renewal timing, kitchen forecast input | Nightly matview |
| `analytics.customer_churn_signals` | 1 row / customer | Churn/win-back scoring | Nightly matview |
| `analytics.data_quality_flags` | 1 row / customer (or order) | Trust/exception surfacing | Nightly view |

All five derive **only** from: `customer`, `customer_order`, `payment_record`, `fulfillment_day`, `package`, `address`, `area`, and the exception tables (`migration_exception_review`, `customer_meal_history_exceptions`).

---

## 1. `analytics.customer_features`

- **Business purpose:** the single per-customer feature row powering Customer 360, segmentation, and churn.
- **Source tables:** `customer`, `customer_order`, `payment_record`, `fulfillment_day`, `address`→`area`.
- **Grain:** one row per `customer.id`.
- **Suggested fields:** `customer_id` (surrogate), `is_buyer`, `orders_count`, `first_order_at`, `last_order_end_at`, `lifetime_value_minor`, `avg_order_value_minor`, `distinct_packages`, `dominant_package_id`, `paid_orders`, `unpaid_orders`, `paid_ratio`, `total_plan_days` (from fulfillment_day), `area_id`, `recency_days`, `tenure_days`, `language`. **No** name/email/phone/address text — PII masked/omitted.
- **PII handling:** expose only a non-reversible `customer_id` and aggregates; names/contacts stay out of the analytics layer entirely.
- **Validation checks:** `count(*) = customer count` (19,476 DB-verified); `is_buyer = true` count ≈ documented buyers (~7,903); `sum(lifetime_value_minor)` sanity vs payments.
- **Acceptance:** row count matches `customer`; buyer/non-buyer split within ±1% of `data_intelligence/04`; zero PII columns present.

## 2. `analytics.package_behavior_summary`

- **Business purpose:** demand and repeat behavior per package tier → package recommendation + menu intelligence.
- **Source tables:** `customer_order`, `package`, `payment_record`, `address`→`area`.
- **Grain:** one row per `package.id`.
- **Suggested fields:** `package_id`, `package_label`, `orders_count`, `distinct_customers`, `repeat_customer_rate`, `avg_order_value_minor`, `paid_ratio`, `top_areas` (array of area_id), `orders_trend_90d`.
- **PII handling:** fully aggregate (P0) — no customer detail.
- **Validation checks:** `sum(orders_count)` ≈ `customer_order` total (20,104 DB-verified, allowing for null-package orders ~302); demand ranking matches `data_intelligence/04`.
- **Acceptance:** order totals reconcile to within the documented null-package count; top tier ≈ ~48% of orders.

## 3. `analytics.customer_meal_cadence`

- **Business purpose:** per-customer cadence (weekly pattern, avg plan length, gaps) for renewal timing and as kitchen-forecast input. **Cadence only — no dish content.**
- **Source tables:** `fulfillment_day` (527,724 rows DB-verified), `customer_order`.
- **Grain:** one row per `customer.id` (aggregated across their orders).
- **Suggested fields:** `customer_id`, `total_plan_days`, `avg_plan_length_days`, `weekday_distribution` (jsonb 7-bucket), `active_weeks`, `longest_gap_days`, `last_plan_day`.
- **PII handling:** P1 internal; customer surrogate only.
- **Validation checks:** `sum(total_plan_days)` = `count(fulfillment_day)` (527,724); per-customer day counts reconcile with `data_intelligence/04` depth buckets.
- **Acceptance:** total plan-days equals the DB-verified `fulfillment_day` count exactly.

## 4. `analytics.customer_churn_signals`

- **Business purpose:** churn/win-back scoring and segment labels.
- **Source tables:** `analytics.customer_features` (+ underlying `customer_order`, `payment_record`).
- **Grain:** one row per `customer.id`.
- **Suggested fields:** `customer_id`, `recency_bucket` (active / lapsed_0_1m / 1_3m / 3_6m / 6_12m / 12m_plus), `frequency_tier`, `value_tier`, `rfm_segment`, `has_unpaid`, `win_back_priority` (derived), `is_active_now`.
- **PII handling:** P1 internal; surrogate only.
- **Validation checks:** recency bucket sizes reconcile with `data_intelligence/04` (e.g. active ~1,027; lapsed 0–3m ~1,602).
- **Acceptance:** segment sizes within ±1% of documented cohorts; no customer in two mutually exclusive buckets.

## 5. `analytics.data_quality_flags`

- **Business purpose:** surface trust/exception state so analytics consumers never silently treat partial data as complete.
- **Source tables:** `migration_exception_review` (1,272 DB-verified), `customer_meal_history_exceptions` (77 open DB-verified), `payment_record`, `customer_order`.
- **Grain:** one row per `customer.id` (or per order for order-level flags).
- **Suggested fields:** `customer_id`, `has_mer_flag`, `mer_reason`, `has_open_meal_exception`, `has_unpaid_order`, `missing_address`, `placeholder_phone_risk`.
- **PII handling:** P1 internal; flags only, no raw phone/name.
- **Validation checks:** flagged MER count = 1,272; open meal-exception customers map to the 40 distinct legacy orders / 77 exceptions.
- **Acceptance:** flag totals reconcile exactly with DB-verified exception counts.

---

## What this foundation deliberately EXCLUDES

No `dish_features`, `nutrition_features`, `allergy_profile`, `feedback_features`, or `delivery_quality_features`. Those source columns do not exist (DB-verified: `fulfillment_day` 100% `scheduled`; dish tables absent). Adding empty placeholders would imply capability Nutrezee does not have — they enter the analytics layer **only when forward capture begins** *(`data_intelligence/07`)*.

---

## Cross-cutting acceptance criteria (all five views)

1. **Read-only:** defined as views/matviews in a dedicated `analytics` schema; no writes to any business table; no GET-side mutation.
2. **Reconciliation gate:** each view's row count / key aggregate must match the **DB-verified baseline** in [02_data_inventory.md](02_data_inventory.md) and the documented cohorts in `data_intelligence/03–04` before it is consumed.
3. **PII gate:** a column-level check confirms no name/email/phone/address text leaves the analytics layer; only surrogate ids + aggregates.
4. **Determinism:** refresh is idempotent — re-running yields identical rows for unchanged source data.
5. **No timers in this phase:** refresh is run manually or via the existing gated tooling; **no systemd timer / cron is enabled.**

> Implementation is intentionally out of scope here. This blueprint is the input to a future "Analytics Foundation" execution prompt — see [08_next_phase_execution_plan.md](08_next_phase_execution_plan.md).
