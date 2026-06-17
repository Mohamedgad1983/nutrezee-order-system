# 06 — m22 Customer Meal-History: Phase-1 Status Report

> WP `m22-customer-meal-history`, Phase 1 foundation. Branch
> `migration/legacy-full-clone-reconciliation`. **NO bridge** — controlled transfer into PostgreSQL.

## STATUS: **PASS** (Phase-1 foundation complete; no apply, no full import, no sync, no UI)

## What was delivered
| Deliverable | Status |
|---|---|
| Legacy source discovery | ✅ doc 01 — ajax `getMealsDateWiseFilter` grid + relations + risks |
| Raw archive table | ✅ built (`legacy_meal_history_raw`, migration 0018) — doc 02 |
| Clean model tables | ✅ built (`customer_meal_history`, `_items`, `_import_runs`, `_exceptions`) — doc 03 |
| Import tooling (dry-run) | ✅ `meal-history-lib.mjs` + `meal-history-import.mjs` with hard guards — doc 04 |
| Last-30-days dry-run | ✅ run on staging (read-only): seen 60 / candidate 52 / clean 211 / exception 28 / ok=true |
| Validation criteria | ✅ doc 05 (V1–V8 + reconciliation) |
| Tests | ✅ TS-U (7) + TS-I (7); full suite **50 files / 240 tests** |

## Followed every safety rule
no bridge ✅ · no full-history import (guard refuses) ✅ · no production apply (guard refuses) ✅ ·
no timer enablement ✅ · no WhatsApp ✅ · no destructive schema (additive only) ✅ · no PII in logs
(counts/ids only) ✅ · meal history NOT mixed into order sync (own tool/runs/exceptions) ✅.

## Migration
`0018_wave6_meal_history.sql` — additive; applies clean **0001→0018 locally**. **Not yet applied to
staging** (staging is at 0015; deploying DDL to shared staging is a separate, deliberately-approved
step — the auto-guard correctly blocked an unrequested staging migration during this run). The dry-run
is therefore read-only and reports `dedup_checked=false` until the table is deployed.

## Dry-run summary (last_30_days, 2026-06-17)
```
records_seen 60 · records_candidate 52 · would_archive 60 · would_import_clean 211
would_skip_duplicate 0 · would_exception 28 · missing_order_link 28 · missing_customer_link 0
invalid_date 0 · duplicate_hash 0 · dedup_checked false · applied false · ok true
```

## Approved 10-step sequence — progress
1. Understand old source ✅ (doc 01) · 2. Raw archive ✅ (built) · 3. Clean model ✅ (built) ·
4. Transfer last 30 days 🟨 **dry-run done; apply pending validation + staging deploy** ·
5. Validate samples 🟨 criteria defined (doc 05), run on apply · 6–8. 90d/year/all ⬜ (guarded) ·
9. Sync new records ⬜ · 10. Close legacy dependency ⬜.

## Next safest step
Deploy migration 0018 to staging as a **deliberate, approved additive step** (forward-only), re-run
the last-30-days dry-run to confirm `dedup_checked=true` + clean counts, then perform a **gated
last-30-days apply** and run validation V1–V8 (doc 05). Only after that passes: widen to last-90, then
build the read-only meal-history UI. Full-history import, scheduled sync, and per-dish backfill remain
out of scope.
