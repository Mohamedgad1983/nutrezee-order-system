# 03 — View Design

**Date:** 2026-06-20 · **Migration:** [`app/db/migrations/0021_analytics_subscription_expiry.sql`](../../../app/db/migrations/0021_analytics_subscription_expiry.sql) · **Schema:** `analytics` (new, read-only).

Two additive views. Both are plain (non-materialized) `VIEW`s over the trusted backbone; they compute on read, hold no storage, and are droppable with zero business impact. Idempotent DDL (`CREATE SCHEMA IF NOT EXISTS`, `CREATE OR REPLACE VIEW`).

---

## View 1 — `analytics.order_subscription_periods`

**Grain:** one row per order that has ≥1 scheduled `fulfillment_day`.

| Field | Definition |
|---|---|
| `customer_id` | `customer_order.customer_id` |
| `order_id` | `customer_order.id` |
| `package_id` | `customer_order.package_id` (nullable) |
| `package_name` | `COALESCE(customer_order.package_name_frozen_en, package.name_en)` |
| `order_status` | `customer_order.status` |
| `subscription_start_date` | `MIN(fulfillment_day.date)` for the order |
| `subscription_expire_date` | `MAX(fulfillment_day.date)` for the order |
| `scheduled_day_count` | `COUNT(*)` of fulfillment_day rows for the order |
| `days_remaining` | `subscription_expire_date − today` (signed; `<0` = expired N days ago) |
| `is_expired` | `subscription_expire_date < today` |
| `is_active_today` | `today BETWEEN start AND expire` |
| `is_future` | `start > today` |
| `source_confidence` | `'low'` if `order_status ∈ {cancelled, rejected}`, else `'high'` |
| `calculated_at` | `now()` |

`today = (now() AT TIME ZONE 'Asia/Kuwait')::date`.

**Notes:** derived purely from `fulfillment_day` aggregates joined back to the order. Orders with no scheduled days are absent here (they surface as `unknown` at the customer level).

---

## View 2 — `analytics.customer_subscription_status`

**Grain:** one row per customer (all customers, including those with no scheduled days → `unknown`).

| Field | Definition |
|---|---|
| `customer_id` | `customer.id` |
| `current_order_id` | order with the latest expire date (the "pick"); null if none |
| `current_package_id` | pick's `package_id` |
| `current_package_name` | pick's `package_name` |
| `subscription_start_date` | pick's start |
| `subscription_expire_date` | pick's expire |
| `scheduled_day_count` | pick's scheduled-day count |
| `days_remaining` | pick's signed days_remaining |
| `subscription_status` | `active` / `expiring_soon` / `expired` / `future` / `unknown` (logic below) |
| `is_expired` | pick expire `< today` |
| `is_expiring_soon` | active **and** `days_remaining BETWEEN 0 AND 7` |
| `active_subscription_count` | count of the customer's periods that are active today (can be >1) |
| `latest_order_id` | = `current_order_id` (selected by latest expire) |
| `latest_order_expire_date` | `MAX(expire)` across the customer's periods |
| `source_confidence` | pick's confidence; `'none'` when the customer has no scheduled days |
| `calculated_at` | `now()` |

### Status logic

| Status | Condition |
|---|---|
| `unknown` | no fulfillment_day-derived period for the customer |
| `future` | `subscription_start_date > today` |
| `expiring_soon` | active **and** `days_remaining BETWEEN 0 AND 7` |
| `active` | `today BETWEEN start AND expire` (and not expiring_soon) |
| `expired` | `subscription_expire_date < today` |

### Pick selection (current/latest subscription)

`DISTINCT ON (customer_id)` ordered by `subscription_expire_date DESC, customer_order.created_at DESC NULLS LAST, order_id DESC`. **No status exclusion** (business rule: do not over-filter). The `source_confidence` flag and `active_subscription_count` let consumers detect when the pick is a `cancelled`/`rejected` order or when multiple active periods exist.

---

## Design choices & rationale

- **Plain views, not materialized:** zero storage, always current, trivially droppable. If query cost becomes a concern, promote View 1 to a materialized view + manual idempotent refresh (no timer) — see [06](06_limitations_and_next_steps.md).
- **No status exclusion:** honors the instruction to avoid over-filtering; visibility preserved via `source_confidence` + `order_status` + `active_subscription_count`.
- **`days_remaining` is signed:** negative communicates "expired N days ago" — useful for win-back without a second field.
- **Package name from the frozen order column:** reflects what the customer actually ordered at the time, with the live `package.name_en` as fallback.
- **No PII:** views select only surrogate ids, dates, counts, and status labels.
- **Additive & forward-only:** new schema + views only; no business table is altered, read-mutated, or dropped.

The exact DDL is in the migration file; this run **applied it inside a transaction on staging and rolled back** to prove it compiles against the live schema — see [04](04_validation_report.md).
