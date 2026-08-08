# 09 — Last-30-Days Gated Apply (staging)

> **Status:** ✅ **APPLIED to staging** (2026-06-17). Wrote ONLY m22 tables. Idempotency proven.
> No production. No full/90/year import. No UI/sync/timer. No PII in logs.

## Preconditions (all satisfied before apply)
staging target ✅ · migration deployed (0018) ✅ · `dedup_checked=true` ✅ · dry-run `ok=true` ✅ ·
full-import guard refuses ✅ · production guard refuses ✅ · scope exactly `last_30_days` ✅ ·
explicit confirmation token required ✅ · writes only m22 tables ✅.

### Apply guard matrix (verified — each refuses, exit 2)
| invocation | result |
|---|---|
| apply + `SYNC_TARGET=production` | refused: apply requires staging |
| apply + staging + `last_90_days` | refused: apply scope must be last_30_days |
| apply + staging + last_30 + no confirm | refused: requires `MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_30_STAGING` |
| apply + staging + (m22 tables absent) | refused: requires destination tables deployed |
| `scope=full` without `ALLOW_FULL_HISTORY=1` | refused |

## Run
```
docker exec -e RAW_DIR=/srv/meal_raw -e ORDERS_INDEX=/srv/orders_index.jsonl \
  -e MEAL_IMPORT_SCOPE=last_30_days -e MEAL_IMPORT_MODE=apply -e SYNC_TARGET=staging \
  -e MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_30_STAGING \
  nutrezee-api-1 node /srv/meal-history-import.mjs
```
**run_id:** `01KVAKEJ81NY46128Z7CWZ1FEY`

## Apply summary
| field | value |
|---|---|
| applied | **true** |
| ok | **true** |
| raw_inserted | **60** |
| parent_inserted (clean history) | **60** |
| item_inserted (clean meal-days) | **211** |
| exception_inserted | **28** |
| exceptions_by_reason | `{ missing_order_link: 28 }` |
| would_skip_duplicate | 0 |

Counts reconcile with the dry-run: `would_archive 60 = raw_inserted 60`, `would_import_clean 211 =
item_inserted 211`, `would_exception 28 = exception_inserted 28`.

## What apply wrote (m22 tables ONLY)
`legacy_meal_history_raw` (60) · `customer_meal_history` (60) · `customer_meal_history_items` (211) ·
`customer_meal_history_exceptions` (28) · `customer_meal_history_import_runs` (1 apply run).
**No writes** to order/sync/packing/delivery/customer-core/WhatsApp/scheduling tables (order/customer
row counts unchanged: 20,104 / 19,476). Order + customer were **read-only lookups** only.

## Post-apply checks (1–7)
| # | check | result |
|---|---|---|
| 1 | raw archive rows | **60** |
| 2 | clean history parent rows | **60** |
| 3 | clean history item rows | **211** |
| 4 | exception rows | **28** |
| 5 | duplicate raw hashes | **0** |
| 6 | duplicate `(legacy_order_id, meal_date, meal_type)` | **0** |
| 7 | import run row | exists; `mode=apply scope=last_30_days status=ok clean=211 exc=28 raw_ins=60` |
| + | clean items with resolved order link | **211 / 211** |
| + | exception detail | ids only (`{"order_number":"24629"}`), **no PII** |

## Post-apply check 8 — idempotency (re-ran the same apply)
| field | value |
|---|---|
| would_skip_duplicate | **60** (all raw already archived) |
| raw_inserted / parent_inserted / item_inserted / exception_inserted | **0 / 0 / 0 / 0** |
| applied / ok | true / true |
| DB after rerun | raw 60 · parent 60 · items 211 · exceptions 28 (**unchanged**) |
| apply runs recorded | 2 (each run is its own audit row) |

**Idempotent ✅** — re-running duplicates nothing; the skip count rises, the clean count does not.

## Post-apply check 9 — rollback plan (documented, not executed)
Meal-history data is isolated in the 5 m22 tables. To undo this apply only:
`DELETE FROM customer_meal_history_items WHERE import_run_id IN (<apply runs>);` then exceptions,
then `customer_meal_history`, then `legacy_meal_history_raw`, then the `import_runs` rows — or
`TRUNCATE` the 5 m22 tables (they hold only m22 data). The pre-deploy dump
`pre-m22-deploy-20260617T105055Z.dump` is the full fallback. No order/customer/packing/delivery data
is touched by any rollback.
