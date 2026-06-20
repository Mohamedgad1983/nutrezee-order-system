# 04 — Rollback Plan

**Date:** 2026-06-20

---

## Full rollback (view-only, no business data)

```sql
DROP SCHEMA analytics CASCADE;     -- removes both views; touches no business table
DELETE FROM schema_migrations WHERE filename = '0021_analytics_subscription_expiry.sql';
```

- Reversible and complete: the apply created only the `analytics` schema, two views, and one ledger row. Dropping the schema and removing the ledger row returns staging to its pre-apply state.
- **Zero business-data impact** — no business table was created, altered, or dropped by `0021`.

## What rollback does NOT affect

- `0020` (dish-per-day) — still unapplied either way.
- The customer API/admin expiry fields (shipped in commit `b2cdc28`): the API uses a **customer-scoped query** equivalent to the view, not the global view object, so dropping the views does not break the API. (Re-creating the views via `0021` restores the analytics/reporting interface.)
- The Part D email job: it reads `analytics.customer_subscription_status`; if rolled back, re-apply `0021` before running the job.

## Re-apply

Re-run the supervised apply in [02](02_apply_log.md) (idempotent: `CREATE OR REPLACE VIEW` + `ON CONFLICT DO NOTHING`).
