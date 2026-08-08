# 27 — Meal / Package Fulfillment Foundation (MODEL / DESIGN ONLY)

> **Status:** 🟨 **DESIGN ONLY — no schema built, no data migrated.** This doc defines the future
> meal/package fulfillment model and draws the in-scope / out-of-scope line. Per the mission:
> *do not backfill the ~500k legacy ajax meal-day records now; do not block packing or driver on
> per-day legacy meal details.* Packing (doc 26) and driver (doc 28) are deliberately built to need
> **none** of this.

---

## 1. Why this is design-only

Per-day meal line items live in the legacy admin behind secondary ajax
(`/orders/getMealsDateWiseFilter/all/<id>`) — ~500k requests to scrape across all orders, and it is
arguably **kitchen/fulfillment-domain data, not the subscription `order_item`** (README, doc 13).
The current operational foundation (sync → packing → driver) runs entirely on data we already store:
the package name and the **per-order frozen delivery fields** (method/time/area, docs 14/17/18).
So we model the meal layer now and build it when a kitchen-tablet WP needs it — not before.

---

## 2. Concepts

| Concept | Meaning |
|---|---|
| **package** | a subscription plan (already in catalog: `package`) |
| **product / meal** | a concrete dish (already in catalog: `product`) |
| **meal type** | breakfast / lunch / dinner / snack (already in catalog: `meal_type`) |
| **package day** | the template of meals a package serves on day N |
| **meal schedule** | the per-order, per-date realization of the package days |
| **substitution** | a swap (allergy/availability) of one meal for another on a date |
| **allergy restriction** | customer allergens (already in `customer_allergy`) that constrain meals |
| **kitchen section / chef** | where/who prepares a meal (sections exist: `section_master`, `routing_rule`) |
| **packing relation** | which meals go in which order's packing checklist (`packing_item`, doc 26) |

What **already exists** in the live schema: `package`, `product`, `meal_type`, `routing_rule`,
`section_master`, `customer_allergy`, `product_allergen`, `order_item` (subscription line),
`fulfillment_day` (the per-order per-date spine), `packing_item` (the packing checklist line, doc 26).
The gap is purely the **meal template + per-day schedule**.

---

## 3. Proposed additive schema (NOT YET CREATED)

To be added in a future `00NN_*` migration only when a kitchen-tablet WP requires it. All additive,
nullable, forward-only:

```
package_meal_plan   (id, package_id→package, name, days_count, active, ...)        -- a plan template
package_meal_day    (id, plan_id→package_meal_plan, day_index, ...)               -- "day 3 of the plan"
package_meal_slot   (id, day_id→package_meal_day, meal_type_id→meal_type,         -- "day 3, lunch =
                     product_id→product, qty)                                       --  product X"
order_meal_schedule (id, order_id→customer_order, date, meal_type_id, product_id, -- realized per order
                     fulfillment_day_id→fulfillment_day, source 'plan'|'sub', ...) --  per date
meal_substitution   (id, order_meal_schedule_id, from_product_id, to_product_id,  -- a swap + reason
                     reason_code_id→reason_code, created_by, ...)
kitchen_section     -- already covered by section_master; chef layer adds:
chef_assignment     (id, section_id→section_master, staff_id→staff_user, date, shift, active)
```

**How it connects:** `package_meal_plan/day/slot` is the *template*; `order_meal_schedule` is the
*per-order realization* keyed to `fulfillment_day` (the existing spine) and `meal_type`;
`meal_substitution` records swaps validated against `customer_allergy` + `product_allergen` (the same
allergy logic the kitchen escalation already uses). `packing_item` (doc 26) would then be **generated
from `order_meal_schedule`** for a date instead of being entered ad-hoc.

---

## 4. The in-scope / out-of-scope line

| Need | When | Status |
|---|---|---|
| **Packing labels** — package name, delivery method/time/area, allergy marker | **now** | ✅ met from stored per-order data (doc 26). No meal model needed. |
| **Driver assignment** — area, time, capacity | **now** | ✅ met from frozen delivery fields (doc 28). No meal model needed. |
| **Per-day meal list on a label** (which dishes in this box) | later | 🟨 needs `order_meal_schedule` (§3). Design only. |
| **Kitchen tablets** — per-section meal prep lists, substitutions, chef assignment | later | 🟨 needs `package_meal_*` + `order_meal_schedule` + `chef_assignment`. Design only. |
| **Backfill 500k legacy meal-day records** | — | ❌ **out of scope now** — infeasible to scrape, fulfillment-domain, not the subscription line. Captured raw for a sample only (README). |

---

## 5. Decision

Build the meal fulfillment schema **lazily**, driven by the first kitchen-tablet WP, against this
model. Until then: packing and driver assignment stand on their own (they already pass tests against
real staging-shaped data), and no per-day legacy meal data is migrated. This keeps the operational
foundation unblocked and avoids a large, low-value scrape. Tracked as follow-up **A-OPS-02**.
