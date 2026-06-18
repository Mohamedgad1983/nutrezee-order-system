# 06 — AI Skills Blueprint

> Each skill rated against the **actual** data. "Safe now" = buildable read-only from existing reliable
> data without PII exposure or customer-facing risk.

Complexity/Risk/Impact: L/M/H. **Safe now**: ✅ build · 🟡 build limited · ❌ blocked.

| # | Skill | Business value | Available now | Missing | Cx | Risk | Impact | Safe now |
|---|---|---|---|---|---|---|---|---|
| 1 | **Customer 360 Summary** | unified view: orders, cadence, package, payments, recency, exceptions | order/cadence/payment/package/area all present | dish history, feedback | L | L | H | ✅ |
| 2 | **Customer Segmentation** | RFM + package + area + recency cohorts | all RFM inputs present | satisfaction, content | L | L | H | ✅ |
| 3 | **Auto Meal Suggestion** | suggest next plan/meals | package tier + cadence (plan-level) | dish menu mapping, per-day type | M | M | H | 🟡 (plan-level only) |
| 4 | **Meal Repetition Detection** | detect repeated patterns | cadence/date patterns | dish content (true "same meal") | M | L | M | 🟡 (cadence only) |
| 5 | **Churn / Inactivity Risk** | flag likely non-renewers | recency/frequency/end_date/payment | feedback, cancel reason | L | L | H | ✅ |
| 6 | **Package Recommendation** | recommend calorie tier | package history + cohort + area | goals, body metrics | M | M | H | ✅ (tier-level) |
| 7 | **Diet Compliance Assistant** | check meals vs diet/allergy | — | customer allergy/diet + dish nutrition (all empty) | H | **H** | H | ❌ |
| 8 | **Customer Service Copilot** | safe customer summary for staff | order/payment/cadence/exception | dish/feedback | M | M (PII) | H | ✅ (masked, internal) |
| 9 | **Exception Repair Assistant** | suggest *deterministic* repair paths | m22 exceptions + sync_record + MER | — (must stay deterministic) | M | M | M | ✅ (read-only proposals) |
| 10 | **Menu Intelligence** | popular tiers, demand trends | orders/package/area/time | dish-level popularity | L | L | M | ✅ (tier/area/time) |
| 11 | **Driver / Delivery Intelligence** | route/SLA analytics | — | driver/route/delivery-outcome (all empty) | H | M | M | ❌ |
| 12 | **Kitchen Forecasting** | predict meal volume by day/type/package | `fulfillment_day` 527K + package + area | dish-level mix, true delivered | M | M | H | ✅ (volume by day/tier/area) |

## Per-skill detail (the buildable ones)

### 1. Customer 360 Summary — ✅ safe now
- **MVP:** read-only API/view returning, per masked customer: #orders, lifetime value, current/last
  package tier, active-or-lapsed + last end_date, total meal-days (fulfillment), paid/unpaid, open
  exceptions. **Advanced:** add segment label, churn score, recommended next package.
- **Acceptance:** matches raw aggregates for sampled ids; no PII beyond what the staff role may see.

### 2. Customer Segmentation — ✅ safe now
- **MVP:** RFM × package-tier × area × recency → labeled cohorts (doc 04 cohorts). **Advanced:**
  k-means/embedding once more features exist. **Acceptance:** cohort sizes reconcile with doc 04.

### 5. Churn / Inactivity Risk — ✅ safe now
- **MVP:** rule/logistic score from recency (days since last end_date), frequency, payment-paid ratio,
  package loyalty. **Advanced:** survival model once cancel-reason/feedback captured.
- **Acceptance:** back-test on lapsed cohorts (doc 04); precision on "lapsed 0–3 mo" pool.

### 6. Package Recommendation — ✅ tier-level
- **MVP:** "most-likely next tier" from own history + same-area/same-tier cohort popularity.
- **Acceptance:** top-1 tier matches the customer's actual repeat tier for repeat buyers (≥ baseline).

### 12. Kitchen Forecasting — ✅ volume-level
- **MVP:** daily meal-day volume forecast by package tier + area from `fulfillment_day` history (deep
  2024–2026). **Advanced:** dish-level once content captured. **Acceptance:** MAPE on held-out weeks.

### 9. Exception Repair Assistant — ✅ deterministic-only
- **MVP:** for each open `missing_order_link`, surface the deterministic chain status (in `sync_record`?
  in MER with which reason?) and the *safe* next action (await order-sync / manual MER review) — **never**
  propose phone/name linking. Mirrors m22 doc 34 logic. **Acceptance:** 0 fabricated links proposed.

## Blocked skills (and the single blocker)
- **Diet Compliance (7), Driver/Delivery (11), dish-level Meal Suggestion (3)** are blocked by the same
  root cause: **content/nutrition/allergy/delivery-outcome data does not exist** (doc 03/09). No model
  fixes this; only data capture does.
</content>
