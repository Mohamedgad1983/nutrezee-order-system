# 05 — Final Status

**Date:** 2026-06-20 · **Result: DONE — `0021` applied to staging; `0020` not applied.**

---

## Outcome

| Item | Status |
|---|---|
| `analytics.order_subscription_periods` live on staging | ✅ |
| `analytics.customer_subscription_status` live on staging | ✅ |
| `0021` recorded in `schema_migrations` | ✅ (only `0021` in `002*`) |
| `0020` (dish-per-day) applied | ❌ **NO** (intentional) |
| dish-per-day tables present | ❌ absent |
| Status counts vs original validation | ✅ identical (no drift) |
| Normal migration runner used | ❌ (avoided — would apply `0020`) |
| Business data mutated | ❌ none |
| Rollback available | ✅ `DROP SCHEMA analytics CASCADE` ([04](04_rollback_plan.md)) |

## Consumers now unblocked

- **Part D** daily expiring-subscription email job reads the view (dry-run produced 54 for 2026-06-23).
- **Hermes** `hermes_ro` can read the views for inspection.
- The customer API/admin expiry fields (commit `b2cdc28`) use a scoped equivalent and are independent of the view object.

## Residual note

A future deliberate `node db/migrate.mjs` would apply `0020` (empty dish tables). Keeping `0020` unapplied remains a human decision; nothing in this work applies or depends on it.
