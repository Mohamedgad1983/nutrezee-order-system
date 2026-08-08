# 23 — Last-90 Validation V1–V10

> **Result: ACCEPTED.** All ten checks pass against ground-truth PostgreSQL queries for the 373
> scraped last-90 orders. Independently re-verified by a 12-agent adversarial panel (silent-drop
> skeptic: 0 silent drops found). import_run_id `01KVATTQ6YF7GMD555STHYZZM2`.

| # | Check | Verdict | Evidence |
|---|---|---|---|
| **V1** | Source→artifact coverage | **PASS** | 374 attempted internal_ids, each with a manifest outcome: 373 success + 1 http_500 (retryable, order 24174). 4,554 remaining = explicit resumable tail, not dropped. |
| **V2** | Artifact→raw-archive coverage | **PASS** | 373 manifest success shas, **373 in `legacy_meal_history_raw`, 0 missing** (silent drops = 0). |
| **V3** | Raw→clean/exception coverage | **PASS** | run orders: 3358 clean + 5 exceptions = 3363 parsed in-window meal-days; **0 unaccounted**. |
| **V4** | Customer/order linking (deterministic) | **PASS** | run items linked **3354/3354**; sample chains (22987, 22989, …) item→order→customer verified; missing_customer_link 0; only order 24629 unlinked (missing_order_link). |
| **V5** | Date validation | **PASS** | imported dates min 2026-05-31, max 2026-06-17 (within last-90 window 2026-03-19→2026-06-17); out_of_window 0, null 0, invalid 0. |
| **V6** | Duplicate prevention | **PASS** | duplicate raw hashes **0**; duplicate `(legacy_order_id, meal_date, meal_type)` **0**. |
| **V7** | Exception review | **PASS** | 31 exceptions, all `missing_order_link` / `open`, detail = `order_number` key only (no PII); this run's 3 all = order 24629 (placeholder-phone, in `migration_exception_review`, below watermark 24630); actionable via the relink pass once order-sync advances. |
| **V8** | Idempotency | **PASS** | rerun: would_skip_duplicate 373, all inserts 0; DB counts unchanged (raw 433 / items 3565 / exc 31 / parent 431), +1 audit run. |
| **V9** | Queryability (PostgreSQL) | **PASS** | by customer_id (14 meals), by date range (last-7d = 2181 items), exceptions by reason (31), import-run audit (`apply/last_90_days/ok`, clean=3354). Sample SQL in doc 22 §9. |
| **V10** | Decision | **ACCEPT** | last-90 (the 373 scraped orders) is **stored in DB with no silent drops**, idempotent, queryable, PII-free. Widening to the remaining 4,554 is the documented next step (scrape resume → idempotent apply). |

## Sample SQL (V9 — queryable from PostgreSQL, not files)
```sql
-- meal history by customer
SELECT i.meal_date FROM customer_meal_history_items i JOIN customer_meal_history h ON h.id=i.meal_history_id WHERE h.customer_id=$1 ORDER BY i.meal_date;
-- by order
SELECT meal_date FROM customer_meal_history_items WHERE order_id=$1;
-- by date range
SELECT count(*) FROM customer_meal_history_items WHERE meal_date BETWEEN $1 AND $2;
-- exceptions by reason
SELECT reason, resolution_status, count(*) FROM customer_meal_history_exceptions GROUP BY 1,2;
-- import-run audit
SELECT mode, scope, status, counts FROM customer_meal_history_import_runs WHERE id=$1;
```

## Adversarial panel
A 12-agent workflow (V1–V10 verifiers + a silent-drop skeptic) re-verified the reconciliation from the
evidence bundle. Skeptic verdict: **0 silent drops**; the no-silent-drops claim **holds** for the 373
scraped orders (raw 373=373, clean+exception accounts for every parsed in-window meal-day, idempotent;
the 1 failed fetch is documented + retryable, not dropped).
