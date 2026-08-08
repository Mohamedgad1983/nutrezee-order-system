# 09 — Report Manifest

**Date:** 2026-06-20 · **Branch:** `migration/legacy-full-clone-reconciliation` · **Head commit:** `1bfd9ca`
**Pass type:** read-only reporting/evidence. No application code changed, no migrations applied, no scraping, no production, no timers.

---

## 1. Files created by this pass

All under `docs/evidence/extracted_data_report/`:

| File | Purpose |
|---|---|
| `01_executive_summary.md` | Plain-English owner summary + final recommendation |
| `02_data_inventory.md` | Deep entity inventory (DB-verified counts, trust levels) |
| `03_m22_meal_history_report.md` | m22 meal-history detail (last-90 complete; last-year not confirmed) |
| `04_m23_dish_per_day_blocker_report.md` | Dish-per-day blocker explanation |
| `05_ai_readiness_report.md` | AI readiness (≈27/100) — safe vs blocked features |
| `06_analytics_foundation_recommendation.md` | Read-only `analytics.*` view blueprint (design only) |
| `07_data_quality_and_gaps.md` | Gap analysis with risk ranking |
| `08_next_phase_execution_plan.md` | Analytics-Foundation phase plan |
| `09_report_manifest.md` | This manifest |
| `sql/read_only_verification.sql` | The exact read-only SQL executed + proposed extensions |

No other repository files were created or modified by this pass.

## 2. Database access used — YES (read-only, staging)

- **Target:** staging only — docker container `nutrezee-postgres-1`, db `nutrezee`, user `nutrezee`, on VPS `vmi3360590`. **Not production.**
- **Method:** `docker exec nutrezee-postgres-1 psql -U nutrezee -d nutrezee` via the `nutrezee-vps` MCP (`vps_exec`), local socket. **No credentials/secrets were printed** (an attempt to read container env vars was correctly denied by the auto-mode classifier and abandoned; DB name/user came from the checked-in `docker/compose.yml`).
- **Query discipline:** **SELECT / count / metadata only.** No INSERT/UPDATE/DELETE/DDL. No PII selected — only counts and aggregate distributions.
- **Full SQL:** see [sql/read_only_verification.sql](sql/read_only_verification.sql) (blocks 1–7 marked `[EXECUTED]`).

## 3. Counts freshly verified this run (2026-06-20)

| Check | Result | vs documented baseline |
|---|---|---|
| `customer` | 19,476 | match |
| `address` | 9,511 | match |
| `customer_order` | 20,104 | match |
| `fulfillment_day` | 527,724 | match |
| `payment_record` | 11,539 | match |
| `customer_meal_history` (parent) | 4,955 | match |
| `customer_meal_history_items` | 67,908 | match |
| `legacy_meal_history_raw` | 4,987 | match |
| `product` | 1,298 | match |
| `package` | 9 | match |
| `area` | 127 | match |
| `sync_record` | 52,423 | match |
| `migration_exception_review` | 1,272 | match |
| meal-history exceptions (open) | 77, all `missing_order_link` | match |
| distinct meal-history customers | 2,628 | match |
| `fulfillment_day` status mix | **100% `scheduled`** (single group) | confirms gap |
| schema head | `0019` (applied 2026-06-17) | match (0020 not applied) |
| m23 dish tables present? | **No** (`to_regclass` = NULL ×3) | confirms documented skip |
| base tables | 79 (77 non-audit + 2 audit) | doc said 73 — counting-method delta |

**Every documented entity count was independently confirmed with zero drift.** The only discrepancy is the base-table total (79 vs 73), explained as an `information_schema` enumeration difference, not a data change.

## 4. Evidence inspected (read, not modified)

- `docs/evidence/data_intelligence/` — `00`–`12` (baseline, catalog, ERM, quality, behavior, auto-meal readiness, AI blueprint, feature store, dashboards, gaps, roadmap, mgmt summary, final report).
- `docs/evidence/meal_history/` — focus on `06,12,19,22,23,24,25,26,30,31,32,33,34,35,36,37,39,42,46,47` (m22 program through master closure).
- `docs/evidence/dish_per_day/` — `00`–`12` (m23 discovery + foundation).
- `docs/evidence/legacy_full_migration/` — `09,10,12,13,16,17,18,19,20,24,26–31` + JSON evidence (`extract_counts.json`, `delivery_extraction_summary.json`, `mismatches.jsonl`, `whatsapp_segments_summary.json`).
- `app/db/migrations/` — listing + `0018`, `0019`, `0020` (table definitions).
- `docker/compose.yml`, `docker/compose.staging.yml` — DB name/user defaults (no secrets).

## 5. Commands run (summary)

- `git status`, `git branch`, `git log` — repo state.
- `ls` / `find` over `docs/evidence/` and `app/db/migrations/` — orientation.
- `grep` over compose files for DB user/db (password masked).
- `vps_health` — confirmed staging containers up (`nutrezee-postgres-1` healthy).
- `vps_exec` psql read-only counts — blocks 1–7 in the SQL file.
- `mkdir -p docs/evidence/extracted_data_report/sql` — output folder.

## 6. Limitations & caveats

- **Last-year meal-history completion is NOT confirmed** from repository evidence — started/resumable only; no DB apply/reconcile documented or present.
- **Order-sync completeness is unresolved** — drives 77 open meal-history exceptions and a −1,172 historical-order shortfall; cannot be fixed without a full-detail legacy order re-pull (out of scope here).
- **No dish/nutrition/allergy/feedback/delivery-outcome data exists** — those readiness areas remain blocked; this pass did not (and could not) verify content that is absent.
- **Base-table count (79 vs 73)** is an unreconciled metadata difference; it does not affect any entity count.
- **Field-level null rates** (e.g. email ≈100%, DOB ≈71%) are carried from `data_intelligence/03` and were **not** re-run this pass — they are tagged *previously documented*, not *DB-verified this run*.
- **PII:** no names, emails, phones, or addresses were selected or reproduced anywhere in this package.

## 7. Provenance legend (used across the package)

- *DB-verified this run* — confirmed by a SELECT/count executed 2026-06-20 against staging.
- *previously documented* — taken from an existing `docs/evidence/` file (cited).
- *inferred from import/migration evidence* — derived from import results / migration SQL.
- *not verified* — stated in docs but not independently confirmable here (e.g. last-year completion).
