# 04 — Customer Behavior Analysis (read-only, no PII)

> Aggregate behavioral segmentation from `customer`, `customer_order`, `fulfillment_day`,
> `payment_record`. All counts; no individual customer is identified.

## Population funnel
| stage | count | share |
|---|---|---|
| total customers | 19,476 | 100% |
| buyers (≥1 order) | 7,903 | 40.6% |
| repeat buyers (>1 order) | 4,082 | 21.0% of all / **51.6% of buyers** |
| one-time buyers | 3,821 | 48.4% of buyers |
| non-buyers (leads) | 11,573 | 59.4% |
| with meal history (last-90) | 2,628 | 13.5% |

## Order frequency (buyers)
| orders | customers |
|---|---|
| 1 | 3,821 |
| 2 | 1,779 |
| 3–4 | 1,299 |
| 5–9 | 784 |
| **10+** | **220** |

→ A loyal core: **1,004 customers with 5+ orders**, 220 of them 10+ — prime high-value cohort.

## Meal-day depth (fulfillment_day per customer)
| days | customers |
|---|---|
| 1–15 | 1,116 |
| 16–30 | 1,947 |
| 31–60 | 2,163 |
| 61–120 | 1,629 |
| 121–300 | 881 |
| 300+ | 167 |

→ **2,677 customers have 61+ delivered-plan-days** — deep enough history for cadence modelling.

## Recency / churn (by last order `end_date` vs today 2026-06-18)
| segment | customers | meaning |
|---|---|---|
| active now (end ≥ today) | 1,027 | currently on a plan |
| lapsed 0–1 mo | 748 | **hot win-back** |
| lapsed 1–3 mo | 854 | win-back |
| lapsed 3–6 mo | 888 | reactivation |
| lapsed 6–12 mo | 2,118 | dormant |
| lapsed 12 mo+ | 2,268 | long-churned |

→ ~**2,490 customers lapsed within 6 months** = the actionable reactivation pool.

## Package behavior (diet tier)
- distinct packages per customer: 1 → 6,573 (83%), 2 → 1,114, 3+ → 216. **Strong single-tier loyalty.**
- demand by tier (orders): `630-1730 cal` 9,576 (48%) · `(150p-150c) 620-2240` 4,497 · `720-1920` 3,801
  · `(200p-200c) 1020-3520` 1,318 · `(150p-200c) dry food` 825 · `kids` 85.
- → package = the customer's **calorie/macro preference**; most customers are loyal to one tier, so
  package-tier recommendation/renewal is well-supported.

## Value
- 18,290 orders with total>0; **median ≈ 107 KWD**, mean ≈ 102.7 KWD (minor units 107,000 / 102,730).
- payments: 9,993 paid vs 1,545 unpaid → ~86% paid-conversion among orders with a payment row.

## Geography
- 113 active delivery areas; top: Abdullah Al Mubarak (801), Jaber Al Ahmad (771), Sabah Al Salem (697),
  Saad Al Abdullah (678), Salam (519)… → strong area-level demand signal for kitchen/route planning.

## Actionable cohorts (derivable now, no PII)
| cohort | definition | size | use |
|---|---|---|---|
| **High-value loyalists** | 5+ orders | 1,004 | VIP care, retention, upsell |
| **Repeat buyers** | >1 order | 4,082 | renewal prompts, loyalty |
| **One-and-done** | exactly 1 order | 3,821 | win-back / onboarding fix |
| **Hot win-back** | lapsed 0–3 mo | 1,602 | reactivation campaign |
| **Currently active** | end_date ≥ today | 1,027 | renewal-before-expiry |
| **Non-buyers** | 0 orders | 11,573 | lead nurturing |
| **Deep-history** | 61+ fulfillment days | 2,677 | cadence/auto-suggest candidates |

## What behavior we **cannot** see (data-limited)
- meal/dish preference (no content) · likes/dislikes/skips · delivery success/failure · feedback/ratings
  · allergy/diet constraints · true meal-type mix (only Lunch/Dinner exist; breakfast/snack is artifact).
- → behavior analysis is strong on **frequency, recency, value, package tier, geography, cadence**, and
  blocked on **content, satisfaction, and dietary** dimensions.
</content>
