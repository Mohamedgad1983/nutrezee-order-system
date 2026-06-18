# 00 — Data Intelligence Baseline

> **Read-only data assessment.** No DB mutation, no PII printed, docs only. Target confirmed
> **staging** (`nutrezee-postgres-1`), not production.

## Repo
- branch: `migration/legacy-full-clone-reconciliation`; commit `fd2d5db`; tree clean (only known
  untracked: `CLAUDE.md`, `nutreeze-hr-kuwait-plan/`, `tools/legacy-migration/`).
- evidence written under `docs/evidence/data_intelligence/`.

## DB target
- `db=nutrezee user=nutrezee` in container `nutrezee-postgres-1` (staging VPS `vmi3360590`), reached
  over the local unix socket inside the VPS. **Staging confirmed — not production.**
- schema version: `0019_wave6_meal_history_exception_resolution.sql` (19 migrations applied).
- base tables: **73** (incl. partitioned `audit_event`/`audit_event_default`).

## Jobs / timers
- **No nutrezee systemd timers enabled** (scrape, sync, meal-history all manual/disabled).
- A last-year meal-history **scrape is running** on the VPS from the prior migration task — it writes
  raw **files** under `/opt/nutrezee/legacy-meal-history/raw`, **not the DB**, so it does not affect
  this read-only DB analysis. **Left untouched.**

## Key row counts (exact)
| table | rows | table | rows |
|---|---|---|---|
| customer | 19,476 | fulfillment_day | **527,724** |
| customer_order | 20,104 | sync_record | 52,423 |
| address | 9,511 | payment_record | 11,539 |
| customer_phone | 19,371 | customer_meal_history | 4,955 |
| product | 1,298 | customer_meal_history_items | 67,908 |
| package | 9 | legacy_meal_history_raw | 4,987 |
| area | 127 | migration_exception_review | 1,272 |
| import_batch | 414 | import_row_result | 111,484 |

(`pg_stat` estimates differ slightly; the above are exact `count(*)`.)

## Safety posture for this assessment
- only `SELECT` / `information_schema` / aggregate queries were run; **zero** writes.
- **no** customer name / email / phone / address / payment-ref values appear in any doc — only counts,
  distributions, masked/anonymized aggregates, and reference labels (package/area/status).

## Gate
Staging confirmed, schema known, read-only — proceed to the full inventory (doc 01).
</content>
