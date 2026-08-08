# 02 — Data Inventory

**Date:** 2026-06-20 · **Source DB:** staging `nutrezee-postgres-1` (db `nutrezee`) · **Mode:** read-only.
**All "DB count" values below were freshly verified this run** via [sql/read_only_verification.sql](sql/read_only_verification.sql). Where a figure is documented-only or inferred, it is tagged.

**Schema head (DB-verified):** `0019_wave6_meal_history_exception_resolution.sql`, applied 2026-06-17. Migration `0020` (dish-per-day) **not applied**.
**Base tables (DB-verified):** 79 (77 non-audit + `audit_event` + `audit_event_default`). *Note:* `data_intelligence/00_baseline.md` recorded 73 at commit `120ae5f`; the 6-table delta is a counting-method difference — every entity count below matched the documented baseline exactly.

> Trust scale: **High** = extracted, imported, reconciled, DB-verified · **Medium** = present and verified but with a material content/coverage caveat · **Low** = present but unreliable/empty for analysis · **Blocked** = not available at source.

---

## Master inventory table (DB-verified this run)

| # | Entity | Table | DB count (2026-06-20) | Status | Trust | AI/analytics usability |
|---|---|---|---|---|---|---|
| 1 | Customers | `customer` | 19,476 | CONFIRMED | High | Identity, segmentation, contactability |
| 2 | Addresses | `address` | 9,511 | CONFIRMED | High (buyers) | Geo/area demand |
| 3 | Areas | `area` | 127 | CONFIRMED | High | Geographic analytics |
| 4 | Orders | `customer_order` | 20,104 | CONFIRMED | High | RFM, value, package behavior |
| 5 | Payments | `payment_record` | 11,539 | CONFIRMED | High (paid/unpaid) | Revenue, conversion, churn signal |
| 6 | Packages | `package` | 9 | CONFIRMED | High | Tier / diet-proxy analytics |
| 7 | Fulfillment days | `fulfillment_day` | 527,724 | CONFIRMED | High (cadence) | Cadence, kitchen volume forecast |
| 8 | Products | `product` | 1,298 | CONFIRMED | Medium | Menu master (names only) |
| 9 | Sync records | `sync_record` | 52,423 | CONFIRMED | High | Legacy↔new traceability |
| 10 | Meal-history parent | `customer_meal_history` | 4,955 | CONFIRMED | Medium | Last-90 cadence (dates only) |
| 11 | Meal-history items | `customer_meal_history_items` | 67,908 | CONFIRMED | Medium | Meal-day cadence (no dish) |
| 12 | Meal-history raw | `legacy_meal_history_raw` | 4,987 | CONFIRMED | High (lossless) | Replay/audit only |
| 13 | Meal-history exceptions (open) | `customer_meal_history_exceptions` | 77 (all `missing_order_link`) | PARTIAL | — | Repair queue, not analytics |
| 14 | Migration exceptions | `migration_exception_review` | 1,272 | CONFIRMED | — | Data-quality, manual review |
| 15 | Distinct meal-history customers | (derived) | 2,628 | CONFIRMED | Medium | Cadence cohort |
| 16 | Dish-per-day (m23) | `customer_dish_day*` | **absent** (0020 not applied) | BLOCKED | Blocked | None until forward capture |

---

## 1. Customers — `CONFIRMED` · Trust: High

- **Source/table:** legacy customer list → `customer` (migration `0003`). **DB count: 19,476** *(DB-verified)*.
- **Extraction/import:** 20,151 extracted; 19,379 created on first import; corrected to ~19,463 after exception recovery; current DB head **19,476** *(DB-verified)*. *(extract figure: `legacy_full_migration/extract_counts.json`; import: `09_import_results.md`, `19_exception_recovery.md`.)*
- **Business meaning:** the customer master — buyers + leads. ~40.6% are buyers (≥1 order); ~59% are non-buyer leads *(previously documented, `data_intelligence/04`)*.
- **Quality:** email ≈100%, phone ≈99.5%, DOB ≈71%; **`diet_status` empty**; **status uniform = all `active`** (no lifecycle signal); 1,272 MER duplicate/placeholder-phone cases. *(previously documented, `data_intelligence/03`)*
- **Limitations:** phone is **not** a safe identity key (shared/placeholder phones — never match customers by phone/name); ~51% of all customers have no address (mostly leads).
- **AI/analytics:** strong for segmentation, contactability, churn cohorts. **PII must be masked.**

