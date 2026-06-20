# 01 — Business Rule: Subscription Expiry

**Date:** 2026-06-20 · **Branch:** `migration/legacy-full-clone-reconciliation` · **Status:** implemented (additive, validated; staging apply deferred — see [06](06_limitations_and_next_steps.md)).

---

## The rule (confirmed)

> A customer's subscription expiry date is derived from the **scheduled service/meal fulfillment days**, not from payment date, order created date, package name, or dish data.

- **Source of truth:** `fulfillment_day` — the per-day scheduled service rows for each order.
- **Per order:**
  - `subscription_start_date  = MIN(fulfillment_day.date)`
  - `subscription_expire_date = MAX(fulfillment_day.date)`
- **Per customer:** the **current/latest subscription** is the order with the **latest `subscription_expire_date`** (tie-breaker below). No status exclusion is applied (see "Status handling").

## What expiry means here — and what it does NOT mean

- ✅ Expiry = **entitlement / service-schedule expiry** — the last day the customer is scheduled to receive service under that order.
- ❌ Expiry is **NOT confirmed delivery completion.** Delivery outcome is **not available**: every `fulfillment_day` row is status `scheduled` (DB-verified — 527,724/527,724). There is no `delivered`/`skipped`/`failed` signal, so we cannot say a scheduled day was actually fulfilled.
- ❌ **Payment date is not used** as an expiry source.
- ❌ **Order created date is not used.**
- ❌ **Package name / duration is not used** to compute expiry (we use the actual scheduled days, not the package's nominal `duration_days`).
- ❌ **Dish-per-day data is not required and not used** — subscription expiry is independent of dish content (which is unavailable; see the m23 blocker report).

## "Today" anchor (timezone assumption)

The business date is **`(now() AT TIME ZONE 'Asia/Kuwait')::date`**. Kuwait is **UTC+3 year-round (no DST)**, so this is deterministic regardless of the database server's session timezone. On 2026-06-20 the Kuwait business date and the staging DB `CURRENT_DATE` agreed (both `2026-06-20`); the explicit Kuwait anchor is used so the result does not silently depend on server tz. *(DB-verified this run.)*

## Status handling (no over-filtering)

`customer_order.status` ∈ `{draft, pending_review, approved, active, paused, completed, expired, cancelled, rejected}`.

- We **do not exclude** any order by status when computing periods or selecting the customer's latest subscription. The business instruction is to avoid over-filtering when status meaning is not certain to be exclusionary.
- Instead, status is **carried through** (`order_status`) and a `source_confidence` flag downgrades orders in a `cancelled`/`rejected` state to `'low'`, so consumers can choose to ignore them without the data being silently dropped.
- **Known consequence (documented):** a `cancelled`/`rejected` order with far-future scheduled days can become a customer's "latest" subscription. This is surfaced, not hidden — see [04](04_validation_report.md) §G and [06](06_limitations_and_next_steps.md).

## Tie-breaker (per-customer selection)

When two orders tie on `subscription_expire_date`, select by:
1. `subscription_expire_date` DESC, then
2. `customer_order.created_at` DESC (NULLS LAST), then
3. `order_id` DESC.

`current_order_id` and `latest_order_id` are **equal by construction** (both are the latest-expire order); both are exposed for consumer convenience.

## Constraints honored

No PII used or exposed (only surrogate `customer_id`, dates, counts, status labels). No phone/name/address matching. No fabricated customer/order links. Additive, read-only. No production touched. No timers.
