# 08 — Next-Phase Execution Plan

**Date:** 2026-06-20 · **Status: `RECOMMENDED` (plan only — not executed in this pass).**

> **Recommended next phase: "Analytics Foundation for Customer 360 + Segmentation + Churn."**
> **NOT** dish scraping. **NOT** an AI auto-meal planner. **NOT** production messaging/timers.

This phase converts the already-trusted, DB-verified backbone into a read-only analytics layer plus the first internal Customer Intelligence tools. It depends on **no missing data** and introduces **no new risk**.

---

## 1. Scope (in)

1. Create a **read-only `analytics` schema** of views/materializations as designed in [06_analytics_foundation_recommendation.md](06_analytics_foundation_recommendation.md):
   `customer_features`, `package_behavior_summary`, `customer_meal_cadence`, `customer_churn_signals`, `data_quality_flags`.
2. Deliver three internal, PII-masked Customer Intelligence outputs:
   - **Customer 360** (per-customer summary, surrogate id only)
   - **Segmentation** (RFM + tier + area + recency cohorts)
   - **Churn / Win-back** (recency buckets + priority)
3. Add a **reconciliation harness** proving every view matches the DB-verified baseline before use.
4. Document everything under `docs/evidence/` with an execution evidence trail.

## 2. Non-scope (explicitly out)

- ❌ Dish-per-day scraping or any legacy bulk scrape.
- ❌ Applying migration `0020` / creating dish tables.
- ❌ Auto-meal planner, nutrition-aware, allergy-safe, preference/dislike AI.
- ❌ Delivery/driver analytics (no outcome data).
- ❌ Enabling any systemd timer, cron, or incremental sync.
- ❌ Production access; WhatsApp/notifications send; any write to legacy.
- ❌ Forcing the 77 meal-history relinks or matching customers by name/phone.

## 3. Database approach

- Define the analytics objects as **views first** (zero storage risk); promote the heavy ones to **materialized views** only if query cost warrants, refreshed by a **manually-invoked, idempotent** job — **no timer**.
- Place them in a dedicated `analytics` schema, **separate from business tables**; the layer only reads.
- If applied to staging, do so as a **gated migration** following repo convention (`NNNN_waveW_<scope>.sql`, forward-only) — but only when explicitly authorized; this plan does not pre-authorize it.
- Respect the single-write-path and no-GET-mutation rules — analytics is pure read.

## 4. Docs approach

- New folder e.g. `docs/evidence/analytics_foundation/` with: baseline, view-by-view design+DDL, reconciliation results, masking proof, acceptance sign-off, final report.
- Amend registers (not frozen Phase 1–4 docs) per `AGENTS.md`; log any contradictions as A-ids.
- Carry forward the **DB-verified baseline** from this report as the reconciliation target.

## 5. Validation approach

- **Reconciliation gate:** each view's row count / key aggregate must equal the DB-verified baseline in [02_data_inventory.md](02_data_inventory.md) and the documented cohorts in `data_intelligence/03–04`.
- **Idempotency:** refresh twice → identical output.
- **PII gate:** automated column check that no name/email/phone/address text exists in any analytics object.
- **Read-only proof:** run the existing CI guards (`scan-no-get-mutation`, `scan-cross-module-writes`) and confirm no business-table writes.
- **Tests:** add TS-U/TS-I coverage for the view contracts where the analytics layer is exposed via API; keep the existing 8-suite matrix green in CI.

## 6. Acceptance criteria

| # | Criterion | Pass condition |
|---|---|---|
| 1 | Backbone reconciliation | All five views match DB-verified baseline (±0 on counts, ±1% on derived cohorts) |
| 2 | PII masking | 0 PII columns leave the analytics layer (automated check) |
| 3 | Read-only | CI scan guards pass; no writes to business tables |
| 4 | Idempotent refresh | Re-run yields identical rows |
| 5 | Customer 360 / Segmentation / Churn outputs | Produced, masked, and cohort sizes reconcile with `data_intelligence/04` |
| 6 | No timers/production | No systemd timer/cron enabled; no production touched |
| 7 | Honest scope | No dish/nutrition/allergy/delivery claims anywhere in deliverables |

## 7. Rollback / safety

- Analytics objects are **droppable with zero business impact** (`DROP VIEW`/`DROP MATERIALIZED VIEW` — no business data touched). Rollback = drop the schema.
- No business migration is altered; forward-only discipline preserved.
- Staging only; production untouched; no timers; no legacy writes.
- If any reconciliation check fails, **stop and report** rather than ship approximate analytics.

## 8. Expected business value

- **Retention/marketing now:** actionable cohorts ready on day one — ~1,602 hot win-back (lapsed 0–3m), 1,027 active (renewal-before-expiry), 1,004 high-value loyalists (5+ orders), 11,573 non-buyer leads *(`data_intelligence/04`)*.
- **Operations:** kitchen volume forecasting input from the 527,724-row schedule.
- **Compounding:** the same views feed every future AI skill — this phase is also the reusable foundation, not a throwaway.

## 9. Evidence that must be produced

1. The five analytics view definitions + (if applied) a gated migration.
2. A reconciliation report showing each view vs the DB-verified baseline.
3. A masking-proof artifact (column audit).
4. Customer 360 / Segmentation / Churn sample outputs (masked).
5. CI run evidence: scan guards + 8-suite matrix green.
6. A final phase report under `docs/evidence/` with status labels and provenance tags, in the style of this package.

---

## 10. Parallel track (separate, not this phase)

Treat **forward dish-per-day capture** ([04_m23_dish_per_day_blocker_report.md](04_m23_dish_per_day_blocker_report.md)) as a *product/ops* initiative: assign the real dish per slot at order/kitchen time into the built m23 schema. It is the keystone for later dish-level AI but must **not** be pursued via legacy scraping and is **not** part of the analytics foundation phase. The optional ≤5-order GET-only legacy discovery may run only after the m22 last-year scrape finishes, under its own gates.