## 2. Addresses & Areas — `CONFIRMED` · Trust: High (for buyers)

- **Tables:** `address` (**9,511**, DB-verified), `area` (**127**, DB-verified). 114 distinct areas appear in legacy delivery extraction *(documented, `delivery_extraction_summary.json`)*.
- **Business meaning:** geographic demand; top areas are concentrated *(documented, `data_intelligence/04`)*.
- **Limitations:** address coverage ≈49% of customers (buyers mostly); no legacy baseline to prove completeness (`mismatches.jsonl` MM-10 — coverage *unprovable*).
- **AI/analytics:** area-level demand, geo SLA targeting (no outcome data → no true SLA yet).

## 3. Orders — `CONFIRMED` (with reconciliation caveat) · Trust: High

- **Table:** `customer_order` (migration `0008`). **DB count: 20,104** *(DB-verified)*.
- **Extraction/import:** legacy source authoritative ≈20,637 distinct orders; 19,465 imported initially; 638 recovered via exception repair → 20,103/20,104 current. A **−1,172 historical shortfall** (mostly expired) is quantified, not closed (`mismatches.jsonl` MM-06). 1,732 order rows errored in the initial active-plans import and were not re-applied (MM-04). *(documented, `legacy_full_migration/13,19`.)*
- **Business meaning:** the analytic hub — subscription orders with package, dates, value, status, delivery method/time/area (frozen via migration `0014`).
- **Quality:** status mix dominated by expired/rejected; ~91% have value > 0; 99.9% have a delivery area; **`off_days` empty**; `order_item` (per-meal line items) **NOT migrated** (1 seed row only — MM-01, P0). *(documented, `data_intelligence/03`, `legacy_full_migration/09`.)*
- **Limitations:** no per-meal line items; historical-order completeness unverified.
- **AI/analytics:** excellent for RFM, value, package behavior, recency/churn.

## 4. Payments — `CONFIRMED` · Trust: High (paid/unpaid only)

- **Table:** `payment_record` (migration `0010`). **DB count: 11,539** *(DB-verified)*.
- **Business meaning:** paid vs unpaid per order (~9,993 paid / ~1,545 unpaid documented). ~57% of orders carry a payment row. *(documented, `data_intelligence/03,04`.)*
- **Limitations:** `method`/`transaction_ref` empty; no full-history baseline to reconcile (MM-07 *unprovable*).
- **AI/analytics:** revenue trends, conversion, churn signal (unpaid → risk).

## 5. Packages — `CONFIRMED` · Trust: High

- **Table:** `package` (migration `0004`). **DB count: 9** (7 legacy + 2 demo seed; ≈5 in real use). *(DB-verified count; composition documented, `legacy_full_migration/09`.)*
- **Business meaning:** calorie/macro **tiers** — the only usable proxy for diet/nutrition today; one tier ≈ half of all orders. *(documented, `data_intelligence/04`.)*
- **AI/analytics:** tier-level recommendation, demand intelligence, diet proxy.

## 6. Fulfillment days / schedule — `CONFIRMED` · Trust: High (cadence) / `BLOCKED` (outcome)

- **Table:** `fulfillment_day` (migration `0014`). **DB count: 527,724** *(DB-verified)*.
- **Business meaning:** the **cadence spine** — one row per (order, date) across 2023–2027, avg ~26 days/order; full 2024–2026 history.
- **Critical limitation:** **status is 100% `scheduled`** *(DB-verified this run — single status group, 527,724/527,724)*. **No delivered/skipped/failed/rescheduled outcome exists.** `reschedule_link`/`reason_code` empty.
- **AI/analytics:** strong for cadence modelling and **kitchen volume forecasting**; **blocked** for delivery-quality analytics.

## 7. Products / catalog — `CONFIRMED` · Trust: Medium

