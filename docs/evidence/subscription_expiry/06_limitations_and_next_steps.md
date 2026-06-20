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

## Staging apply — DEFERRED (explain clearly)

The migration is **additive and proven to apply cleanly** (applied inside a transaction on staging and rolled back; [04](04_validation_report.md)). It was **not persisted to staging** in this pass because:

- The migrate runner (`app/db/migrate.mjs`) applies **all pending migrations in filename order**. Staging head is `0019`; running it would apply **`0020_wave7_dish_per_day.sql` first** — the dish-per-day foundation that was **deliberately not applied** (no dish data exists). Applying `0021` via the standard runner therefore can't be done without also applying `0020`, which is out of scope and contradicts a prior deliberate decision.
- Changing the migration ledger out-of-order (apply `0021` only, leave `0020` pending) is a **migration-governance decision for a human**, not an autonomous one, and there is no confirmed staging backup step in this pass.

**The urgent business value is delivered regardless:** the expiry logic + per-customer validated counts are produced now ([04](04_validation_report.md)), and the durable migration is committed.

### Safe apply options (human decision)

| Option | Command (staging) | Effect |
|---|---|---|
| **A. Apply 0021 only, as a read overlay** | `psql … -f 0021_analytics_subscription_expiry.sql` then record it: `INSERT INTO schema_migrations(filename) VALUES ('0021_analytics_subscription_expiry.sql')` | Views live; `0020` stays pending (ledger non-contiguous but valid — runner checks per-file). Idempotent DDL, safe to re-run. |
| **B. Apply 0020 + 0021 together via the runner** | `DATABASE_URL=… node db/migrate.mjs` | Both apply; creates **empty** dish-per-day tables (0020) + the views. Only if creating empty m23 tables on staging is acceptable. |
| **C. Defer entirely** | — | Re-run the validated SELECTs ([sql/read_only_validation.sql](sql/read_only_validation.sql) inline block) on demand until a controlled apply window. |

Recommended: **Option A** in a supervised window (take a DB snapshot first per the environment plan), since it delivers live views without forcing the 0020 decision. Whoever applies should confirm the backup convention in `16_Deployment/environment_plan.md`.

## Next steps

1. **Apply `0021` to staging** (Option A) in a supervised window with a snapshot.
2. **Optional stricter variant:** if the business confirms `cancelled`/`rejected` should be excluded from "current subscription," add `analytics.customer_subscription_status_strict` (same logic, `WHERE order_status NOT IN ('cancelled','rejected')`) as an **additional** view — keep the permissive one for completeness.
3. **Surface in the admin API/UI** ([05](05_admin_usage.md)) as a follow-up WP once views are live.
4. **Materialize if needed:** if read latency over 527K fulfillment rows matters, promote `order_subscription_periods` to a materialized view with a **manual, idempotent** refresh (no timer/cron).
5. **Revisit when delivery outcome is captured:** once `fulfillment_day.status` carries real outcomes, add a delivery-completion view distinct from this entitlement view.

## Guardrails honored

Additive only · no business table mutated · read-only · no PII · no phone/name matching · no fabricated links · no production write · **no timers enabled** · dish-per-day not required and not used.
