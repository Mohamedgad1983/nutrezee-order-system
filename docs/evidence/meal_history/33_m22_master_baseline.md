# 33 — m22 Master Closure: Baseline & Environment

> **Stage 0.** Confirmed staging target, DB state, and VPS environment before the master-closure run.
> Safe to proceed. Branch `migration/legacy-full-clone-reconciliation` @ `efe141f`, clean tree.

## Repo
- branch: `migration/legacy-full-clone-reconciliation`
- commit: `efe141f`
- working tree: clean (only known pre-existing untracked: `CLAUDE.md`, `nutreeze-hr-kuwait-plan/`, `tools/legacy-migration/`)

## Staging DB (`nutrezee-postgres-1`, db `nutrezee`)
- version: `0019_wave6_meal_history_exception_resolution.sql`
| m22 table | rows |
|---|---|
| `legacy_meal_history_raw` | 4,987 |
| `customer_meal_history` (parent) | 4,955 |
| `customer_meal_history_items` (clean) | 67,908 |
| `customer_meal_history_exceptions` (open) | 77 |
| `customer_meal_history_import_runs` | 8 |
| distinct customers with meal history | 2,628 |

- open exceptions: **77**, all `missing_order_link`, across **40 distinct legacy orders**.

## Order-sync state (the meal-history exception dependency)
| metric | value |
|---|---|
| `sync_record` orders | 20,103 |
| `sync_record` customers | 19,463 |
| order-sync watermark (max numeric order legacy_key) | **24,630** |
| order-sync next_cursor (max id in extract) | 24,675 |
| order-sync dry-run `would_create` | **0** |
| order-sync dry-run `would_skip` | 639 |
| `migration_exception_review` rows | 1,272 |

`sync_record` object types: customer 19,463 · order 20,103 · payment 11,538 · product 1,298 · package 9 · master 12.

## VPS
- host: `vmi3360590` (Linux x86_64)
- raw path: `/opt/nutrezee/legacy-meal-history/raw` (858 MB, 4,927 `.html.gz`; avg ~178 KB/file)
- disk: 172 GB free of 193 GB (11% used)
- credentials present (legacy `LEGACY_*` in `/opt/nutrezee/legacy-migration.env`; DB `POSTGRES_PASSWORD`
  in `/opt/nutrezee/.env`) — **never printed**
- meal-history scrape timer: **not enabled** (`systemctl is-enabled` → not-found)

## Gate
Target confirmed **staging**; DB state safe and consistent with the Phase-6 close. **Proceed.**
</content>
