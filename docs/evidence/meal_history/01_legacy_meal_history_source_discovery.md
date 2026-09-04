# 01 — Legacy Customer Meal-History Source Discovery (m22)

> **Decision:** NO bridge. Meal history is transferred INTO PostgreSQL via a controlled raw-archive +
> clean-model path; the new admin never reads meal history live from legacy for display.
> **Scope of this run:** discovery + foundation only. No full-history import, no scheduled sync.

## 1. Where legacy meal history lives

| Aspect | Finding |
|---|---|
| **Primary source** | Legacy admin **ajax endpoint** `GET /orders/getMealsDateWiseFilter/all/<internal_id>` — a server-rendered **date-wise "Order Meals" grid** per order. |
| **Not a clean DB export** | There is no exposed meal-history table/CSV; the data is rendered HTML driven by the order id. |
| **Per-dish detail** | **Secondary-ajax-gated** (`getMeals`, `editMeal`, `deletemeal`, `deletemealproduct`). The static grid reliably yields meal **dates + meal types + legacy meal_ids**; the selected **dish names** load via further ajax and are *not* in the static capture. |
| **Captured artifacts (read-only, on VPS)** | `out/raw/meals_<internal_id>.html.gz` — lossless raw grid, **60-order sample** (extractor default `MEALS_SAMPLE`; `FETCH_MEALS=1` would force all). `out/order_detail.jsonl` — 20,637 orders with `.meals = {distinct_dates, meal_types}` coverage. |
| **Mutation endpoints on the page** | `editMeal` / `deletemeal` / `assignDriver` exist but are **never called** (extractor is GET-only allowlisted). |

## 2. Per-source documentation (required fields)

### Source A — `getMealsDateWiseFilter` grid (the meal-history source of record)
| Field | Value |
|---|---|
| source name/path | ajax `GET /orders/getMealsDateWiseFilter/all/<internal_id>` |
| record-count estimate | ~26,071 orders × per-order meal-days ≈ **hundreds of thousands** (~500k meal-day rows full); **60 orders captured** as raw sample now |
| date fields + format | meal dates as `YYYY-MM-DD` literals in the grid (`pickDate`, `pickDate1`, …) |
| customer identifier | **not in the grid**; resolved via order → customer (see relation) |
| order identifier | `internal_id` (legacy internal order id, e.g. 21274) — the URL key |
| package identifier | order's `package` / `subpackage` (from `orders_index`, not the grid) |
| meal identifier/name | legacy `meal_id` present (e.g. input `name="meal_id"`, JS `'meal_id':N`); **dish name ajax-gated → null for now** |
| meal date / delivery date | the grid's distinct dates = the plan's meal-days |
| status fields | order status from `orders_index`; per-meal status not reliably in static HTML |
| allergy/diet notes | `order_detail.view.has_allergy_block` (boolean signal); allergens live in `customer_allergy` already |
| duplicate risk | **medium** — same order re-extracted ⇒ same payload ⇒ dedup by `raw_sha`; same (order,date,type) ⇒ blocked by `cmh_items_no_dup_meal_day` |
| missing-link risk | **real** — `internal_id` ≠ the synced `order_number` watermark key; some orders won't map (28/60 in the sample) |
| safe for automated extraction? | **Yes for the skeleton** (dates/types/meal_ids) — GET-only, throttled, resumable. **No for full per-dish detail** (≈500k ajax calls; out of scope now) |

### Source B — `order_detail.jsonl` `.meals` coverage (already extracted)
| Field | Value |
|---|---|
| source | `out/order_detail.jsonl` (20,637 records) |
| shape | `{distinct_dates: int, meal_types: [..]}` per order — **coverage only, not per-day rows** |
| use | confirms meal-day counts/types; not sufficient alone (no actual dates) → raw grids are the source of truth |
| safe for automated extraction? | yes (already on disk, no PII beyond order linkage) |

### Source C — `orders_index.jsonl` (the order/customer relation)
| Field | Value |
|---|---|
| source | `out/orders_index.jsonl` (26,071 rows) |
| use | the **only** place that carries BOTH `internal_id` AND `order_number` → the bridge to map a meal grid's `internal_id` to a synced order |
| customer/order relation | `internal_id` → `order_number` (here) → `sync_record(object_type='order', legacy_key=order_number).new_ref` → `customer_order.id` → `customer_order.customer_id` |

## 3. Relationships (legacy → new)
```
meals grid (internal_id)
   └─ orders_index: internal_id → order_number
        └─ sync_record(order, legacy_key=order_number).new_ref → customer_order.id
             └─ customer_order.customer_id → customer.id
```
`internal_id` and `order_number` are **both preserved** in the clean model for traceability.

## 4. Risks
- **Missing order link** — meal grids for orders not in `sync_record` (sample: 28/60 meal-days). Routed to exceptions, never forced into clean tables.
- **Partial detail** — dish names are ajax-gated; clean items store date+type with `meal_name` NULL until a later detail phase.
- **Volume** — full per-dish extraction ≈ 500k requests → **out of scope now**; controlled date-windowed transfer first.
- **Duplicate** — handled by `raw_sha` (archive) + `(legacy_order_id, meal_date, meal_type)` unique (clean).

## 5. Conclusion
The meal-history source is the date-wise grid ajax. The automation-safe signal (dates/types/meal_ids +
order linkage) is sufficient to build the raw archive + clean model and run a **last-30-days dry-run**
(see docs 02–04). Full per-dish backfill stays out of scope until the windowed transfer is validated.
