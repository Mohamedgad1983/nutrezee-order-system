# Phase 7 — Implementation Roadmap

**Date:** 2026-06-10 · **Status:** Baseline v1.0
Durations are indicative for one product squad (PM/BA + 3–4 engineers + UX + QA) and must be re-baselined after DEC-011. Phases overlap where dependencies allow; each phase has an entry gate (cannot start) and exit gate (cannot proceed).

```
P0 Foundation      ████████
P1 Critical Fixes        ████████████
P2 Operational Impr.            ████████████████
P3 Automation                            ████████████████████
P4 Advanced Features                                 ████████████
P5 AI Features                                              ████████████→
                   gate: access     gate: workshop    gate: ops rules   gate: event history
```

---

## Phase 0 — Foundation (≈ 4–6 weeks, partly non-engineering)

**Objectives:** Make change safe and decisions possible. No feature work.

**Deliverables**
1. Repo backup to private remote; outer repo committed (ENH-QW-01).
2. The 12 access items secured or formally refused: source, staging, schema, API docs, test logins (customer/driver/kitchen), payment sandbox, WhatsApp API details, printer specs, notification provider, role config. Refusals recorded — they drive DEC-001.
3. Verification workshop held; the 22 open questions answered; minutes in `22_Meeting_Notes/`; DEC-002/004/005/006/008/009 drafted.
4. DEC-001 (build strategy) and DEC-011 (stack/hosting) decided; ADRs in `13_Architecture/`.
5. Environments: staging stood up; CI/CD skeleton; secrets management; backup/restore documented (`16_Deployment/`).
6. Quick wins ENH-QW-02…07 executed where access permits.
7. Baseline metrics captured (ENH-QW-06) for later ROI measurement.

**Dependencies:** Stakeholder availability; old-system owner/vendor cooperation.
**Risks:** Access never granted (R2 — mitigate: timebox to 3 weeks, then default DEC-001 = strangler-fig new services); workshop reveals unknown surfaces (absorb into scope before Phase 1).
**Success criteria:** All 12 access items dispositioned; DEC-001/002/011 signed; staging + pipeline live; zero Critical security quick wins outstanding where access exists.

## Phase 1 — Critical Fixes (≈ 8–10 weeks)

**Objectives:** Close the Critical security/data gaps and stand up the trusted core: identity, RBAC, audit, clean customers, real order lifecycle, controlled payments.

**Deliverables:** ENH-1-01 (auth/RBAC/audit), ENH-1-02 (customer profiles + dedup + migration of customer data per DEC-012), ENH-1-04 (order state machine), ENH-1-05 (payment review queue), ENH-1-06 (catalog enrichment started). RBAC matrix baselined in `09_Roles_and_Permissions/`; audit event catalog v1.

**Dependencies:** Phase 0 exit; DEC-004/005/009/012.
**Risks:** Old-data quality worse than expected (mitigate: dedup tooling + manual review queue); staff resistance to permissions (mitigate: role workshops, phased enforcement — log-only before deny).
**Success criteria:** Every new-system action attributable to a role-scoped user and audit-logged; duplicate-customer rate measured and falling; finance confirms payments only via the audited queue; old unstable `/confirm-payment` retired from use.

## Phase 2 — Operational Improvements (≈ 8–12 weeks, overlaps P1 tail)

**Objectives:** Move order intake into the system — the #1 pain point — without yet automating WhatsApp transport.

**Deliverables:** ENH-1-03 (structured intake + incomplete-order queue + admin review with WhatsApp message reference), order change-request workflow, allergy flags at review (BR-039), catalog enrichment completed (routing metadata + nutrition facts), intake SLA dashboard (manual KPI sheet retired).

**Dependencies:** Phase 1 core; DEC-002 (at least manual-assisted mode confirmed); DEC-006 vocabulary for routing metadata.
**Risks:** Intake staff bypass the new queue under load (mitigate: make it faster than the old way — profile reuse, templates; measure time-per-order); double-entry during transition (mitigate: new system becomes the only path to order creation at cutover, old `/orders/create` read-only).
**Success criteria:** 100% of new orders enter via draft→review; intake time per order ≤ baseline; missing-field rate at confirmation near zero; zero duplicate customers created by intake.

## Phase 3 — Automation (≈ 12–16 weeks)

**Objectives:** Automate the physical chain: kitchen → labels → packing → dispatch → driver.

