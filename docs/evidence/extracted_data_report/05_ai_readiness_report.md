# 05 — AI Readiness Report

**Date:** 2026-06-20 · **Basis:** existing extracted/imported data only (no new capture).
**Verification:** the data the assessment depends on (customer/order/payment/fulfillment counts, 100%-`scheduled` fulfillment, absent dish tables) was **DB-verified this run**. The readiness score and skill classifications are **previously documented** in `docs/evidence/data_intelligence/` (cited inline).

---

## 1. Readiness score & reasoning

| Dimension | Score (0–100) | Reason |
|---|---|---|
| Customer-history readiness | 65 | Strong order/cadence/package/recency/value; no dish content |
| Meal-metadata readiness | 15 | Products are names only — no type/price/tags/recipe |
| Dietary-restriction readiness | 5 | Allergen reference only; **no** customer or product mappings |
| Feedback readiness | 0 | None captured |
| Nutrition/macros readiness | 10 | Package-name calorie ranges only; no per-meal macros |
| Recommendation explainability | 40 | Can justify by package/cadence/area/recency; not by dish/nutrition |
| Operational-safety readiness | 25 | No delivery outcome, inventory, capacity, or allergy safety net |
| **Overall (weighted)** | **≈ 27 / 100** | Gated by content/dietary/feedback/nutrition/outcome gaps |

*(Source: `data_intelligence/05_auto_meal_readiness.md`.)*

**Why 27 and not higher:** the **behavioral** layer is genuinely strong (orders, payments, cadence, package tier, geography — all DB-verified present and reliable), but every **content/outcome** layer is empty or unreliable. Auto-meal as a *dish/nutrition* product is blocked by missing data, not by modelling. As a *package/cadence* product it is partially feasible today.

**What would move the number:** capturing **dish-per-day** alone moves readiness from ~27 toward ~55–65; adding delivery outcome, nutrition master, allergy/diet profiles, and feedback is what reaches production-grade personalization *(`data_intelligence/09,10`; `dish_per_day/11`)*.

---

## 2. Safe AI features now — `RECOMMENDED`

All eight rely only on DB-verified, reliable tables (`customer`, `customer_order`, `payment_record`, `fulfillment_day`, `package`, `address`/`area`). All are read-only and PII-masked. *(Source: `data_intelligence/06,10,11`.)*

| # | Feature | Why it's safe now | Inputs (all present) |
|---|---|---|---|
| 1 | **Customer 360** | Unified internal view; no inference of missing data | order/cadence/payment/package/exceptions |
| 2 | **Customer Segmentation** | RFM + tier + area + recency from reliable fields | customer_order, payment_record, fulfillment_day |
| 3 | **Churn / Win-back scoring** | Recency/frequency/end-date/payment all present | customer_order, payment_record |
| 4 | **Package (tier) Recommendation** | Cohort + package history; tier-level only | customer_order, package |
| 5 | **Kitchen Volume Forecast** | 527,724-row schedule → volume by day/tier/area | fulfillment_day, customer_order, package |
| 6 | **Menu / Demand Intelligence** | Tier/area/time demand (not dish-level) | customer_order, package, area |
| 7 | **Masked Service Copilot** | Internal staff summary from safe fields | order/payment/cadence/exception |
| 8 | **Exception Repair Assistant** | Deterministic, read-only repair *proposals* | exceptions, sync_record, MER |

**Framing rule:** Feature 4 is **tier-level**, Feature 5/6 are **volume/demand level** — none are dish-personalized. Market them honestly.

---

## 3. Blocked AI features — `BLOCKED`

Do **not** build or claim these from existing data:

| Feature | Blocking gap (DB-confirmed where noted) |
|---|---|
| **True dish-level auto meal planner** | No per-customer dish assignment (dish tables absent — DB-verified; 0/40 legacy files) |
| **Nutrition-aware recommendation** | No per-dish nutrition/macros (catalog is names only) |
| **Allergy-safe recommendation / diet compliance** | No customer allergy/diet profiles; no product allergen mapping (**safety-critical**) |
| **Dish preference inference** | No dish content or selection history to infer from |
| **Dislike / substitution intelligence** | No likes/dislikes/skips/substitutions captured |
| **Delivery / driver intelligence** | `fulfillment_day` is 100% `scheduled` (DB-verified) — no real outcome; driver/route/packing data empty |

**Allergy automation is the highest-risk item** — never ship without captured allergy/diet data plus a dedicated safety review.

---

## 4. Recommended first AI MVP — `RECOMMENDED`

> **Customer 360 + Segmentation + Churn/Win-back**, delivered as **read-only internal tools** with PII masked to staff role.

### Why this MVP is realistic now

- **All inputs are DB-verified present and reliable:** 19,476 customers, 20,104 orders, 11,539 payments, 527,724 plan-days — referentially sound (0 orphans documented in reconciliation).
- **Zero new capture, zero new risk:** no dependence on dish/nutrition/allergy/feedback/outcome data.
- **Immediate business value:** ~1,602 customers lapsed within 3 months (hot win-back), 1,027 currently active (renewal-before-expiry), 1,004 high-value loyalists (5+ orders), 11,573 non-buyer leads — all derivable today *(`data_intelligence/04`)*.
- **Compounding value:** the `analytics.customer_features` / `package_behavior_summary` views this MVP needs are the **same views every later AI skill reuses** — so it is also the foundation step *(`data_intelligence/07,10`)*.
- **Acceptance is checkable:** cohort sizes must reconcile with `data_intelligence/03–04`; all outputs masked; no per-customer sensitive export.

### Why NOT start elsewhere

- Dish-level / nutrition / allergy AI → **blocked** (no data; unsafe to fake).
- Auto-meal planner → **blocked** (needs dish + nutrition + inventory + capacity).
- Delivery/driver analytics → **blocked** (no outcome data).
- More legacy scraping → **wrong direction** (legacy has no retrievable dish content; capture forward instead).

---

## 5. Staged AI vision (for context, not this phase)

1. **Now:** behavioral layer (this MVP) — real value, zero capture, low risk.
2. **Next:** as **dish-per-day capture** + delivery outcome + `reason_code` accrue → plan-level auto-suggestion (Level 1–2), basic delivery quality, churn-cause insight.
3. **Later (gated):** personalized dish recommendation, nutrition-aware planning, allergy-safe automation — only once captured data exists and passes a safety review.

*(Source: `data_intelligence/10_ai_data_roadmap.md`.)*

**Headline:** readiness today is **≈27/100**; the path forward is **capture, then model** — never model around missing data.
