# 02 — Entity Relationship Map

> The real, populated relationship graph (from live FKs + join-key reliability checks). Focus on what is
> **safe to join for analytics/AI**.

## Core graph (populated edges)
```
                         ┌──────────────┐
              ┌──────────►│   customer   │ 19,476  (PII: name/email/dob/phone)
              │          └──────┬───────┘
   customer_phone 19,371        │ customer_id
   address 9,511 ──area_id──► area 127
              │                 │
              ▼                 ▼
        ┌─────────────────────────────┐  package_id   ┌───────────┐
        │      customer_order 20,104  │──────────────►│ package 9 │ (calorie tiers)
        └───────┬───────────┬─────────┘               └───────────┘
                │ order_id  │ order_id
                ▼           ▼
   fulfillment_day 527,724  payment_record 11,539
   (per-day schedule)       (paid/unpaid)
                │ order_id (also)
                ▼
   customer_meal_history 4,955 ──► customer_meal_history_items 67,908
   (last-90 parents)              (meal-DAY dates; no content)
        │
        └─ customer_meal_history_exceptions 77 (missing_order_link)

   product 1,298 ──meal_type_id──► meal_type 2   (catalog; NOT linked to orders/meals)
   sync_record 52,423  = legacy_key ↔ new_ref  (migration backbone)
```

## Relationship reliability table
| relationship | join keys | reliability | missing-link | dup risk | safe for analysis | safe for AI features |
|---|---|---|---|---|---|---|
| customer → orders | `customer_order.customer_id = customer.id` | 🟢 high | 0 orphan orders | low | ✅ | ✅ |
| customer → addresses | `address.customer_id` | 🟢 | 51% of customers have none | low | ✅ (geo on buyers) | ✅ |
| customer → phones | `customer_phone.customer_id` | 🟢 | 0.5% none | dup phones across customers (MER 1,272) | ✅ counts | ⚠️ (not an identity key) |
| order → package | `customer_order.package_id` | 🟢 | 1.5% null (302) | low | ✅ | ✅ (calorie tier) |
| order → fulfillment_day | `fulfillment_day.order_id` | 🟢 | **0** (all 20,104 orders covered) | unique `(order_id,date)` | ✅ cadence | ✅ cadence/forecast |
| order → payment | `payment_record.order_id` | 🟢 | 57% of orders have a payment row | order can have several | ✅ | ✅ (paid/unpaid) |
| order → meal-history parent | `customer_meal_history.order_id` | 🟡 | last-90 only; 42 unlinked | `legacy_order_id` unique | ✅ (last-90) | ⚠️ low extra value |
| meal-history parent → items | `customer_meal_history_items.meal_history_id` | 🟢 | 0 | unique `(order,date)` | ✅ dates | ⚠️ content null |
| meal-history exceptions → order | `detail.order_number → sync_record` | 🔴 | **77 unresolved** (order-sync gap) | — | ⚠️ | ❌ until order-sync |
| order → packing / delivery / driver | various | 🔴 | tables empty | — | ❌ | ❌ |
| product → order/meal | (none populated) | 🔴 | `order_item`=1, meal_name=null | — | ❌ | ❌ (no dish linkage) |
| import_run → raw/clean/exception | `import_run_id` | 🟢 | 0 | — | ✅ provenance | ✅ |

## Key structural facts for modeling
1. **`customer_order` is the analytic hub** — every populated operational edge hangs off `order_id` or
   `customer_id`. RFM, package, geo, payment, and cadence all join cleanly here.
2. **`fulfillment_day` is the cadence/time-series spine** — 527K rows, unique `(order_id, date)`, full
   2024–2026 coverage, indexed on `(date,status)` and `(order_id,date)`. Best source for "how many
   meal-days, when, where, which package" — i.e. **kitchen/demand forecasting** input.
3. **Meal-history adds little structurally** — it duplicates dates that `fulfillment_day` already has,
   without content; its unique value is the (future) per-dish layer, which is not yet captured.
4. **The dish/recipe/nutrition sub-graph is absent** — `product` is an island (no edges into orders or
   meals), and `nutrition_facts`/`*_allergen`/`*_ingredient` are empty. This is the structural reason
   content-based meal AI is blocked.
5. **Phone is not a safe join identity** — duplicate/placeholder phones drove the 1,272 MER cases; never
   use phone/name to link entities for AI.
</content>
