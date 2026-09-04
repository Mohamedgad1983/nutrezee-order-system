# 01 — Executive Summary

**Report package:** Extracted-Data Evidence Report
**Date:** 2026-06-20
**Branch:** `migration/legacy-full-clone-reconciliation` · **Head commit:** `1bfd9ca`
**Author role:** Reporting/evidence pass (read-only). No code, no migrations, no production, no scraping.
**Database accessed:** YES — staging only (`nutrezee-postgres-1`, db `nutrezee`), **read-only SELECT/count/metadata queries only**. Counts in this package were **freshly DB-verified on 2026-06-20** (see [09_report_manifest.md](09_report_manifest.md) and [sql/read_only_verification.sql](sql/read_only_verification.sql)).

> **Evidence labels used throughout:** `CONFIRMED` · `PARTIAL` · `BLOCKED` · `NOT VERIFIED` · `RECOMMENDED`.
> **Provenance tags for numbers:** *DB-verified this run* · *previously documented* · *inferred from import/migration evidence* · *not verified*.

---

## 1. The one-paragraph answer

Nutrezee already holds a **reliable customer + order + payment + schedule backbone** extracted from the legacy system and imported into the staging database: ~19,476 customers, 20,104 orders, 11,539 payments, 527,724 daily plan-days, 1,298 products, and a last-90-days meal-day history for 2,628 customers — **all independently DB-verified on 2026-06-20**. This is more than enough to build genuine **Customer Intelligence and Analytics now** (Customer 360, segmentation, churn/win-back, package recommendation, kitchen volume forecasting, menu/demand intelligence). What is **missing is content and outcome data**: the actual dish each customer ate per day, nutrition/macros, allergies/preferences, customer feedback, and real delivery results. Those gaps **block dish-level / nutrition-aware / allergy-safe auto-meal AI** — and that is a *data-capture* problem, not a modelling one. **Recommended next phase: build a read-only Analytics Foundation for Customer 360 + Segmentation + Churn** — not more legacy scraping, not an auto-meal planner.

---

## 2. What data is already extracted and reliable now — `CONFIRMED`

All counts below were **DB-verified this run** (2026-06-20, staging).

| Entity | Count | Trust | Good for |
|---|---|---|---|
| Customers | 19,476 | High | identity, contactability, segmentation |
| Addresses | 9,511 | High (buyers) | geo/area demand |
| Delivery areas | 127 | High | geographic analytics |
| Orders (subscriptions) | 20,104 | High | RFM, value, package behavior |
| Payments | 11,539 | High (paid/unpaid) | revenue, conversion, churn signal |
| Packages (calorie tiers) | 9 (≈5 in real use) | High | tier/diet-proxy analytics |
| Fulfillment days (plan-days) | 527,724 | High (cadence) | cadence, kitchen volume forecast |
| Products / catalog | 1,298 | Medium | menu master (names only) |
| Sync map (legacy↔new) | 52,423 | High | traceability/idempotency |
| Meal-day history (last-90) | 67,908 items / 2,628 customers | Medium (dates only) | cadence corroboration |

**Bottom line on the backbone:** *who* bought *which package*, *when*, *for how much*, *where*, and *how often* is trustworthy and queryable today.

---

## 3. What is partial — `PARTIAL`

- **Meal-day history (m22):** dates are captured and reconciled, but the **dish content is null** (`meal_name`/`meal_ref`/`meal_type` empty). It tells you a customer had a plan-day on a date, not what they ate. `fulfillment_day` (527,724 rows) is the better cadence source.
- **Full-history meal scrape:** last-90 is complete; **last-year (13,453 candidates) is NOT confirmed complete** from repository evidence — it was started and resumable, never reconciled in DB.
- **Order completeness:** the imported orders are referentially sound, but legacy reconciliation closed at **`NOT_VERIFIED_WITH_MISMATCHES`** (later `STORED_WITH_ACCEPTED_EXCEPTIONS`) — historical order shortfall and 77 unlinked meal-history exceptions remain.
- **Operational modules (packing m20, driver/area m21):** schema + API + UI are **built and tested**, but hold **no migrated legacy data** — they are forward-capture foundations, not a data source.

---

## 4. What is blocked — `BLOCKED`

- **Dish-per-customer-per-day (m23):** the legacy system **does not expose a safe read-only "saved dish" source**. The per-day grid is an *editor* whose dropdowns are ajax-loaded catalog options; **0 of 40 sampled files contained an actual selected dish**. Migration 0020 + parser + scraper were **built but deliberately NOT applied to staging** because there is no usable dish data to import (**DB-verified: dish tables absent, schema head = 0019**).
- **Delivery outcome:** every one of the 527,724 fulfillment days is status `scheduled` (**DB-verified: 100%**). There is **no delivered/skipped/failed/rescheduled** signal anywhere.
- **Nutrition / allergies / preferences / feedback:** not captured at source; the relevant tables are empty.

---

## 5. What Nutrezee can build now — `RECOMMENDED`

Safe, high-value, zero-new-capture, read-only:

1. **Customer 360** (unified internal view, PII masked)
2. **Customer Segmentation** (RFM + package tier + area + recency)
3. **Churn / Win-back scoring** (recency/frequency/payment)
4. **Package (tier) Recommendation** (cohort-based)
5. **Kitchen Volume Forecast** (from 527K-row schedule)
6. **Menu / Demand Intelligence** (package/area/time level)
7. **Masked Service Copilot** (internal staff summary)
8. **Exception Repair Assistant** (deterministic, read-only proposals)

---

## 6. What Nutrezee must NOT claim yet — `BLOCKED`

Do **not** market or build as "ready":

- ❌ True dish-level **auto meal planner**
- ❌ **Nutrition-aware** recommendation
- ❌ **Allergy-safe** automation / diet-compliance
- ❌ Dish **preference / like-dislike / substitution** intelligence
- ❌ **Delivery / driver** performance analytics (no outcome data)

These are blocked by **missing data, not by technology**. No model compensates for data that was never captured. Claiming readiness here would be unsafe (allergy automation especially).

---

## 7. Final recommendation

> **Proceed to an "Analytics Foundation for Customer 360 + Segmentation + Churn/Win-back" phase.**
> Build read-only `analytics.*` views/materializations over the already-trusted backbone (customer, customer_order, payment_record, fulfillment_day). Deliver internal, PII-masked Customer Intelligence. **Do not** scrape dish data, **do not** build an auto-meal planner, **do not** turn on messaging/timers. In parallel, treat **forward dish-per-day capture** (assign the real dish per slot at order/kitchen time) as the single keystone that later unlocks dish-level AI — captured in the new system, never back-filled by inference.

See [08_next_phase_execution_plan.md](08_next_phase_execution_plan.md) for the concrete plan, and [05_ai_readiness_report.md](05_ai_readiness_report.md) for the readiness assessment (auto-meal readiness today ≈ **27/100**, gated entirely by content/outcome gaps).
