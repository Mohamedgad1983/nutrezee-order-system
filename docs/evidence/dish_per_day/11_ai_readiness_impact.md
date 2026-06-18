# 11 — AI Readiness Impact

> **Current run does not move readiness** — no dish content was captured (source limitation, doc 01).
> This documents what dish-per-day capture *would* unlock, to justify the forward-capture investment.

## Auto-meal readiness: before vs (hypothetical) after
| dimension | now (data-intelligence doc 05) | after real dish-per-day capture |
|---|---|---|
| overall | **≈ 27 / 100** | **≈ 55–65 / 100** (projected) |
| customer history readiness | 65 | 80 (adds dish-level history) |
| meal metadata readiness | 15 | 45 (dish names/ids; macros if catalog joined) |
| recommendation explainability | 40 | 65 (can cite actual dishes) |
| dietary / nutrition / feedback | 5 / 10 / 0 | unchanged until separately captured |

## Skills unlocked by dish-per-day (when captured)
- **Dish repetition detection**, **likes/dislikes inference** (from repeated/avoided dishes),
  **personalized dish recommendation (Level 3)**, richer **Customer 360** and **menu intelligence**
  (true dish popularity), better **kitchen forecasting** (by dish, not just volume).

## Still blocked even after dish-per-day
- **likes/dislikes (explicit)**, **feedback/ratings**, **nutrition/macros** (unless catalog macros
  captured), **allergy/diet mapping**, **substitution history**, **delivery outcomes** — each needs its
  own forward capture (data-intelligence doc 09). Dish-per-day is necessary but not sufficient for
  Level-4 (nutrition/allergy-safe) automation.

## Honest conclusion
m23 confirmed that the **legacy back-fill cannot supply dish content** — so the readiness gain must come
from **capturing dish-per-day going forward** in the new system (assign the actual dish per slot at order/
kitchen time), exactly the keystone the data-intelligence assessment identified. The m23 schema is the
landing zone for that capture.
</content>
