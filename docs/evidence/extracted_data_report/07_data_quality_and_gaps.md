# 07 — Data Quality & Gaps

**Date:** 2026-06-20 · **Verification:** structural facts (counts, 100%-`scheduled`, empty content columns, absent dish tables) **DB-verified this run**; field-level null rates **previously documented** in `data_intelligence/03` and `legacy_full_migration/*` (cited).

---

## 1. Data-quality strengths — `CONFIRMED`

- **Referential integrity is sound.** Reconciliation found **0 orphans** across `customer_order→customer`, `address→customer`, `payment_record→customer_order`; 0 duplicate order numbers; 0 invalid dates; 0 paid-with-zero-amount *(`legacy_full_migration/10,12`)*. The failure mode is **incompleteness, not corruption**.
- **Backbone counts are exact and stable.** Every documented entity count was **independently DB-verified on 2026-06-20** with zero drift (customer 19,476; customer_order 20,104; payment_record 11,539; fulfillment_day 527,724; product 1,298; package 9; area 127; sync_record 52,423).
- **Meal-history archive is lossless & idempotent.** 4,927/4,927 last-90 candidates archived, 0 silent drops, re-apply inserts nothing *(`meal_history/30,32`)*.
- **Strong contactability & identity fields.** Email ≈100%, phone ≈99.5%, DOB ≈71% *(`data_intelligence/03`)* — good for segmentation (with PII masked).
- **Deep cadence history.** 527,724 plan-days spanning 2024–2026 — enough for kitchen volume forecasting.

## 2. Missing fields — `BLOCKED` / `PARTIAL`

| Field / data | State | Evidence |
|---|---|---|
| Dish per customer per day | **missing** | dish tables absent (DB-verified); 0/40 legacy files (`dish_per_day/01`) |
| Meal name / ref / type on meal-items | **empty (null)** | `data_intelligence/03` |
| Delivery outcome (delivered/skipped/failed) | **missing** | `fulfillment_day` 100% `scheduled` (DB-verified) |
| Nutrition / macros per dish | **missing** | `nutrition_facts` ≈ empty (`data_intelligence/03,05`) |
| Customer allergy / diet profile | **missing** | `customer_allergy` = 0 (`data_intelligence/05`) |
| Preferences / likes / dislikes | **missing** | not captured (`data_intelligence/09`) |
| Feedback / ratings | **missing** | none captured (`data_intelligence/05`) |
| Skips / substitutions | **missing** | `fulfillment_day.status` uniform (DB-verified) |
| Order line items (`order_item`) | **not migrated** (1 seed row) | `legacy_full_migration/09` MM-01 |
| Customer lifecycle status | **uniform `active`** | `data_intelligence/03` |
| `off_days` on orders | **empty** | `data_intelligence/03` |
| Payment `method` / `transaction_ref` | **empty** | `data_intelligence/03` |
| Driver / route / packing / kitchen outcome | **empty** (modules built, no data) | `legacy_full_migration/26–31` |

## 3. Incomplete relationships — `PARTIAL`

- **Product → order / meal:** no link populated → catalog cannot be tied to consumption (blocks dish-level anything).
- **Meal-history → order:** 77 open `missing_order_link` exceptions (40 distinct legacy orders) — DB-verified.
- **Order → meal content:** absent (no `order_item`).
- **Customer → address:** ~51% of customers have no address (mostly leads; coverage unprovable, MM-10).
- **Order history completeness:** −1,172 historical-order shortfall vs source (MM-06, quantified not closed).

## 4. Exception categories & counts — `CONFIRMED`

**`migration_exception_review` = 1,272** (DB-verified) *(`legacy_full_migration/20`)*:

| Reason | Count |
|---|---|
| duplicate_phone_deduped | 621 |
| placeholder_phone (order) | 395 |
| placeholder_phone_blacklisted (customer) | 93 |
| invalid_or_missing_phone | 91 |
| negative_amount | 46 |
| customer_not_found | 22 |
| reversed_dates | 3 |
| no_name | 1 |

**`customer_meal_history_exceptions` = 77 open**, all `missing_order_link` (DB-verified).

## 5. The four structural gap themes (with risk)

### A. Order-sync completeness — Risk: **High**
The legacy order extract lacks phone/amount/customer for newer orders → governed sync can't create them (`would_create = 0`) → 77 meal-history exceptions cannot be deterministically relinked, and a −1,172 historical-order shortfall persists. **Remediation:** a fresh **full-detail** legacy order re-pull (phone+amount+customer) then governed M19 apply. **Never** patch by phone/name matching.

### B. Meal-history link issue — Risk: **Medium**
77 unlinked meal-days. Downstream impact is small (meal-history adds no content anyway), but it is a visible data-quality flag. **Remediation:** resolve via (A); leave open until then.

### C. Dish-per-day missing — Risk: **High (for AI ambitions), Low (for current analytics)**
No retrievable saved dish in legacy. Blocks all dish-level/nutrition/allergy AI. **Remediation:** **forward capture** in the new system (assign real dish per slot at order/kitchen time) into the built m23 schema. Do **not** infer from catalog.

### D. Product / nutrition / allergy / preference weakness — Risk: **High (safety) for any health-claim AI**
Catalog is names only; no nutrition, allergens, or customer diet/allergy. **Remediation:** build a menu/nutrition/allergen master + consented customer diet profiles before any health-aware automation. Allergy automation is the highest-risk item.

### E. Delivery / driver / packing / kitchen outcome weakness — Risk: **Medium**
`fulfillment_day` is 100% `scheduled` (DB-verified); operational modules hold no data. Blocks delivery-quality and logistics analytics. **Remediation:** capture delivery outcome at ops close-out (the m20/m21 foundations are ready to receive it).

## 6. Risk-ranked gap summary

| Gap | Blocks | Risk | Fix type |
|---|---|---|---|
| Order-sync completeness (A) | order/meal-history completeness | High | Forward full-detail re-pull + governed apply |
| Dish-per-day (C) | dish/nutrition/allergy AI | High (AI) | Forward capture |
| Nutrition/allergy/preference (D) | health-aware & allergy-safe AI | High (safety) | New masters + consented profiles |
| Delivery outcome (E) | delivery-quality & logistics AI | Medium | Ops close-out capture |
| Meal-history link (B) | tidy data-quality | Medium | Resolves via (A) |
| Historical-order shortfall | full historical analytics | Medium | Resolves via (A) |
| Lifecycle status uniform | precise lifecycle segmentation | Low | Derive from recency |
| `off_days` / payment `method` empty | minor segmentation detail | Low | Accept / capture forward |

## 7. Recommended remediation order — `RECOMMENDED`

1. **Ship the behavioral analytics layer now** (Customer 360 + Segmentation + Churn) — depends on **none** of the gaps above; immediate value.
2. **Start forward dish-per-day capture** (C) — the single highest-leverage data fix.
3. **Repair order-sync** (A) via a full-detail re-pull — clears (B) and the historical shortfall deterministically.
4. **Capture delivery outcome** (E) at ops close-out.
5. **Build nutrition/allergen masters + consented diet profiles** (D) — gated, safety-reviewed, before any health-aware AI.

> Do these in this order because (1) needs nothing, while (2)–(5) are capture programs whose value compounds only as data accrues. Never reorder a *safety* gap (D) ahead of its safety review.
