# 03 — Data Quality & Completeness Report

> Read-only completeness/quality checks. Counts only — no PII.

## Customer data
| check | value | note |
|---|---|---|
| total customers | 19,476 | |
| status = active | 19,476 (100%) | **no active/inactive signal** — status unusable for segmentation |
| with ≥1 order (buyers) | 7,903 (40.6%) | 11,573 are **non-buyers** (leads/imported contacts) |
| with meal history | 2,628 (13.5%) | last-90 scrape only |
| with email | 19,471 (99.97%) | **real** emails (gmail 12.6k, hotmail 4k, icloud, outlook…) — strong contactability, **PII** |
| with phone | 19,371 (99.5%) | **PII**; duplicate/placeholder phones exist (MER) |
| with dob | 13,824 (71%) | age/birthday signal for 71% |
| with address | 9,511 (48.8%) | geo only for buyers mostly |
| with diet_status | **0** | empty |
| duplicate-customer risk | 1,272 MER cases | placeholder/duplicate phone, deduped via `merge_record` |

## Order data
| check | value | note |
|---|---|---|
| total orders | 20,104 | channel: `legacy` 20,103, `phone` 1 |
| by status | expired 11,699 · rejected 5,805 · cancelled 1,545 · active 1,054 · approved 1 | 58% expired (completed plans), 29% rejected (never converted) |
| with package | 19,802 (98.5%) | 302 null package |
| total > 0 | 18,290 (91%) | ~1,814 zero/negative-value orders |
| with delivery area | 20,092 (99.9%) | 113 distinct areas |
| `off_days` populated | **0** | feature column empty from legacy |
| date span (start) | 2023-10-04 → 2027-03-04 | future-dated plans exist |
| volume | steady ~800–1,500 orders/month Sep-2025 → Jun-2026 | healthy temporal density |
| missing customer link | 0 | every order has a customer |

## Meal history (m22)
| check | value | note |
|---|---|---|
| raw rows | 4,987 (4,987 distinct sha) | lossless, deduped |
| parents | 4,955 (imported 4,913 / exception 42) | |
| items (meal-days) | 67,908 | date 2026-03-19 → 2026-06-17 (last-90) |
| distinct customers | 2,628 | |
| `meal_type` / `meal_name` / `meal_ref` populated | **0 / 0 / 0** | **content absent** — items are `(order, date)` only |
| `delivery_status` populated | **0** | no delivery outcome |
| duplicate meal-days | 0 | unique `(order, date)` |
| exceptions | 77 `missing_order_link/open` (40 orders) | order-sync gap (m22 doc 34), not parsing |
| parent `meal_types` jsonb | `["breakfast","snack"]` ×4,938 | **scrape artifact** (regex over HTML), not real per-customer types |

## fulfillment_day (the cadence spine)
| check | value | note |
|---|---|---|
| rows | 527,724 | all 20,104 orders covered (avg 26.2 days/order) |
| status | **100% `scheduled`** | **no delivered/skipped/rescheduled outcome captured** |
| reschedule_link / reason_code populated | 0 / 0 | empty |
| year coverage | 2023:1.4k · 2024:103.9k · 2025:239.5k · 2026:182.7k · 2027:0.2k | deep 2024–2026 history |
| past vs future (vs today) | 504,392 past · 23,332 today+future | |

## Packing / delivery / kitchen / drivers
All empty (`driver`, `delivery_route`, `packing_*`, `kitchen_ticket` = 0). No operational fulfilment
data exists yet → delivery-quality and driver/kitchen analytics are **blocked**.

## Payments
paid 9,993 · unpaid 1,545 · link_sent 1; `method`/`transaction_ref` empty; 11,539 orders have a payment
row (57%). Paid/unpaid is reliable; method is not.

## Quality issues — prioritized
**Critical (block content/operational AI):**
1. No dish/meal **content** anywhere (`order_item`≈empty, `meal_name`/`meal_ref` null, `product` is
   names only).
2. No **delivery outcome** (`fulfillment_day.status` 100% scheduled; no delivered/skipped/failed).
3. No **nutrition / allergy / preference / diet** (those tables empty).
4. Customer **status uniform** (all active) — no lifecycle state.

**Medium:**
5. Meal-history items carry no `meal_type` (only the noisy parent artifact); 77 unlinked exceptions.
6. 51% of customers have no address; 302 orders no package; `off_days` empty.
7. `product` has no meal_type/price/tags/recipe.

**Low:**
8. Payment `method` null; dob present for 71%; `order_status_history` near-empty (weak status timeline).

**Recommended (read-only) fixes / mitigations:** derive customer lifecycle from order recency (not the
`status` column); use `fulfillment_day` (not meal-history) as the cadence source; treat package name as
the diet/calorie proxy; treat paid/unpaid as conversion signal; defer all content/nutrition/delivery AI
until capture exists (doc 09).
</content>
