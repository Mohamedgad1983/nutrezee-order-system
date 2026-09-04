# 30 — DB Storage Reconciliation after the Retry Apply (+ Idempotency)

> **Phase 6 / Part E.** Proved that the 5 newly successful retry artifacts are **100% archived in
> PostgreSQL with zero silent drops**, every in-window meal-day is accounted for, there are zero
> duplicate raw hashes / clean meal-days, and a full re-apply inserts **nothing** (idempotent). All
> queries run against the staging DB (`nutrezee-postgres-1`); counts only; no PII in logs.

## Counts: before retry → after apply
| metric | before (Phase 5) | after retry apply | Δ |
|---|---|---|---|
| `legacy_meal_history_raw` | 4,982 | **4,987** | +5 |
| `customer_meal_history` (parent) | 4,950 | **4,955** | +5 |
| `customer_meal_history_items` (clean) | 67,836 | **67,908** | +72 |
| `customer_meal_history_exceptions` (open) | 77 | **77** | +0 |
| `customer_meal_history_import_runs` | 6 | **7** (apply) → **8** (after idempotency audit) | +1 / +1 |
| distinct customers with meal history | 2,626 | **2,628** | +2 |

## Proofs (all 8 required checks)

**1 — Every newly successful raw artifact has a DB row.** For the 5 retried orders
(`19667, 20275, 20975, 22234, 22403`): `raw_rows_for_5 = 5`. The 5 new `raw_sha`
(`adbb57a6, 3370ea30, 446f5ba4, 5c5de701, 2f4bc8eb…`) are all present in `legacy_meal_history_raw`
(`new5 shas found in DB = 5`).

**Full-corpus coverage (zero silent drops):**
```
manifest_success_distinct_shas = 4927
shas_in_db_raw                 = 4927
shas_MISSING_silent_drop       = 0      ← every scraped artifact is archived in PostgreSQL
```

**2 — Every parsed in-window meal-day is a clean item or an exception.** For the 5 orders:
`clean_items_for_5 = 72`, `exceptions_for_5 = 0` → 72 + 0 = **72** in-window meal-days, matching the
importer's `would_import_clean = 72`.

**3 — Zero unaccounted meal-days.** Parent `meal_day_count` sum for the 5 orders
(`parent_meal_day_sum_for_5 = 72`) equals the clean-item count (`72`). All 5 parents are fully linked
(`parent_all_linked_for_5 = 5`, i.e. `order_id` and `customer_id` both set).

**4 — Zero duplicate raw hashes.** `dup_raw_hashes = 0`.

**5 — Zero duplicate clean meal-days.** `dup_clean_meal_days = 0` (unique `(legacy_order_id, meal_date)`).

**6 — Idempotency: a full re-apply inserts zero rows.** Re-ran the entire last-90 apply over all 4,927
artifacts (`run_id 01KVBEXCM7P1RMDXKTSV04SY6K`):
```
records_seen 4927 · raw_inserted 0 · parent_inserted 0 · item_inserted 0 · exception_inserted 0
would_skip_duplicate 4927 · duplicate_hash 4927 · applied true · ok true
DB after rerun: raw 4987 · parent 4955 · items 67908 · exceptions 77 (UNCHANGED) · import_runs 8 (+1 audit)
```
Every one of the 4,927 raw `raw_sha` is recognized and skipped — nothing duplicated.

**7 — Queryable from PostgreSQL.** Every figure above is a live query against `nutrezee-postgres-1`
(staging). PostgreSQL — not the raw files — is the system of record.

**8 — No PII in logs.** Sensitive-pattern scan (cookie / set-cookie / password / session / email /
`PGPASSWORD`) over `import-run-history.jsonl` and the three Phase-6 run-output files: **0 hits**. The
run-history entries carry ids/counts only (no `payload`/`cookie`/`email`/`phone`/`dates` keys). Raw
payloads (which contain PII) remain on the VPS, never committed, never logged.

## Gated-apply provenance
`run_id 01KVBE0HCKWZ7ZDMS1A1SMCMQ6` · tokens `SYNC_TARGET=staging` + `MEAL_IMPORT_SCOPE=last_90_days` +
`MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_90_STAGING` + `MEAL_IMPORT_SOURCE_VPS=1` · staging DB version
`0019` · pre-apply backup `pre-phase6-retry-apply-20260617T183736Z.dump` (21 MB, valid custom-format
archive). Wrote **only** the m22 tables (`legacy_meal_history_raw`, `customer_meal_history{,_items}`,
`customer_meal_history_exceptions`, `customer_meal_history_import_runs`) — no customer/order core,
packing, delivery, WhatsApp, or systemd/timer changes.

## Conclusion
The last-90 retry gap is **closed end-to-end in PostgreSQL**: 4,927/4,927 candidates archived, the 5
newly scraped artifacts fully reconciled (5 raw + 5 parent + 72 clean items + 0 exceptions), zero
silent drops, zero duplicates, fully idempotent.
</content>
