# 22 — Last-90 DB Storage Reconciliation (the business requirement)

> **Result: DB storage CONFIRMED 100% for the in-scope (373 scraped) records. Zero silent drops.**
> The final state is queryable from PostgreSQL — not files on disk. Idempotency proven.
> import_run_id `01KVATTQ6YF7GMD555STHYZZM2`.

## Gated apply
```
MEAL_IMPORT_MODE=apply MEAL_IMPORT_SCOPE=last_90_days SYNC_TARGET=staging \
MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_90_STAGING MEAL_IMPORT_SOURCE_VPS=1 \
RAW_DIR=/opt/nutrezee/legacy-meal-history/raw … node meal-history-import.mjs
```
Pre-apply backup: `/opt/nutrezee/backups/pre-last90-apply-20260617T130224Z.dump` (18 MB).
Apply: `raw_inserted 373 · parent_inserted 371 · item_inserted 3354 · exception_inserted 3 ·
would_skip_duplicate 4 · applied true · ok true`. Wrote **only** m22 tables.

## 1. Raw archive coverage — **100%, 0 silent drops**
Joined the 373 manifest success `raw_sha` values against `legacy_meal_history_raw`:
```
manifest_success_shas = 373
shas_in_db_raw        = 373
shas_MISSING_from_db  = 0      ← zero silent drops
```
The importer's `mealSha(gunzip(file))` equals the scraper's `mealSha(body)` (gzip is lossless), so the
match is by the exact artifact hash.

## 2. Clean / exception accounting — **0 unaccounted**
For the 373 run orders (`source_record_id` of this run's raw rows):
```
clean_items = 3358   exceptions = 5   parents = 373
parsed_in_window_meal_days (3363) = clean (3358) + exceptions (5)   ← reconciliation formula holds
```
(5 exceptions = 3 inserted this run + 2 pre-existing for the 2 overlap orders; 3358 clean = 3354
inserted + 4 pre-existing meal-days.) Every parsed in-window meal-day is a clean item **or** an
exception. Nothing dropped.

> **Future-dated dates are preserved, not lost.** The independent panel re-derived the meal-day
> accounting from the stored `legacy_meal_history_raw.payload.dates` and confirmed the parsed dates
> beyond the window (future-dated, > today 2026-06-17) are **out-of-window by `withinWindow()` design**
> and **all still present in the raw archive payload** — so the raw archive is the complete record;
> the clean import scope is just "in-window". No silent drop: an un-imported parsed date is either an
> exception or a future date sitting in raw, never gone.

## 3. Parent coverage
Every run order has a `customer_meal_history` parent (**373/373**); legacy ids preserved
(`legacy_order_id`, `legacy_order_number`). Linked parents carry `order_id` + `customer_id`
(deterministic mapping). Overall `parents_linked = 405/431`.

## 4. Exception coverage
31 exceptions total, **all `missing_order_link` / `open`**, detail = `{"order_number": …}` (**ids
only, no PII**). This run's 3 exceptions are all order **24629** (placeholder-phone, confirmed in
`migration_exception_review`, below watermark 24630). Stored, not ignored.

## 5. Deduplication — **0 / 0**
`duplicate_raw_hashes = 0` · `duplicate (legacy_order_id, meal_date, meal_type) = 0`.

## 6. Idempotency — re-ran the same apply
```
records_seen 373 · would_skip_duplicate 373 · raw_inserted 0 · parent_inserted 0 ·
item_inserted 0 · exception_inserted 0 · applied true · ok true
DB after: raw 433 · items 3565 · exceptions 31 · parent 431 (UNCHANGED) · import_runs 4 (+1 audit)
```
Re-running duplicates nothing.

## 7. Before / after DB counts
| table | before | after | delta |
|---|---|---|---|
| `legacy_meal_history_raw` | 60 | **433** | +373 |
| `customer_meal_history` (parents) | 60 | **431** | +371 |
| `customer_meal_history_items` (clean) | 211 | **3565** | +3354 |
| `customer_meal_history_exceptions` | 28 | **31** | +3 |
| exceptions open / resolved | 28 / 0 | 31 / 0 | +3 / 0 |
| `customer_meal_history_import_runs` | 2 | 4 | +2 (apply + idempotency rerun) |

## 8. Reconciliation formula
`parsed_in_window_meal_days (3363) = clean_items (3358) + exception_rows (5)` ✅ — for the 373 run
orders. Zero unaccounted parsed meal-days.

## 9. Not a file-only result
The data is queryable from PostgreSQL (doc 23 V9): by `customer_id`, `order_id`, date range, exception
reason, and import-run audit. Raw files on the VPS are the lossless source; **the system of record is
PostgreSQL**.

## Conclusion
For the **373 successfully scraped last-90 orders**: 100% archived in `legacy_meal_history_raw`, 100%
of parsed in-window meal-days stored as clean items or exceptions, 0 silent drops, idempotent,
queryable, no PII. The remaining 4,554 last-90 candidates are the resumable tail (doc 20).
