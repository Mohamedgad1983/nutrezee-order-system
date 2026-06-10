# Phase 4 — Enhancement Blueprint

**Date:** 2026-06-10 · **Status:** Baseline v1.0
Complexity: **S** ≤ 2 wk · **M** ≤ 6 wk · **L** ≤ 12 wk · **XL** > 12 wk (single squad, indicative — re-estimate after DEC-011 stack decision).
Every enhancement closes named gaps (`03_Gap_Analysis/`) and traces to backlog requirements (BR-xxx).

---

## A. Quick Wins (days–2 weeks, before/alongside Phase 0)

| ID | Enhancement | Description | Business value | User impact | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| ENH-QW-01 | Project repo backup | Push discovery + this documentation set to a private remote; commit outer repo | Protects all project knowledge (R1) | None (PM/team) | S | None | P0 — immediate |
| ENH-QW-02 | Disable/guard mutating GET route | Remove dashboard card for `AutoAssignMealToDrivers`; require POST + confirm + authz | Removes accidental-mutation risk (GAP-SEC-02) | Invisible to staff | S | Old-system owner access | P0 — immediate |
| ENH-QW-03 | Error-page hardening | Generic error pages for the 2 exception-leaking routes | Stops information disclosure (GAP-SEC-03) | Invisible | S | Old-system owner access | P0 |
| ENH-QW-04 | Visible logout + session timeout | Add logout control; set session expiry | Basic session hygiene (GAP-SEC-04) | Minor staff change | S | Old-system owner access | P0 |
| ENH-QW-05 | Structured WhatsApp intake template (process, not code) | Standard message template + intake checklist staff paste/fill during chats | Cuts missing-field errors now; trains data shape for ENH-1-03 | Intake staff adopt a form discipline | S | Ops agreement | P1 |
| ENH-QW-06 | Manual KPI sheet | Daily one-page ops sheet (orders, errors, failed deliveries) until analytics ship | Management visibility + baseline metrics for the business case | Light daily ops effort | S | Ops agreement | P1 |
| ENH-QW-07 | Access & credentials hygiene | Inventory admin accounts; remove unused; document who holds production creds | Shrinks exposure surface (GAP-SEC-01 interim) | None | S | Owner cooperation | P1 |

*ENH-QW-02/03/04 require source or vendor access to the old system — if unavailable, they convert into evidence for DEC-001 (strangler path).*

## B. Phase 1 Enhancements — Foundation & Critical Fixes

| ID | Enhancement | Description | Business value | User impact | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| ENH-1-01 | Identity, RBAC & audit foundation | Auth service, 10-role RBAC, field-level privacy, immutable audit log; admin UI for roles | Closes GAP-SEC-01/AUD-01; every later module inherits it | Staff log into new shell; permissions visible | L | Staging (Phase 0), DEC-011 | P0 |
| ENH-1-02 | Customer profile & dedup | Phone-keyed profiles, multi-address book, preferences/allergies, duplicate detection, history | Closes GAP-DQ-01/CX-01; prerequisite for intake | Intake staff search-first workflow | M | ENH-1-01; DEC-004; data migration (DEC-012) | P0 |
| ENH-1-03 | Draft order & review queue | Structured intake form, incomplete-order queue, admin review (confirm/hold/reject/correct), WhatsApp message reference capture | Closes GAP-OM-01/AUT-01 partially; biggest pain point | Intake + review staff get the new core tool | L | ENH-1-01/02; DEC-002 (manual-assisted mode), DEC-005 | P0 |
| ENH-1-04 | Explicit order state machine | Full lifecycle incl. delivered/completed; transition rules, side effects, change requests with propagation flags | Closes GAP-OM-02/03 | Order staff see guarded transitions | M | DEC-005; ENH-1-03 | P0 |
| ENH-1-05 | Payment status & review queue | Payment lifecycle on orders; review/confirm/hold/reject queue replacing unstable `/confirm-payment`; audit on every action | Closes GAP-AUD-02; replaces broken finance tool | Finance staff move to new queue | M | ENH-1-01/04; DEC-009 | P0 |
| ENH-1-06 | Catalog enrichment | Menu/package model + kitchen-routing metadata + structured nutrition facts + allergen severity | Closes GAP-DQ-02; prerequisite for kitchen/labels | Catalog admin enters routing + macros | M | DEC-006 (sections vocab); ENH-1-01 | P0 |

## C. Phase 2 Enhancements — Operational Automation

