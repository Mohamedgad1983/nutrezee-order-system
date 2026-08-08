# 06 — Limitations & Next Steps

**Date:** 2026-06-20

---

## Limitations (be honest about these)

1. **Entitlement, not delivery.** Expiry is the **scheduled** service end (`MAX(fulfillment_day.date)`). Delivery outcome is **not captured** — `fulfillment_day.status` is uniformly `scheduled` (DB-verified 527,724/527,724). We cannot say a scheduled day was actually delivered, skipped, or failed. "Expired" means the schedule has ended, not that service was completed.

2. **Cancelled/rejected orders can be the "latest" subscription.** No status exclusion is applied (per the don't-over-filter rule). So a customer whose newest order is `cancelled`/`rejected` but still carries far-future scheduled days will show that order as their current subscription. **Surfaced** via `source_confidence = 'low'`: of 694 active picks, 187 are `low`; of 290 expiring_soon, 90 are `low` ([04](04_validation_report.md) §G). Consumers wanting only genuine live subscriptions can filter `source_confidence = 'high'`.

3. **Multiple active periods.** 303 customers have >1 subscription period active today (overlapping orders). The customer-level row reports one "current" pick (latest expire) plus `active_subscription_count` so the overlap is visible.

4. **Off-days not modelled.** `customer_order.off_days` is empty in the data; expiry is the literal MAX scheduled date and does not reason about skipped weekdays within the window.

5. **No dish / nutrition / preference dependency.** Correct and intended — but it also means this view says nothing about *what* the customer receives, only *until when* they are scheduled.

6. **`unknown` = 11,573 customers** have no orders/scheduled days (non-buyer leads). Expected, not an error.

## Staging apply — DONE (Option A: 0021 only)

On 2026-06-20, migration **`0021` was applied to staging** (Option A) on explicit instruction, **without** applying `0020`:

- Applied atomically: `BEGIN; <0021 DDL>; INSERT INTO schema_migrations(filename) VALUES ('0021_analytics_subscription_expiry.sql') ON CONFLICT DO NOTHING; COMMIT;` — piping the exact committed file.
- **Verified post-apply (DB):** both views present; `schema_migrations` `002*` rows = **only `0021`** (so **`0020` remains unapplied**); dish-per-day tables still absent (`to_regclass` NULL); counts match validation exactly (7,903 with expiry; 694 active; 290 expiring_soon; 6,904 expired; 15 future; 11,573 unknown).
- The migrate runner (`app/db/migrate.mjs`) checks `schema_migrations` per-file, so the ledger being non-contiguous (`0021` present, `0020` absent) is valid; a **future** `node db/migrate.mjs` run would still apply `0020` (empty dish tables) — that decision stays with a human.

**Rollback (fully reversible — view-only, no business data):**
```
DROP SCHEMA analytics CASCADE;
DELETE FROM schema_migrations WHERE filename = '0021_analytics_subscription_expiry.sql';
```
No DB snapshot was required because the change is additive views + one ledger row, with the trivial rollback above.

## Next steps

1. ✅ **Done — `0021` applied to staging** (Option A; see above).
2. ✅ **Done — expiry fields added to the customer list/profile API + admin UI** ([05](05_admin_usage.md)). **Remaining:** rebuild + deploy the API/admin images to staging (gated behind `STAGING_DEPLOY_ENABLED`) so the running endpoints serve the new shape; add a Playwright e2e once deployed.
3. **Optional stricter variant:** if the business confirms `cancelled`/`rejected` should be excluded from "current subscription," add `analytics.customer_subscription_status_strict` (same logic, `WHERE order_status NOT IN ('cancelled','rejected')`) as an **additional** view — keep the permissive one for completeness.
4. **Materialize if needed:** if read latency over 527K fulfillment rows matters for reporting use of the global view, promote `order_subscription_periods` to a materialized view with a **manual, idempotent** refresh (no timer/cron). (The API already avoids the global view via a scoped query.)
5. **Revisit when delivery outcome is captured:** once `fulfillment_day.status` carries real outcomes, add a delivery-completion view distinct from this entitlement view.

## Guardrails honored

Additive only · no business table mutated · read-only · no PII · no phone/name matching · no fabricated links · no production write · **no timers enabled** · dish-per-day not required and not used.
