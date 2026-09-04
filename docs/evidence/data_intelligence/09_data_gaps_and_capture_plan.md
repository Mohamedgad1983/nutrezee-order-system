# 09 — Data Gaps & Forward Capture Plan

> What must be captured going forward to unlock content-aware and operational AI. Ordered by AI value ÷
> capture effort. **Nothing here is retroactive** — it changes how the new system records data from now on.

| gap | why it matters | where to capture | who enters | validation | privacy | AI value |
|---|---|---|---|---|---|---|
| **Dish chosen per day** (link `fulfillment_day`/order-day → `product`) | the #1 unlock — turns cadence into *content*; enables real meal history, repetition, recommendation | order builder / daily menu assignment in the new ops flow | kitchen/ops (menu plan) | product must be active; one dish per slot/day | P1 | **very high** (Levels 3–4) |
| **Delivery outcome** (delivered / skipped / failed / rescheduled) per `fulfillment_day` | unlocks delivery quality, churn cause, kitchen accuracy | driver/delivery app or ops close-out | driver/ops | status ∈ enum; timestamp; reason on non-delivery | P1 | high |
| **Customer diet restrictions / allergies** (`customer_allergy`, `diet_status`) | safety-critical; gates allergy-safe automation | onboarding/profile form | customer + staff confirm | allergen ∈ ref list; explicit consent | **P2 health** | high (Level 4 safety) |
| **Nutrition / macros per dish** (`nutrition_facts`, `product_*`) | nutrition-aware planning; honest calorie claims | menu/recipe master | kitchen/nutritionist | calories/macros numeric, ranges sane | P0 | high |
| **Customer feedback / rating** (per meal or per plan) | satisfaction, churn signal, dislike detection | post-delivery prompt / support | customer | rating 1–5; optional text (PII-scan) | P1 | high |
| **Skips / substitutions / dislikes** | personalization + waste reduction | customer self-service / support | customer/staff | reason enum; dish ref | P1 | high |
| **Renewal / cancellation reason** (`reason_code` on order status) | churn modelling, win-back targeting | order status transition | staff/customer | reason ∈ `reason_code` | P1 | high |
| **Package goal / body metrics** (weight goal, target calories) | personalized tier recommendation | onboarding | customer | numeric, plausible | **P2 health** | medium-high |
| **Inventory constraints** (stock per dish/day) | feasibility for auto planner | kitchen inventory system | kitchen | non-negative; per day | P0 | medium (Level 4) |
| **Chef / kitchen capacity** (capacity per section/day) | production-aware planning | kitchen ops | kitchen mgr | numeric per section/day | P0 | medium (Level 4) |
| **Area / branch service quality** (on-time %, complaints) | geo SLA, routing | delivery outcomes (derived) | system-derived | from delivery outcome | P0 | medium |
| **Customer lifecycle status** (active/paused/churned) | today `status` is 100% `active` | derive from recency OR explicit state machine | system/staff | enum; transition rules | P1 | medium |
| **Meal-type per day** (Lunch/Dinner/… actually delivered) | true meal-type mix | menu assignment | ops | type ∈ `meal_type` | P1 | medium |

## Capture principles
- **Capture at the operational moment** (menu assignment, delivery close-out, onboarding, post-delivery)
  — not via back-scraping the legacy site (out of scope, and legacy lacks most of it anyway).
- **Reference-data first:** populate the menu/nutrition/allergen masters before per-customer capture, so
  every captured dish/allergy resolves to a controlled id (no free-text guessing).
- **Privacy:** health fields (allergy, diet, body metrics) are **P2** — explicit consent, masked at
  serialization, never exported. Feedback text must pass a PII scan before storage.
- **The dish link is the keystone:** capturing "which dish, which day, which customer" alone moves
  auto-meal readiness from ~27 toward ~60 and unlocks Levels 3–4 over time.
</content>
