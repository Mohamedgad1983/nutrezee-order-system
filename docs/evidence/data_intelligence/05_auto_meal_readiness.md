# 05 — Auto-Meal Readiness Assessment

> **The core business question: can the current data drive auto meal recommendations?**
> **Answer: only at the PACKAGE/CADENCE level, not the DISH/NUTRITION level.** Overall readiness
> **≈ 27/100.** Dish-personalized and nutrition/allergy-aware planning are **blocked by missing data**,
> not by modelling.

## Can we know …? (field availability)
| question | status | evidence |
|---|---|---|
| What **meals/dishes** a customer received | ❌ missing | `meal_name`/`meal_ref` null; `order_item`≈empty; `product` not linked to orders |
| **Meal type** by day | 🟡 unreliable | only Lunch/Dinner exist; item `meal_type` null; parent `["breakfast","snack"]` is a scrape artifact |
| **Package / diet tier** | ✅ available | `customer_order.package_*` — calorie/macro tiers, 98.5% coverage |
| **Restrictions / allergies** | ❌ missing | `customer_allergy`=0; allergen ref only |
| **Repeated patterns** | 🟡 partial | cadence/dates yes (`fulfillment_day`); content no |
| **Disliked / rejected meals** | ❌ missing | not captured |
| **Skipped / replaced meals** | ❌ missing | `fulfillment_day.status` 100% scheduled; no skip/sub |
| **Nutrition / macros** | 🟡 partial | only package-name calorie ranges; no per-meal facts (`nutrition_facts`=1) |
| **Delivery success / failure** | ❌ missing | no delivery outcome captured |
| **Customer feedback** | ❌ missing | no ratings/feedback table populated |
| **Branch / area effect** | ✅ available | `delivery_area_frozen` (113 areas), `address.area_id` |

## Readiness sub-scores (0–100)
| dimension | score | why |
|---|---|---|
| Customer history readiness | **65** | strong order/cadence/package/recency/value history; no dish content |
| Meal metadata readiness | **15** | products are names only — no type/price/tags/recipe |
| Dietary restriction readiness | **5** | allergen reference exists; **no** customer or product mappings |
| Feedback readiness | **0** | none captured |
| Nutrition / macros readiness | **10** | package-name calorie ranges only; no per-meal macros |
| Recommendation explainability | **40** | can justify by package/cadence/area/recency; not by dish/nutrition |
| Operational safety readiness | **25** | no delivery outcome, inventory, chef capacity, or allergy safety net |
| **Overall (weighted)** | **≈ 27 / 100** | gated by content/dietary/feedback/nutrition gaps |

## Auto-meal levels
### Level 1 — Rule-based suggestions · **PARTIALLY READY (package/cadence, not dish)**
- required: package tier, meal-type slots, cadence/repeat history, menu→slot mapping.
- have: package tier (✅), cadence (`fulfillment_day` ✅), Lunch/Dinner slots (🟡).
- missing: dish menu mapped to slots; reliable per-day meal-type.
- **next step:** can ship a "renew/continue your plan" suggester now (package tier + usual weekly cadence
  + active menu list), explicitly **not** dish-personalized. Honest framing required.

### Level 2 — Similar-customer recommendations · **READY (behavioral, not content)**
- required: customer cohorts + similarity features.
- have: RFM, package tier, area, frequency, recency, value — all derivable now (doc 04/07).
- missing: content-based similarity.
- **next step:** package/plan recommendation via "customers like you in your area/tier chose X" — safe to
  build now as a non-content recommender.

### Level 3 — Personalized **dish** prediction · **BLOCKED**
- required: per-customer **dish-level** history + accept/reject signal.
- have: none (content absent).
- **next step:** capture per-day chosen dish + accept/skip/substitute (doc 09) before any attempt.

### Level 4 — Full AI auto meal planner · **BLOCKED**
- required: nutrition/macros, allergies/diet, dislikes, inventory, chef capacity, delivery constraints.
- have: package calorie ranges only; everything else absent.
- **next step:** build the menu/nutrition/allergy master + capture preferences + operational feeds first
  (doc 09/10). This is a multi-quarter data-capture program, not a modelling task.

## Bottom line
Auto-meal **is feasible today only as package-tier + cadence rule suggestions and behavioral
plan recommendations** (Levels 1–2, package-level). **True dish personalization and nutrition/
allergy-safe planning (Levels 3–4) are blocked** until Nutrezee captures dish-level history, dietary
profiles, nutrition facts, feedback, and delivery outcomes (doc 09). The safest, highest-value first
move is to ship the behavioral layer (segmentation, renewal/churn, package recommendation, Customer 360)
while standing up dish/nutrition capture in parallel.
</content>
