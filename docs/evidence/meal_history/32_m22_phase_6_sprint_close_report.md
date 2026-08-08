# 32 — m22 Phase 6 Sprint Close Report

> **Retry Failed Last-90 Scrape Orders + Quick DB Apply + Exception Relink Readiness.**
> **STATUS: PASS.** All remaining retryable `http_500` failures were re-scraped on the VPS and stored
> in PostgreSQL; last-90 scrape coverage is now **4,927/4,927 = 100%** with **0** failures and **0**
> silent drops; the 5 newly successful artifacts are fully reconciled into the DB; the apply is
> idempotent. No production, no UI, no timer, no last-year/full-history, no bridge.

## 1. Retry result
- Targeted the orders with no raw artifact via `--resume` on the VPS. The **live manifest showed 5**
  remaining `http_500` failures (`19667, 20275, 20975, 22234, 22403`), not the 6 narrated in doc 26 —
  order `23214` had already recovered in the prior session (doc 27 reconciles this).
- **5 / 5 retried → `http_200`, parse ok, 0 failures remaining.** 84 meal-days parsed (72 in last-90
  window). Resume skipped the 4,922 already-scraped. wrapper rc=0. (doc 27)

## 2. Final last-90 scrape coverage
| metric | value |
|---|---|
| candidate orders | 4,927 |
| distinct candidates with a manifest outcome | 4,927 (no silent missing) |
| successfully scraped raw artifacts | **4,927** (was 4,922) |
| remaining `http_500` failures | **0** |
| coverage | **100%** |

## 3. Final PostgreSQL counts
| table | count |
|---|---|
| `legacy_meal_history_raw` | **4,987** |
| `customer_meal_history` (parent) | **4,955** |
| `customer_meal_history_items` (clean) | **67,908** |
| `customer_meal_history_exceptions` (open) | **77** |
| `customer_meal_history_import_runs` | **8** |
| distinct customers with meal history | **2,628** |

## 4. Final exception count
**77 open**, all `missing_order_link` (40 distinct orders). Unchanged by the retry — the 5 retried
orders were fully order-linked and added **0** exceptions.

## 5. DB storage confirmation
- 5 newly successful artifacts → 5 raw + 5 parent + 72 clean items + 0 exceptions (doc 29/30).
- manifest_success_distinct_shas = 4,927 = shas_in_db_raw; **silent drops = 0**.
- in-window meal-days fully accounted (72 clean + 0 exception = parent meal-day sum 72).
- dup_raw_hashes = 0; dup_clean_meal_days = 0.

## 6. Idempotency confirmation
Full re-apply over all 4,927 artifacts (`01KVBEXCM7P1RMDXKTSV04SY6K`): `raw/parent/item/exception
_inserted = 0`, `would_skip_duplicate = 4927`, data unchanged. **Idempotent.**

## 7. Relink readiness
Relink dry-run: `exceptions_seen 77 · resolvable 0 · unresolved 40 · still_missing_order_link 77 ·
applied false`. Resolvable = 0 → **blocked on order-sync completeness**, not on meal history. No
name/phone/guess linking; nothing fabricated; nothing promoted (doc 31).

## 8. Remaining blockers
- **77 `missing_order_link` exceptions** await their owning orders landing in `sync_record` (order-sync
  completeness). The meal-days are safely archived and will auto-promote on a future relink. Known
  hard case: order `#24629` `placeholder_phone` (not deterministically repairable without manual
  matching).
- **Per-dish names** (secondary `getMeals` ajax) remain **out of scope**.

## 9. Next safest step
Continue legacy **order import / order-sync** so the 40 distinct exception orders appear in
`sync_record`, then re-run the deterministic relink (dry-run → gated apply) to promote their archived
meal-days into clean items and resolve the exceptions. **Do not** start last-year or full-history,
build UI, enable any timer, or touch production until separately gated.

## Guardrail attestation
VPS-only scraping (host `vmi3360590`, `SCRAPE_ON_VPS=1`, output under
`/opt/nutrezee/legacy-meal-history/raw`); credentials sourced from VPS env, never printed; no raw
artifacts in git (`/opt/nutrezee` is not a git repo); gated apply wrote only m22 tables on staging;
all reconciliation queried staging PostgreSQL; pre-apply backup
`pre-phase6-retry-apply-20260617T183736Z.dump`. No production, no bridge, no UI, no last-year/full
import, no per-dish ajax, no WhatsApp, no timer enablement, no PII/secrets in logs.
</content>
