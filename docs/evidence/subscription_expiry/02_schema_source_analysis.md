# 02 — Schema Source Analysis

**Date:** 2026-06-20 · **Method:** read-only inspection of migration DDL (`app/db/migrations/`) + read-only DB verification on staging (`nutrezee-postgres-1`). No destructive queries.

---

## Tables & columns used

### `fulfillment_day` — source of truth (created in `0008_wave4_orders.sql`)

| Column | Type | Used for |
|---|---|---|
| `id` | text PK | — |
| `order_id` | text → `customer_order(id)` | join to order/customer |
| **`date`** | **date NOT NULL** | **the service/meal date — MIN/MAX drive start/expire** |
| `status` | text, default `scheduled` | carried for context; **100% `scheduled`** (no outcome) |
| `slot_id`, `address_frozen`, `reschedule_link_id`, `reason_code_id` | — | not used |
| `UNIQUE(order_id, date)` | — | guarantees one schedule row per (order, day) |

- **Date column confirmed:** `fulfillment_day.date` (a `date`, not a timestamp). There is no separate "meal date" column — `date` *is* the scheduled service/meal day.
- `status` CHECK allows `scheduled … delivered, failed, skipped, …`, but **every row is `scheduled`** (DB-verified 527,724/527,724) — so no delivery-outcome filtering is possible or attempted.

### `customer_order` — order ↔ customer ↔ package (created in `0008_wave4_orders.sql`)

| Column | Type | Used for |
|---|---|---|
| `id` | text PK | order_id |
| `customer_id` | text → `customer(id)` NOT NULL | customer grain |
| `package_id` | text → `package(id)` (nullable) | `current_package_id` |
| `package_name_frozen_en` | text (nullable) | `package_name` (preferred — order-time frozen name) |
| `status` | text CHECK (9 values) | `order_status` + `source_confidence` flag |
| `start_date`, `end_date` | date | **NOT used** (these are legacy order-level dates; rule mandates fulfillment-day derivation) |
| `created_at` | timestamptz | tie-breaker only |

- **Customer/order relationship:** `fulfillment_day.order_id → customer_order.id`, and `customer_order.customer_id → customer.id`. Indexed via `customer_order_customer (customer_id)` and the `UNIQUE(order_id,date)` on fulfillment_day.
- **Order status fields:** `status` exists (enum above). Used non-exclusively (see [01](01_business_rule.md)).

### `package` — name fallback (created in `0004_wave2_catalog.sql`)

| Column | Used for |
|---|---|
| `id` | join key |
| `name_en` | fallback for `package_name` when the order's frozen name is null |
| `duration_days`, `meals_per_day` | **not used** for expiry (we use actual scheduled days) |

- `package_name = COALESCE(customer_order.package_name_frozen_en, package.name_en)`.

### `customer` — grain anchor (created in `0003_wave2_masters_customers.sql`)

- Only `customer.id` (surrogate text PK) is used, to produce one row per customer including those with **no** orders/fulfillment days. **No PII columns** (`full_name_en`, phones, addresses) are read by these views.

### `payment_record` — supporting context only (created in `0010_wave4_payments.sql`)

- **Not used** in expiry derivation (payment date is explicitly excluded as an expiry source). Noted here only to confirm it was considered and deliberately not joined.

---

## Relationship map (used)

```
customer (id)
  └─< customer_order (id, customer_id, package_id, status, package_name_frozen_en, created_at)
        ├─ package (id, name_en)                         [LEFT JOIN, name fallback]
        └─< fulfillment_day (order_id, date, status)     [MIN/MAX date = period]
```

## DB-verified facts (this run, 2026-06-20, read-only)

- Every order has scheduled days: `count(DISTINCT order_id) in fulfillment_day` = `count(customer_order)` = **20,104**.
- `fulfillment_day.date` is never null; **0** orders had `MIN(date) > MAX(date)` (logically impossible, confirmed).
- `fulfillment_day.status` distribution = `scheduled` only (single group, 527,724).

## Migration numbering

- Applied chain locally: `0001 … 0019` (staging head = **0019**), `0020_wave7_dish_per_day.sql` exists but is **not applied to staging** (deliberate — no dish data).
- This work adds **`0021_analytics_subscription_expiry.sql`** — the next free number. **No conflict with 0020.** 0020 is not overwritten or modified.
