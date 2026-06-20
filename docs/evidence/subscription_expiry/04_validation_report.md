# 04 — Validation Report

**Date:** 2026-06-20 · **DB:** staging `nutrezee-postgres-1` (db `nutrezee`), **read-only**.
**Method:** the exact migration DDL was applied inside a single transaction, all validation queries were run against the **real view objects**, then the transaction was **ROLLED BACK** — staging is byte-for-byte unchanged (`to_regclass('analytics.customer_subscription_status')` returned **NULL** after rollback). This simultaneously proves the migration **applies cleanly against the live schema** and produces validation counts from the actual view definitions.

**Business date this run:** Kuwait `2026-06-20` (= staging `CURRENT_DATE` `2026-06-20`).

> All counts below are **DB-verified in this run (2026-06-20)**.

---

## Migration apply check — PASS

```
BEGIN → CREATE SCHEMA → CREATE VIEW → CREATE VIEW   (all succeeded, no errors)
… validation queries ran against analytics.* …
ROLLBACK → analytics.customer_subscription_status = NULL (gone)
```
The DDL is valid against the real `fulfillment_day` / `customer_order` / `package` / `customer` schema. CI (Postgres 16, 8-suite matrix with `freshDb()` re-running all migrations) will exercise `0021` end-to-end on push.

## Customer-level status distribution

| subscription_status | customers |
|---|---|
| unknown | 11,573 |
| expired | 6,904 |
| active | 694 |
| expiring_soon | 290 |
| future | 15 |
| **total** | **19,476** |

## Required counts

| Metric | Value |
|---|---|
| Total customers | 19,476 |
| Customers **with** subscription expiry (`current_order_id` not null) | 7,903 |
| Customers **without** fulfillment days (`unknown`) | 11,573 |
| Active customers | 694 |
| Expiring in ≤7 days (`expiring_soon`) | 290 |
| Expired customers | 6,904 |
| Future subscriptions | 15 |

**Reconciliation:** `7,903 (with expiry) + 11,573 (without) = 19,476` ✓ · `6,904 + 694 + 290 + 15 = 7,903` ✓.
Note: `7,903` equals the independently documented "buyers" count (`data_intelligence/04`) — every customer with an order has scheduled days.

## Order-level coverage

| Metric | Value |
|---|---|
| Orders with a derived period (`order_subscription_periods`) | 20,104 |
| Distinct orders in `fulfillment_day` | 20,104 |
| Total `customer_order` rows | 20,104 |

→ **Every order has scheduled fulfillment days**; no order is missing a period.

## Integrity checks

| Check | Result | Verdict |
|---|---|---|
| Null start/expire dates | 0 | PASS |
| `start_date > expire_date` | 0 | PASS (guaranteed by MIN ≤ MAX) |
| Customers with >1 **active** subscription period | 303 | FLAG (expected; see below) |

## Status-quality of non-expired picks (cancelled/rejected influence)

Because no status exclusion is applied, some customers' "latest" pick is a `cancelled`/`rejected` order (`source_confidence = 'low'`):

| subscription_status | source_confidence | customers |
|---|---|---|
| active | high | 507 |
| active | low | 187 |
| expiring_soon | high | 200 |
| expiring_soon | low | 90 |
| future | high | 5 |
| future | low | 10 |

→ Of 694 active picks, **187 (27%) come from cancelled/rejected orders**; of 290 expiring_soon, **90 (31%)**. These are **surfaced, not dropped** — a consumer wanting only genuine live subscriptions can filter `source_confidence = 'high'` (e.g. active-high = 507, expiring_soon-high = 200). See [06](06_limitations_and_next_steps.md) for the optional stricter variant.

## Top 20 masked examples (customer_id only — no PII)

Ordered by latest expire date. `customer_id` is a system surrogate (ULID-style), not PII.

| customer_id | status | start | expire | days_remaining | confidence |
|---|---|---|---|---|---|
| 01KV4CKFV1ECHYX8KKFQN8M4BT | active | 2026-05-02 | 2027-04-27 | 311 | low |
| 01KV4CN8SQBECACVQK9TW73TFK | future | 2027-03-04 | 2027-04-03 | 287 | low |
| 01KV4CN9C5K29MR6C58TXGKAV3 | future | 2027-02-27 | 2027-03-28 | 281 | low |
| 01KV4CPN2X1JCVP5DHM1N4XGM8 | future | 2026-11-17 | 2026-12-14 | 177 | low |
| 01KV4CS7Y9GQX2AEXT9MVP5P6R | future | 2026-11-15 | 2026-12-14 | 177 | low |
| 01KV4CR6YEX4SEXMB3BVARC8MD | active | 2026-06-02 | 2026-10-17 | 119 | high |
| 01KV4CJE184FBA0J2NDAF8A809 | active | 2026-06-13 | 2026-09-12 | 84 | high |
| 01KV4CF863GHY8JFGBBQ0E3TBF | active | 2026-05-20 | 2026-09-01 | 73 | high |
| 01KV4CCJ71K344QFBHJQX1FK0H | active | 2026-06-01 | 2026-08-30 | 71 | high |
| 01KV4CD2RBVM2WVNRBMXN9D5KS | active | 2026-06-01 | 2026-08-30 | 71 | low |
| 01KV4CFKK73W0MJ8HC95EB9007 | active | 2026-06-01 | 2026-08-30 | 71 | high |
| 01KV4CS5JD2A15QFVQFWKJ0MPW | active | 2026-06-06 | 2026-08-30 | 71 | high |
| 01KV4CNQWDQACZQJ7B4N4ZGE5K | active | 2026-05-30 | 2026-08-27 | 68 | high |
| 01KV4CHJKVQENYWTCX409SK4SG | active | 2026-05-27 | 2026-08-25 | 66 | high |
| 01KV4CCN8N91WMM8JFBVMQF5DS | active | 2026-05-25 | 2026-08-23 | 64 | high |
| 01KV4CJ11NF9Z5Z2NJJ12434ES | active | 2026-05-18 | 2026-08-19 | 60 | high |
| 01KV4CD14S13JBE16F8DVTSG0T | active | 2026-05-16 | 2026-08-17 | 58 | high |
| 01KV4CM6WDECX7KRP3MTBVZFPF | active | 2026-05-19 | 2026-08-17 | 58 | low |
| 01KV4CFRF0Z76B6D408FQDQSHN | active | 2026-05-17 | 2026-08-14 | 55 | high |
| 01KV4CEFBT4Z8T8AGE2D5T1Z5W | active | 2026-05-06 | 2026-08-12 | 53 | high |

## Conclusion

The expiry logic is correct, integrity-clean (0 invalid ranges), and fully reconciled against totals. The only quality nuance — cancelled/rejected orders appearing as some customers' latest subscription — is **made visible** via `source_confidence`, exactly as the "don't over-filter, surface status" rule requires. Validation **PASSES**.
