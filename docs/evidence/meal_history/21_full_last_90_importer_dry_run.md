# 21 — Full Last-90 Importer Dry-Run (over scraped VPS artifacts)

> Dry-run of the m22 importer over the **373** scraped last-90 artifacts, **before** the gated apply.
> All acceptance criteria pass. Run host-side (postgres on `127.0.0.1:5432`), reading the VPS raw dir
> directly (no docker-cp of GBs).

## Run
```
RAW_DIR=/opt/nutrezee/legacy-meal-history/raw ORDERS_INDEX=…/orders_index.jsonl \
MEAL_IMPORT_SCOPE=last_90_days MEAL_IMPORT_MODE=dry-run SYNC_TARGET=staging \
node meal-history-import.mjs
```

## Summary
| field | value |
|---|---|
| records_seen | **373** |
| records_candidate | **373** |
| would_archive | **373** |
| would_import_clean | **3358** |
| would_skip_duplicate | 0 |
| would_exception | **3** |
| missing_order_link | 3 |
| missing_customer_link | 0 |
| invalid_date | **0** |
| duplicate_hash | **0** |
| dedup_checked | **true** |
| applied | **false** |
| ok | **true** |
| duration_ms | ~57,000 (parsing 373 × ~13 MB pages) |

## Acceptance (all pass) before apply
- `ok=true` ✅ · `dedup_checked=true` ✅ · `applied=false` ✅
- `invalid_date=0` ✅
- `duplicate_hash=0` ✅ (the scraped shas are new vs the existing DB archive)
- `missing_order_link=3` — **not a spike** (3 of 3,361 in-window meal-days ≈ 0.09%; all order 24629)
- every parsed in-window meal-day accounted: **3358 clean + 3 exception = 3361** ✅
- no PII in logs (counts/ids only) ✅

Cleared for the gated last-90 apply (doc 22).
