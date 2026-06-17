# 04 — Last-30-Days Import Plan (m22)

> The first real candidate scope is **last-30-days only**. Built as a **dry-run** tool. No apply, no
> full-history, no scheduled sync in Phase 1.

## Tooling
- `tools/legacy-full-migration/meal-history-lib.mjs` — pure helpers (`parseMealGrid`, `mealSha`,
  `scopeToWindow`, `withinWindow`, `classifyItem`). Unit-tested (TS-U, 7 tests).
- `tools/legacy-full-migration/meal-history-import.mjs` — dry-run runner.

## Hard guards (defense in depth, before any DB/driver load)
| Guard | Behavior |
|---|---|
| **No whole-history import** | `MEAL_IMPORT_SCOPE=full` → refused unless `ALLOW_FULL_HISTORY=1` (exit 2) |
| **No production apply** | `MEAL_IMPORT_MODE=apply` with `SYNC_TARGET!=staging` → refused (exit 2) |
| **Dry-run first** | `MEAL_IMPORT_MODE=apply` → refused in Phase 1 (`apply path not enabled — dry-run + last-30 validation must pass first`) (exit 2) |
| **Default scope** | `last_30_days` |
| **Not mixed with order sync** | separate tool, separate run-history sink, separate runs/exceptions tables |

All three refusals were verified live (in-container): `exit 2` each.

## Summary counts (emitted every run)
`records_seen · records_candidate · would_archive · would_import_clean · would_skip_duplicate ·
would_exception · missing_customer_link · missing_order_link · invalid_date · duplicate_hash ·
duration_ms` (+ `dedup_checked`, `window_from/to`, `applied:false`).

## Dry-run evidence (staging, 2026-06-17, 60-order raw sample)

| Scope | window | seen | candidate | would_archive | would_import_clean | would_exception | missing_order_link | invalid_date | duplicate_hash | ok |
|---|---|---|---|---|---|---|---|---|---|---|
| **last_30_days** | 2026-05-18 → 2026-06-17 | 60 | 52 | 60 | **211** | 28 | 28 | 0 | 0 | ✅ |
| last_90_days | 2026-03-19 → 2026-06-17 | 60 | 58 | 60 | 558 | 28 | 28 | 0 | 0 | ✅ |
| full | — | — | — | — | — | — | — | — | — | **refused (guard)** |

- `dedup_checked=false` — the m22 destination tables are not yet deployed to staging, so dedup vs
  already-archived raw is correctly skipped (not an error). Order/customer links **were** resolved.
- All 28 exceptions are `missing_order_link` (meal grids whose `internal_id` has no `sync_record`
  order mapping) — routed to exceptions, **not** forced into clean tables. Zero `invalid_date`, zero
  `missing_customer_link` (every linked order had a customer).

## Mapping
`internal_id` (grid filename) → `order_number` (`orders_index.jsonl`) → `customer_order.id` +
`customer_id` (`sync_record.new_ref`). Legacy ids preserved throughout.

## Controlled apply path (Phase 2 — NOT in this run)
When dry-run + validation (doc 05) pass and the migration is deployed to staging, the apply path will,
**inside a transaction per order**: insert `legacy_meal_history_raw` (skip on `raw_sha` conflict) →
upsert `customer_meal_history` → insert `customer_meal_history_items` (skip dup meal-days) → write
unlinked/invalid rows to `customer_meal_history_exceptions` → finalize the `import_runs` row with
counts. Apply will remain gated: `SYNC_TARGET=staging` + explicit confirmation + `scope=last_30_days`.

## Out of scope now
full-history import · scheduled sync (step 9) · per-dish backfill (~500k ajax) · any UI (until the
first transferred sample is validated, doc 05).