- **Table:** `product` (migration `0004`). **DB count: 1,298** (1,296 legacy + 2 demo). *(DB-verified count; extraction documented, `legacy_full_migration/16`.)*
- **Business meaning:** dish/product catalog — EN/AR name, category, status, associated packages.
- **Limitations:** **names only** — no nutrition/macros, no allergens, **not linked to orders or meal-history**. Catalog ≠ "what a customer ate".
- **AI/analytics:** menu master reference; **cannot** drive dish-level personalization (no assignment link).

## 8. Meal history (m22) — `CONFIRMED` storage / `PARTIAL` content · Trust: Medium

- **Tables:** `legacy_meal_history_raw` (**4,987**), `customer_meal_history` (**4,955**), `customer_meal_history_items` (**67,908**), `customer_meal_history_exceptions` (open **77**). *(All DB-verified this run.)*
- **Coverage:** last-90-days window; **2,628 distinct customers** *(DB-verified)*; dates 2026-03-19 → 2026-06-17 *(documented)*.
- **Reconciliation:** 4,927/4,927 candidates archived, **0 silent drops**, idempotent *(documented, `meal_history/30,32`)*.
- **Critical limitation:** `meal_type`/`meal_name`/`meal_ref` **null** — items are `(order, date)` only. Parent `meal_types` jsonb is a scrape artifact, not real meal type. *(documented, `data_intelligence/03`.)*
- **AI/analytics:** corroborates cadence; **no content value**. Use `fulfillment_day` as the primary cadence source. Full detail in [03_m22_meal_history_report.md](03_m22_meal_history_report.md).

## 9. Sync records — `CONFIRMED` · Trust: High

- **Table:** `sync_record` (migration `0005`). **DB count: 52,423** *(DB-verified)*.
- **Business meaning:** legacy-key ↔ new-ref map — the migration backbone enabling idempotent re-import and traceability.
- **Limitation:** the order extract feeding sync lacks phone/customer for newer orders → drives the 77 meal-history `missing_order_link` exceptions (see report 03).

## 10. Exceptions — `CONFIRMED` (as a backlog) · Trust: — (operational, not analytics)

- **`migration_exception_review`: 1,272** *(DB-verified)* — categories: duplicate_phone_deduped 621, placeholder_phone(order) 395, placeholder_phone_blacklisted 93, invalid/missing_phone 91, negative_amount 46, customer_not_found 22, reversed_dates 3, no_name 1. *(documented, `legacy_full_migration/20`.)*
- **`customer_meal_history_exceptions`: 77 open**, all `missing_order_link` *(DB-verified)*. Blocked on order-sync completeness; **must not** be force-linked by phone/name.

## 11. m23 dish-per-day foundation — `BLOCKED` · Trust: Blocked

- **Status:** schema (`0020`), parser (`dish-detail-lib.mjs`), scraper (`dish-detail-scrape-job.mjs`, disabled), exception/import tables — **all built**, 54 files / 273 tests pass, migrations apply clean `0001→0020` locally *(documented, `dish_per_day/12`)*.
- **DB reality (verified this run):** `customer_dish_day`, `customer_dish_day_item`, `legacy_dish_detail_raw` **do not exist on staging**; schema head = `0019`. Migration 0020 **deliberately not applied** — there is no usable dish data to import.
- **AI/analytics:** none yet; this is the landing zone for *forward* dish capture. Full detail in [04_m23_dish_per_day_blocker_report.md](04_m23_dish_per_day_blocker_report.md).

---

## Operational modules (built, not a data source) — context

| Module | Migration | Built? | Holds migrated data? | Notes |
|---|---|---|---|---|
| Packing (m20) | `0016` | ✅ schema+API+UI+tests | ❌ none | Forward-capture foundation |
| Driver/Area (m21) | `0017` | ✅ schema+API+UI+tests | ❌ none | Forward-capture foundation |
| Meal/kitchen fulfillment | — | 🟨 design only | ❌ none | No schema built (`legacy_full_migration/27`) |
| Incremental sync | — | ✅ built | ❌ dry-run only | DISABLED, no timer (`meal_history/46`) |

These are real, tested foundations but contribute **no analytics data** today — driver/route/packing/kitchen **outcome** data does not exist.
