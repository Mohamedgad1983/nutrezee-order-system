# 08 — Last-30-Days Dry-Run After Staging Migration

> **Status:** ✅ clean. Re-ran the dry-run with the m22 destination tables now deployed (0018).
> Expected change vs the pre-migration baseline: **only** `dedup_checked` flips `false → true`.

## Run
```
docker exec -e RAW_DIR=/srv/meal_raw -e ORDERS_INDEX=/srv/orders_index.jsonl \
  -e MEAL_IMPORT_SCOPE=last_30_days -e MEAL_IMPORT_MODE=dry-run -e SYNC_TARGET=staging \
  nutrezee-api-1 node /srv/meal-history-import.mjs
```

## Result (window 2026-05-18 → 2026-06-17)
| field | value |
|---|---|
| records_seen | 60 |
| records_candidate | 52 |
| would_archive | 60 |
| would_import_clean | 211 |
| would_skip_duplicate | 0 |
| would_exception | 28 |
| missing_order_link | 28 |
| missing_customer_link | 0 |
| invalid_date | 0 |
| duplicate_hash | 0 |
| duration_ms | ~12,600 |
| **dedup_checked** | **true** ✅ |
| **ok** | **true** ✅ |
| **applied** | **false** ✅ |

## Baseline comparison (Phase-1 vs now)
| field | Phase-1 (pre-migration) | now (post-migration) | delta |
|---|---|---|---|
| records_seen | 60 | 60 | — |
| records_candidate | 52 | 52 | — |
| would_import_clean | 211 | 211 | — |
| would_exception | 28 | 28 | — |
| ok | true | true | — |
| **dedup_checked** | **false** | **true** | ✅ flipped as expected |

**Materially consistent** — identical counts; the only change is `dedup_checked=true` (the destination
table now exists for dedup). No spikes in invalid dates or missing links; duplicate behaviour clear
(0 — nothing archived yet). All gated-apply preconditions therefore satisfied (see doc 09).