| ID | Enhancement | Description | Business value | User impact | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| ENH-2-01 | Kitchen sections & task engine | Section master, item→section routing rules, task generation from confirmed orders, kitchen planning board (incl. tomorrow view replacing broken card) | Closes GAP-OPS-01; production becomes visible | Kitchen manager gets board; replaces verbal routing | L | ENH-1-04/06; DEC-006 | P0 |
| ENH-2-02 | Chef task app | Section/shift-scoped PWA: queued → in progress → prepared → blocked → handed off; shortage/substitution escalation | Closes GAP-OPS-02/05 | Chefs adopt devices/stations | M | ENH-2-01; BR-013–015 | P0 |
| ENH-2-03 | Label generation & printing | Auto labels from order/customer/meal/route; batch printing; QR/barcode per DEC-007 | Closes GAP-OPS-03 | Packing prints instead of writes | M | ENH-2-01; DEC-007 (hardware) | P0 |
| ENH-2-04 | Packing checklist & handoff | Per-box checklist gated on section-task completion; recorded handoff to dispatch | Closes GAP-OPS-04 | Packing staff scan/check | M | ENH-2-02/03 | P0 |
| ENH-2-05 | Dispatch board | Readiness-filtered board; assignment by area/slot/capacity with overrides; manifest; replaces `/driverOrders` + unsafe auto-assign | Closes GAP-DEL-01/02 | Dispatcher gets rule-assisted tool | L | ENH-2-04; DEC-008 | P0 |
| ENH-2-06 | Driver app | PWA: assigned stops, statuses (assigned/picked up/on route/delivered/failed/rescheduled), failure reasons | Closes GAP-DEL-03; completes order lifecycle data | Drivers adopt app | M | ENH-2-05 | P0 |
| ENH-2-07 | WhatsApp Business API integration | Inbound message capture, templated outbound (confirmations, delivery status) — if DEC-002 selects API | Completes GAP-AUT-01/CX-02 | Customers get confirmations; staff stop copy/paste | L | ENH-1-03; DEC-002; WhatsApp account approval | P1 |

## D. Future Enhancements (Phase 4–5 of roadmap)

| ID | Enhancement | Description | Business value | User impact | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| ENH-F-01 | Analytics suite | Management/order/kitchen/delivery/finance dashboards on the event backbone (BR-025–028); exportable role-gated reports (BR-031) | Closes GAP-ANA-*/REP-* | Management self-serve KPIs | L | Phases 1–3 events; DEC-010 | P1 |
| ENH-F-02 | Notification center | Templates, approvals, delivery history, internal alerts (BR-034/035) | Closes GAP-NOT-* | Controlled comms | M | ENH-1-01 | P1 |
| ENH-F-03 | Refunds, credits & wallet | Refund/credit workflows, cashback ledger migration, compensation tracking | Closes finance leakage | Finance + support | M | ENH-1-05; DEC-009 | P1 |
| ENH-F-04 | Exception management hub | Cross-chain exception queue (intake/kitchen/packing/delivery/payment) with ownership & SLA (BR-042) | Systematic escalation | All ops roles | M | Phases 1–3 | P1 |
| ENH-F-05 | Meal-plan lifecycle automation | Off-days, pause/resume, renewals, expiry calendar, substitution propagation (BR-036/037) | Retention + fewer manual edits | Order staff, customers | L | ENH-1-04 | P1 |
| ENH-F-06 | AI intake assistant | LLM-assisted parsing of WhatsApp messages into draft orders with field extraction + allergy flagging; human review retained | Intake speed at scale | Intake staff approve, not type | M | ENH-2-07 (message capture), GAP-AI-02 | P2 |
| ENH-F-07 | Demand forecasting & prep planning | Predict per-section production from subscriptions + history; feed kitchen planning and (if BR-040 confirmed) inventory | Waste/shortage reduction | Kitchen manager | L | ≥3 months event history | P2 |
| ENH-F-08 | Dispatch optimization | Route/sequence suggestions; capacity tuning | Delivery cost & punctuality | Dispatcher, drivers | L | ENH-2-05/06 history | P2 |
| ENH-F-09 | Nutrition copilots | Customer-facing macro/allergen Q&A; dietician request triage | Differentiation for healthy-food brand | Customers, dieticians | M | ENH-1-06 data quality | P2 |
| ENH-F-10 | Inventory & freshness | Ingredient stock dependency, prep/freshness windows, cutoffs (BR-040/041) | Only if business confirms need | Kitchen | XL | Workshop confirmation | P2 |

---

## Dependency spine

```
Phase 0 access/staging ─► ENH-1-01 (RBAC+audit)
                            ├─► ENH-1-02 (profiles) ─► ENH-1-03 (intake queue) ─► ENH-2-07 (WhatsApp API) ─► ENH-F-06 (AI intake)
                            ├─► ENH-1-04 (state machine) ─► ENH-1-05 (payments) ─► ENH-F-03 (refunds/wallet)
                            └─► ENH-1-06 (catalog+routing+nutrition)
                                   └─► ENH-2-01 (kitchen tasks) ─► ENH-2-02 (chef app)
                                          └─► ENH-2-03 (labels) ─► ENH-2-04 (packing)
                                                 └─► ENH-2-05 (dispatch) ─► ENH-2-06 (driver app) ─► ENH-F-08 (optimization)
All phases emit events ──────────────────────────► ENH-F-01 (analytics) / ENH-F-04 (exceptions) / ENH-F-07 (forecasting)
```

**Cut-line guidance for DEC-003 (MVP):** the minimum coherent release is ENH-1-01 → ENH-1-03 + ENH-1-04 (secure structured intake with a real lifecycle). Kitchen/dispatch automation (Phase 2 set) is the second coherent release. Resist shipping fragments of both at once.
