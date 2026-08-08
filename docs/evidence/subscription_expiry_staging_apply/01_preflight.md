# 01 — Preflight

**Date:** 2026-06-20 · **Goal:** make `analytics.customer_subscription_status` available on staging by applying **only** `0021`, **without** applying the pending `0020` (dish-per-day).

---

## Target

- DB container: `nutrezee-postgres-1` · database: `nutrezee` · user: `nutrezee` (superuser) · VPS `vmi3360590`. **Staging only — never production.**

## Why NOT the normal migration runner

`app/db/migrate.mjs` applies **all** pending `.sql` files in filename order. With staging head at `0019`, running it would also apply `0020_wave7_dish_per_day.sql` — which must remain unapplied (no dish data; deliberate decision). So `0021` is applied **directly and supervised**, leaving `0020` pending.

## Preflight checks (DB-verified)

| Check | Expected | Found |
|---|---|---|
| `schema_migrations` head | `0019…` | `0019_wave6_meal_history_exception_resolution.sql` |
| `0020` applied? | no | **no** |
| `0021` applied? | no (before apply) | **no** |
| `analytics` schema | absent (before) | absent |
| dish table `customer_dish_day` | absent | absent (`to_regclass` NULL) |

## Backup / safety posture

The change is **additive and view-only** (a new `analytics` schema + two `CREATE OR REPLACE VIEW`s + one `schema_migrations` row). No business table is altered, and rollback is a trivial `DROP SCHEMA analytics CASCADE` ([04](04_rollback_plan.md)). Because there is no business-data mutation and rollback is immediate and complete, a full `pg_dump` snapshot was not required for this specific additive apply; the migration DDL was first proven by applying it inside a transaction and rolling back (zero-persistence dress rehearsal) before the real apply.
