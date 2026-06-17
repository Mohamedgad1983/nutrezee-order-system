# 07 — Staging Migration Deployment (0016 → 0017 → 0018)

> **Status:** ✅ **DEPLOYED to staging** (2026-06-17). Additive, forward-only, tracked. Production
> never touched. Pre-deploy backup taken.

## Decision: apply 0016 → 0017 → 0018 in numeric order
Staging was at **0015**; the repo had 0016/0017/0018 pending. Policy: prefer numeric order; do not
create a version gap. Applying only 0018 would leave 0016/0017 missing → out-of-order hole. The
migrate runner (`app/db/migrate.mjs`) applies any pending `.sql` in **filename order**, each in its
**own transaction**, tracked in `schema_migrations` (re-runs skipped). So all three were applied
together, in order.

### Adversarial migration-safety audit (independent, pre-deploy)
A 5-agent workflow audited all three migrations statement-by-statement + an adversarial skeptic:
- **0016, 0017, 0018:** `additive_only=true`, **zero destructive statements**, risk **low**.
- Tables created: packing (5), driver/delivery (6), meal_history (5). FK targets to
  `customer_order`/`customer` are `ON DELETE RESTRICT|SET NULL` on **new empty tables** — forward-only,
  no existing-data mutation.
- Only writes to pre-existing tables: **new** `permission` / `role_permission` seed rows (additive).
- **Skeptic verdict:** `refuted=false`, recommendation **`apply_in_order`**.
- Non-blocking caveat: seed INSERTs lack `ON CONFLICT` → not safe to re-run manually, but the runner's
  `schema_migrations` skip protects the normal path. Confirmed the new perm codes were **absent** on
  staging (0 rows) before applying.

## Pre-deploy evidence (read-only, 2026-06-17T10:42Z)
| Item | Value |
|---|---|
| env / db | **STAGING** (`13-140-159-201.sslip.io`) / `nutrezee` |
| version | **0015** (15 applied) |
| affected-module tables | none (no packing/driver/delivery/meal) |
| `customer_order` rows | 20,104 |
| `customer` rows | 19,476 |
| `permission` rows | 67 |
| **backup** | `pg_dump -Fc` → `/opt/nutrezee/backups/pre-m22-deploy-20260617T105055Z.dump` (18M) |

## Apply
```
docker exec nutrezee-api-1 node /srv/m22mig/migrate.mjs
applied: 0016_wave6_ops_packing.sql, 0017_wave6_ops_delivery.sql, 0018_wave6_meal_history.sql   rc=0
```

## Post-deploy evidence
| Check | Result |
|---|---|
| version | **0018** (18 applied) |
| m22 tables (5) | `legacy_meal_history_raw`, `customer_meal_history`, `customer_meal_history_items`, `customer_meal_history_import_runs`, `customer_meal_history_exceptions` ✅ |
| dedup/constraint indexes | `legacy_meal_history_raw_raw_sha_key`, `cmh_items_no_dup_meal_day`, `customer_meal_history_legacy_order_id_key` ✅ |
| exception reason CHECK | `customer_meal_history_exceptions_reason_check` ✅ |
| FK links on `customer_meal_history` | `_order_id_fkey`, `_customer_id_fkey`, `_import_run_id_fkey` ✅ |
| packing/delivery tables (0016/0017) | 11 ✅ |
| **existing data unchanged** | `customer_order=20104`, `customer=19476` (identical to pre); `permission=82` (67 + 13 packing/delivery + 2 meal_history, additive) ✅ |

**Migration gap risk: NO** — applied in contiguous numeric order 0015→0016→0017→0018.
**Destructive changes: NONE.** **Existing order/packing/delivery/customer data: untouched.**

## Rollback plan (additive ⇒ drop-forward; not executed)
All five m22 tables are new and empty-then-import-only. To roll back the meal-history layer:
`DROP TABLE customer_meal_history_items, customer_meal_history_exceptions, customer_meal_history,
legacy_meal_history_raw, customer_meal_history_import_runs CASCADE;` + delete the 2 `meal_history.*`
permission/role_permission seed rows + delete the `0018` row from `schema_migrations`. The 18M
pre-deploy dump (`pre-m22-deploy-20260617T105055Z.dump`) is the full restore fallback. No order/
customer/packing/delivery data is affected by any rollback.
