# 28 — Importer Dry-Run over the Retry Artifacts (last-90, VPS)

> **Phase 6 / Part C.** Ran the meal-history importer in **dry-run** over the full VPS raw corpus
> (now 4,927 artifacts) to determine what the gated apply would do with the 5 newly successful
> retries. **Clean: 5 to archive, 72 in-window clean meal-days, 0 exceptions, 0 invalid dates, 4,922
> deduplicated, `applied=false`, `ok=true`.** No silent drops; no PII in logs.

## Execution (VPS host, reads the VPS raw dir directly)
```
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=nutrezee PGDATABASE=nutrezee PGPASSWORD=<from /opt/nutrezee/.env>
RAW_DIR=/opt/nutrezee/legacy-meal-history/raw
ORDERS_INDEX=/opt/nutrezee/legacy-detail-2026/out/orders_index.jsonl
MEAL_IMPORT_MODE=dry-run  MEAL_IMPORT_SCOPE=last_90_days  SYNC_TARGET=staging
node /opt/nutrezee/legacy-meal-history/meal-history-import.mjs
```
- Reads from the canonical VPS raw path `/opt/nutrezee/legacy-meal-history/raw` (all 4,927 files).
- DB connection via `PG*` env vars (the password is never embedded in a URL / never printed); the
  importer's `pg.Client` falls back to `PG*` when `DATABASE_URL` is unset.
- The importer on the VPS is **byte-identical** to the repo (`meal-history-import.mjs` sha256
  `e36752fd…`).
- Launched detached (`nohup`) and polled — the full-corpus dry-run gunzips + parses all 4,927
  artifacts (five are 21–26 MB), ~14 min wall-clock.

## Dry-run SUMMARY
| field | value | note |
|---|---|---|
| mode / scope | dry-run / last_90_days | |
| window | `2026-03-19` → `2026-06-17` | |
| records_seen | **4,927** | all raw artifacts |
| records_candidate | **5** | new artifacts with ≥1 in-window meal-day |
| would_archive | **5** | the 5 retried orders (new raw_sha) |
| would_import_clean | **72** | in-window meal-days, all order-linked |
| would_skip_duplicate | **4,922** | prior artifacts (raw_sha already in DB) |
| would_exception | **0** | |
| missing_order_link | **0** | all 5 orders resolve via `sync_record` |
| missing_customer_link | **0** | |
| invalid_date | **0** | |
| duplicate_hash | **4,922** | dedup against `legacy_meal_history_raw` |
| dedup_checked | **true** | |
| applied | **false** | dry-run writes nothing |
| ok | **true** | |
| duration_ms | 851,912 (~14.2 min) | |

## Acceptance (all met)
- `ok = true` ✓
- `dedup_checked = true` ✓
- `applied = false` ✓
- `invalid_date = 0` ✓
- No silent drops: every in-window meal-day of the 5 new orders is accounted for — **72 clean + 0
  exception = 72**, matching the 72 in-window days; the 4,922 prior artifacts are recognized and
  skipped, not dropped ✓
- No PII in logs (counts-only summary; raw payloads stay on the VPS) ✓

## Interpretation
The 5 orders that previously returned `http_500` were **fetch** failures, not missing orders — their
orders already exist in `sync_record`, so all 72 in-window meal-days classify as **clean** (zero new
`missing_order_link` exceptions). The gated apply (doc 29) is therefore safe to run.
</content>
