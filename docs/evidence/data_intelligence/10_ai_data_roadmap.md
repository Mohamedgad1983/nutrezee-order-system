# 10 — Prioritized AI & Data Roadmap

> Three horizons. **Immediate** uses only today's reliable data (read-only). **Next** needs small
> capture additions. **Later** needs the full content/nutrition/operational capture program (doc 09).

## IMMEDIATE — buildable now from existing data (no new capture)
| item | value | required data (have) | effort | dependency | risk | acceptance |
|---|---|---|---|---|---|---|
| **Customer 360 (read-only)** | unified ops view | order/cadence/payment/package/exceptions | S–M | doc-07 `customer_features` | L | sampled aggregates reconcile; PII masked |
| **Segmentation + RFM** | targeting | order/payment/recency | S | customer_features | L | cohort sizes match doc 04 |
| **Churn / win-back scoring** | retention revenue | recency/frequency/paid ratio | M | customer_features | L | back-test on lapsed cohorts |
| **Package recommendation (tier)** | upsell/renewal | package history + cohort | M | package_behavior_summary | M | top-1 tier matches repeat buyers ≥ baseline |
| **Kitchen volume forecast** | production planning | `fulfillment_day` 527K | M | demand view | M | MAPE on held-out weeks |
| **Repeated-cadence analysis** | renewal timing | fulfillment dates | S | views | L | pattern reconciles with raw |
| **Data-quality dashboards** | trust + cleanup | exceptions/MER | S | views | L | counts match doc 03 |

## NEXT — small data improvements unlock these
| item | value | needs (capture) | effort | dependency | risk | acceptance |
|---|---|---|---|---|---|---|
| **Auto plan suggestion (Level 1–2)** | convenience, retention | dish→slot menu mapping; lifecycle status | M | menu master + cadence | M | staff-reviewed suggestions accepted ≥ X% |
| **Customer Service Copilot** | faster support | (existing) + feedback later | M | Customer 360 + RBAC masking | M (PII) | no PII leak; staff usefulness |
| **Renewal/cancellation insight** | churn cause | `reason_code` on status | S | reason capture | L | reasons populate; trend visible |
| **Delivery quality (basic)** | SLA visibility | delivery outcome on `fulfillment_day` | M | driver/ops close-out | M | outcome populated; on-time % computable |

## LATER — needs the full capture program
| item | value | needs | effort | dependency | risk | acceptance |
|---|---|---|---|---|---|---|
| **Personalized dish recommendation (Level 3)** | personalization | per-customer dish history + feedback | L | dish link + feedback (months of data) | M | offline rec quality ≥ baseline |
| **Nutrition-aware planning** | health value | nutrition/macros master | L | recipe master | M | macro targets honored |
| **Allergy-safe automation (Level 4)** | safety | allergy/diet profiles + dish allergens | L | **P2** capture + masters | **H** | 0 allergy violations in sim |
| **Inventory/chef-aware auto planner** | full automation | inventory + capacity feeds | XL | ops systems | H | feasible plans within capacity |
| **Driver/route intelligence** | logistics | driver/route/outcome data | L | ops capture | M | routes/SLA computable |

## Sequencing logic
1. **Ship the behavioral layer now** (Immediate) — real value, zero new capture, low risk; also produces
   the views every later skill reuses.
2. **In parallel, stand up the dish-link + menu/nutrition masters + delivery-outcome capture** (doc 09) —
   the keystone that moves readiness 27 → ~60.
3. **Only then** attempt content/nutrition/allergy AI (Later), gated by accumulated captured data and a
   safety review (allergy automation is the highest-risk item — never ship without P2 data + validation).
</content>
