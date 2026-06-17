# 18 — Last-90-Days Dry-Run Readiness

> Sizing of a last-90-days import from **freshly-scraped** VPS artifacts. **Dry-run only — NOT
> applied** (per the sprint decision rule). Recommendation: gated last-90 apply is the **next** task,
> after the full last-90 scrape completes.

## Dry-run (importer against 50 scraped orders, last_90_days, staging)
```
docker exec -e RAW_DIR=/srv/meal_raw_scraped -e ORDERS_INDEX=… -e MEAL_IMPORT_SCOPE=last_90_days \
  -e MEAL_IMPORT_MODE=dry-run -e SYNC_TARGET=staging nutrezee-api-1 node /srv/meal-history-import.mjs
```
| field | value |
|---|---|
| window | 2026-03-19 → 2026-06-17 |
| records_seen | 50 |
| records_candidate | 50 |
| would_archive | 50 |
| would_import_clean | **199** |
| would_skip_duplicate | 0 |
| would_exception | **3** (all `missing_order_link`) |
| missing_order_link | 3 |
| missing_customer_link | 0 |
| invalid_date | 0 |
| duplicate_hash | 0 |
| dedup_checked | **true** |
| **ok** | **true** |

### Estimated clean items (full last-90)
Sample: 50 orders → 199 clean meal-days (~4.0/order); ~1.5% exception rate. Full last-90 candidate set
= **4,927 orders** → order-of-magnitude **~19–20k clean meal-days** once fully scraped (estimate;
actual depends on per-order plan length). Exception rate is expected to stay low because window-
selected orders are mostly already synced (below the watermark) — unlike the original arbitrary
60-sample (12% exceptions).

## Acceptance criteria (Part G item 5)
| criterion | status |
|---|---|
| relink complete OR exceptions explained | ✅ explained (order-sync dependency, docs 13/15); relink job built + proven |
| last-90 dry-run ok | ✅ `ok=true` |
| no spike in missing links | ✅ 3 / ~202 meal-days (~1.5%) — **lower** than last-30 sample |
| no parse failures above threshold | ✅ scrape parse 50/50 success; importer 0 invalid_date |
| idempotency tests pass | ✅ (`ts-i-meal-history`, `ts-i-relink`) + live rerun proven |
| no PII logs | ✅ manifest/run-history counts-only |

## Recommendation
**Prepare a gated last-90 apply as the NEXT task — do not run it in this sprint** (decision rule:
"Do not run last-90-days import in this task"). Concretely:
1. Run the full last-90 **scrape** to completion (4,927 orders, resumable, rate-limited) on the VPS.
2. Run the importer **dry-run** over the full scraped set; confirm `ok`, low exceptions, 0 parse fails.
3. Run the **gated last-90 apply** — but the importer's apply path is currently code-locked to
   `last_30_days` (`meal-history-import.mjs` apply guard). Widening apply to `last_90_days` is a
   deliberate guard change (extend the allowed-apply-scope, keep staging + explicit-confirm gates).
4. Run `meal-history-relink` after each order-sync advance to absorb the residual `missing_order_link`.

Until then the last-90 transfer is **sized and ready**, not applied.
