# 08 — Dashboard & Reporting Plan

> Management reports rankable by data reliability. Built on doc-07 views; all P0/P1 (no raw PII).

| # | Dashboard | Target user | Business question | Key metrics | Source | Reliability | Priority |
|---|---|---|---|---|---|---|---|
| 1 | **Customer Overview** | Mgmt/Marketing | who are our customers & buyers? | total/buyers/repeat/one-time/non-buyers; lang; area mix | customer, order | 🟢 | P1 |
| 2 | **Retention & Churn** | Mgmt/Retention | who is active / lapsing / churned? | recency segments (active 1,027 / lapsed buckets); repeat rate 52% | customer_features | 🟢 | **P1** |
| 3 | **Package Popularity** | Mgmt/Kitchen | which calorie tiers sell? | orders/customers/revenue by tier; trend | package_behavior_summary | 🟢 | P1 |
| 4 | **Revenue & Payments** | Finance | paid vs unpaid, AOV, trend | paid 9,993 / unpaid 1,545; median ≈107 KWD; by month | payment, order | 🟢 | P1 |
| 5 | **Geographic Demand** | Ops/Kitchen | where is demand? | orders & meal-days by area (113 areas) | order, fulfillment_day | 🟢 | P2 |
| 6 | **Kitchen Volume Forecast** | Kitchen | how many meal-days next week by tier/area? | scheduled meal-days/day; forecast | fulfillment_day | 🟢 (volume) | **P1** |
| 7 | **Meal-History Coverage** | Data/Ops | how much history do we have? | 2,628 customers, 67,908 last-90 days; coverage by month | meal_history | 🟡 | P2 |
| 8 | **Data Exceptions / Quality** | Data/Ops | what's broken & safe to fix? | 77 missing_order_link; 1,272 MER; 302 no-package; unpaid | exceptions, MER | 🟢 | P2 |
| 9 | **Auto-Meal Readiness** | Product/Exec | can we automate meal planning? | readiness 27/100; sub-scores; level gates | doc 05 | 🟢 | P2 |
| 10 | **Inactive / Win-back** | Marketing | who to re-engage? | lapsed 0–3 mo 1,602; 6–12 mo 2,118; non-buyers 11,573 | customer_features | 🟢 | P1 |
| 11 | **Delivery Readiness** | Ops | delivery SLA/quality? | — **blocked**: all fulfillment `scheduled`, no driver/route data | — | 🔴 | hold |

## Notes
- **Highest-value, fully-supported now:** #2 Retention/Churn, #3 Package Popularity, #4 Revenue,
  #6 Kitchen Forecast (volume), #10 Win-back. These need only existing reliable data.
- **#11 Delivery Readiness is deliberately on hold** — building it on the uniform `scheduled` status
  would be misleading. It unlocks only after delivery-outcome capture (doc 09).
- All dashboards consume the doc-07 views (P0/P1); per-customer drill-down is staff-role + masked (P1).
</content>