**Deliverables:** ENH-2-01 (sections + task engine + planning board incl. tomorrow view), ENH-2-02 (chef PWA), ENH-2-03 (label generation/printing per DEC-007), ENH-2-04 (packing checklist + handoff), ENH-2-05 (dispatch board per DEC-008), ENH-2-06 (driver PWA), ENH-2-07 (WhatsApp Business API, if DEC-002 selected API — can run parallel). Old unsafe auto-assign route and `/driverOrders` retired.

**Dependencies:** Phase 2 confirmed orders; DEC-006/007/008; printer hardware procured; driver/chef devices.
**Risks:** Shop-floor adoption (mitigate: pilot one section + one route, iterate, then roll out); wrong routing rules (mitigate: kitchen manager owns rules in settings, not code); printer integration surprises (mitigate: hardware spike early in phase).
**Success criteria:** Every confirmed order auto-decomposes into section tasks; zero handwritten labels; packing blocked-box rate measured; dispatch assignments rule-generated with override audit; driver statuses captured for ≥95% of deliveries; delivered/completed states live.

## Phase 4 — Advanced Features (≈ 8–10 weeks)

**Objectives:** Management visibility, controlled communications, complete finance, systematic exceptions.

**Deliverables:** ENH-F-01 (analytics suite per DEC-010 + legacy-report parity: monthly/daily/by-method/customer-revenue/expiration), ENH-F-02 (notification center), ENH-F-03 (refunds/credits/wallet), ENH-F-04 (exception hub), ENH-F-05 (meal-plan lifecycle automation). Legacy `/summary` retired.

**Dependencies:** Event streams from Phases 1–3; DEC-010.
**Risks:** KPI scope creep (mitigate: P0 KPI list locked at phase entry); report-parity disputes (mitigate: 5 legacy reports are the contract).
**Success criteria:** Management uses dashboards daily (login telemetry); all 5 legacy reports reproduced and reconciled against old system for one overlapping month; every customer-facing message template-approved; refund/credit fully audited.

## Phase 5 — AI Features (continuous, after ≥3 months of event history)

**Objectives:** Apply AI where structured data now exists; human-in-the-loop everywhere.

**Deliverables (sequenced by data readiness):**
1. ENH-F-06 AI intake assistant — parse WhatsApp text into draft-order fields; staff approve. Needs ENH-2-07 message capture.
2. ENH-F-07 demand forecasting — per-section production forecasts feeding kitchen planning.
3. ENH-F-08 dispatch optimization — stop sequencing and capacity tuning.
4. ENH-F-09 nutrition copilots — macro/allergen Q&A grounded in ENH-1-06 data; dietician triage.
5. (Conditional) ENH-F-10 inventory/freshness if BR-040/041 confirmed.

**Dependencies:** Event history depth; data quality from Phases 1–3; AI evaluation criteria in `18_AI_Features/`; privacy review for message processing (BR-043).
**Risks:** AI on dirty data (gate: data-quality metrics green first); over-automation of safety-relevant flows (rule: allergy-related decisions always human-confirmed); customer consent for message processing (legal review).
**Success criteria:** Intake assistant suggestions accepted ≥80% without edit; forecast error below agreed threshold before kitchen relies on it; measurable delivery-cost or punctuality gain from optimization.

---

## Cross-phase tracks (run continuously)

| Track | Content | Owner |
|---|---|---|
| Migration & coexistence | Strangler plan: which old screens retire at each phase exit; data sync during overlap; final decommission list | Tech Lead |
| Testing | Regression vs. 50-screen coverage checklist each release; UAT per workflow | QA |
| Change management | Role-by-role training (intake, chefs, packing, dispatch, drivers, finance); pilot-then-rollout pattern | PM + Ops |
| Governance | Weekly risk review (`21_Risks/`), decision log upkeep (`20_Decisions/`), monthly steering with KPI trend | PM |

## Master gate summary

| Gate | Blocks | Criteria |
|---|---|---|
| G0 → P1 | All build work | Access dispositioned, DEC-001/011 signed, staging live |
| G1 → P2 | Intake build | RBAC/audit live, DEC-002/005 signed |
| G2 → P3 | Automation build | 100% orders via new intake, DEC-006/007/008 signed, hardware ready |
| G3 → P4 | Analytics build | Event streams stable, DEC-010 signed |
| G4 → P5 | AI build | ≥3 months history, data-quality metrics green, privacy review passed |
