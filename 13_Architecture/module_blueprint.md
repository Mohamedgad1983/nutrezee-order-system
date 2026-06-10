# Phase 2C — Module Blueprint (19 Modules)

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (module boundaries) / Proposed where gated on open DECs
Template per module: Purpose · Why · Gaps · BRs · Inputs → Outputs · Responsibilities · Entities · Dependencies · Priority · MVP? · Risks · Open questions. Entity ownership detail: `data_ownership_blueprint.md`. Statuses referenced: `order_lifecycle_status_model.md`.

Legend: **MVP** = in strict MVP cut (2K) · **MVP-lite** = minimal slice in MVP · **P4/P5** = migration phase per `legacy_transition_architecture.md`.

---

## M01 — Order Intake Module — **MVP**
- **Purpose:** Capture structured Draft Orders from any channel.
- **Why:** #1 pain point — manual WhatsApp transcription (GAP-AUT-01 Critical, GAP-DQ-03).
- **Gaps:** GAP-AUT-01, GAP-DQ-03, GAP-OM-01. **BRs:** BR-001, BR-002, BR-003.
- **Inputs:** Agent-entered fields, WhatsApp message refs (M17), customer match (M04), catalog (M05), slots/areas (M16). **Outputs:** DraftOrder; submission to M02; aging-draft alerts (M11).
- **Responsibilities:** Field validation, incomplete queue, channel + source tracking, allergy pre-check display (BR-039), duplicate-order warning.
- **Entities:** DraftOrder, DraftItem, IntakeChannel.
- **Dependencies:** M04, M05, M13, M14, M16; M17 for channel metadata.
- **Priority:** P0 — first strangler slice (ADR-003). **Risks:** agent bypass (R9) — measure time-per-order vs legacy. **Open Q:** required fields per order type (workshop S3 Q8).

## M02 — Review Queue Module — **MVP**
- **Purpose:** Human gate between intake and operations: approve / reject / hold / return-for-edit.
- **Why:** Orders currently hit kitchen/delivery with zero review (GAP-OM-01 Critical).
- **Gaps:** GAP-OM-01, GAP-CX-03. **BRs:** BR-004, BR-005, BR-039.
- **Inputs:** Submitted drafts. **Outputs:** ReviewDecision; APPROVED orders → M03; rejections with reason codes.
- **Responsibilities:** Queue with SLA timers, allergy/restriction flag enforcement, price/coupon verification, decision recording.
- **Entities:** ReviewDecision, ReviewQueueItem.
- **Dependencies:** M01, M03, M13, M14. **Priority:** P0. **Risks:** reviewer bottleneck — queue metrics from day one. **Open Q:** who besides Ops Manager may approve [NC — RBAC matrix proposal].

## M03 — Order Management Module — **MVP**
- **Purpose:** Canonical order/plan + FulfillmentDay state machines, calendar generation, change propagation, event emission.
- **Why:** Hub of the architecture; legacy lifecycle is partial and unaudited (GAP-OM-02/03).
- **Gaps:** GAP-OM-02, GAP-OM-03, GAP-OM-04. **BRs:** BR-005, BR-036, BR-037, BR-042.
- **Inputs:** Approvals (M02), status updates (M08/M09), payment changes (M07). **Outputs:** Versioned events (order.*, fulfillment.*); OrderStatusHistory.
- **Responsibilities:** Transition enforcement (role+validation+history+audit atomically), calendar/off-days/pause (BR-036), cascade changes (BR-037), exception records (BR-042).
- **Entities:** Order, OrderItem, FulfillmentDay, OrderStatusHistory, PlanCalendar, Exception.
- **Dependencies:** M04, M05, M13, M14, M16. **Priority:** P0. **Risks:** DEC-005 open — model is Proposed; event contract churn — version from v1. **Open Q:** status-model open items 1–6.

## M04 — Customer Management Module — **MVP**
- **Purpose:** Single customer identity: phone-matched profiles, address book, preferences, allergies, history.
- **Why:** Duplicate customers from re-typing (GAP-DQ-01, GAP-CX-01).
- **Gaps:** GAP-DQ-01, GAP-CX-01, GAP-ADM-01. **BRs:** BR-006, BR-007.
- **Inputs:** Intake matches/creates, legacy customer import (M19). **Outputs:** CustomerProfile to intake/review/kitchen(allergy)/delivery(address).
- **Responsibilities:** Match-by-phone [A — DEC-004], duplicate detection + merge (audited), PII visibility classes, multi-address with area links.
- **Entities:** Customer, Address, Preference, AllergyLink, MergeRecord.
- **Dependencies:** M13/M14 (PII classes, merge audit), M16 (areas). **Priority:** P0. **Risks:** legacy data quality unknown [NC — schema access]; merge errors — soft-merge with undo window. **Open Q:** identity key (workshop S3 Q10).

## M05 — Product / Menu Module — **MVP** (reference slice)
- **Purpose:** Catalog: items, packages/plans, pricing, bilingual content; carrier of kitchen routing metadata and nutrition/allergen data.
- **Why:** Orders can't be structured without it; routing/labels depend on metadata (GAP-OPS-01 prerequisite, GAP-DQ-02).
- **Gaps:** GAP-DQ-02, GAP-DQ-04. **BRs:** BR-008, BR-009, BR-010, BR-038.
- **Inputs:** Catalog admin entry; legacy catalog import (M19). **Outputs:** Items/packages to M01/M02/M03; RoutingRules to M08; nutrition to review/kitchen.
- **Responsibilities (MVP):** Read-mostly mirror of legacy catalog + routing metadata + structured allergens. Nutrition macros completion is content work continuing past MVP (ENH-1-06).
- **Entities:** Product, Package, Component, RoutingRule, NutritionFacts, Allergen.
- **Dependencies:** M16 (sections vocabulary), M13/M14. **Priority:** P0. **Risks:** legacy catalog drift during coexistence — bridge reconciliation (M18); macros may be embedded in names [I]. **Open Q:** mandatory nutrition fields (workshop S8 Q22); catalog source of truth during overlap (ADR-010: legacy until migration Phase 2 cutover, then new).

## M06 — Cart / Checkout Module — **Future [NC]**
- **Purpose (provisional):** Customer self-service selection and checkout.
- **Why deferred:** No customer-facing surface was ever observed [V-gap]; current "checkout" is staff review (domain map rule 4). Building it now would violate "no generic assumptions."
- **Gaps:** GAP-CX-04 (Medium). **BRs:** none P0.
- **MVP?:** **Excluded.** Draft Order (M01) + Review (M02) fill the role. Revisit after workshop S1 Q1 confirms whether a customer app exists/should exist. **Open Q:** customer surface existence; if built, payment-first or review-first flow.

## M07 — Payment Module — **MVP-lite**
- **Purpose:** Payment attribute machine + Payment Review queue (finance-confirmed status changes).
- **Why:** Legacy `/confirm-payment` unstable [V]; no refund/reconciliation visibility (GAP-AUD-02).
- **Gaps:** GAP-AUD-02, GAP-OM-04. **BRs:** BR-029, BR-030 (P1).
- **Inputs:** Link refs from intake/legacy, finance confirmations, (future) gateway webhooks. **Outputs:** payment.status_changed events; finance audit trail.
- **Responsibilities (MVP):** Track UNPAID/LINK_SENT/PAID/FAILED/COD; finance-only status changes via review queue; every change audited with before/after. **Excluded from MVP:** gateway integration, refunds, wallet (post-workshop, DEC-009).
- **Entities:** PaymentRecord, PaymentReviewItem.
- **Dependencies:** M03, M13, M14; future: gateway adapter (M-int). **Priority:** P0 (lite). **Risks:** gateway internals unknown [NC]; dual-recording with legacy during overlap — reconciliation report (M18). **Open Q:** methods in use, confirmation timing (workshop S7).

## M08 — Kitchen Routing Module — **MVP** (ticket + board slice)
- **Purpose:** Decompose FulfillmentDays into per-section KitchenTickets via RoutingRules; shared kitchen board with statuses; escalations.
- **Why:** GAP-OPS-01 Critical — multi-section kitchen with zero system support beyond a shortage check [V].
- **Gaps:** GAP-OPS-01, GAP-OPS-02 (partial), GAP-OPS-05. **BRs:** BR-009…011, BR-014, BR-015.
- **Inputs:** fulfillment KITCHEN_QUEUED events, RoutingRules (M05), SectionMaster (M16). **Outputs:** KitchenTickets, ticket status events, READY_TO_PACK rollup, escalations to M11.
- **Responsibilities (MVP):** Ticket generation, day board filtered by section, status taps (queued/in progress/prepared/blocked), shortage escalation. **Excluded from MVP:** chef-shift assignment (BR-012), personal chef PWA (BR-013) — migration Phase 3 follow-on.
- **Entities:** KitchenTicket, TicketStatusEvent, Escalation.
- **Dependencies:** M03, M05, M16, M13/M14. **Priority:** P0. **Risks:** routing rules unknown until DEC-006 — rules are settings data (ADR-006); adoption (R9) — pilot one section. **Open Q:** sections, multi-section meals, statuses chefs accept (workshop S4).

## M09 — Delivery Assignment Module — **P4 (designed, not MVP)**
- **Purpose:** Dispatch board: readiness-filtered, rule-suggested, human-confirmed driver assignment; manifests.
- **Why:** Manual dispatch, unsafe legacy auto-assign [V], no capacity rules (GAP-DEL-01/02).
- **Gaps:** GAP-DEL-01, GAP-DEL-02, GAP-DEL-04. **BRs:** BR-020, BR-021, BR-022.
- **Inputs:** PACKED events, Driver availability (M10), Area/Slot/Capacity settings (M16). **Outputs:** DriverAssignment, manifests, dispatch.assigned events.
- **Entities:** DriverAssignment, Manifest.
- **Dependencies:** M03, M10, M16, M13/M14; DEC-008. **Priority:** P1 (build at migration Phase 4). **Risks:** capacity unit undefined [NC]; v1 rule-suggested only, never auto-commit (lesson from legacy GAP-SEC-02). **Open Q:** areas, capacity unit, overrides (workshop S6).

## M10 — Driver Management Module — **P4** (records may import earlier)
- **Purpose:** Driver profiles, availability/shifts, capacity attributes; driver app sessions (statuses WF-10/11).
- **Why:** Driver records exist in legacy [V] but no availability/capacity/app (GAP-DEL-03).
- **Gaps:** GAP-DEL-02, GAP-DEL-03. **BRs:** BR-023, BR-024.
- **Inputs:** Legacy driver import (M19), supervisor edits. **Outputs:** Availability to M09; driver app status updates → M03.
- **Entities:** Driver, Shift, CapacityRule, StopStatus.
- **Dependencies:** M09, M13/M14 (driver data visibility BR-043). **Priority:** P1/P4. **Risks:** driver workflows never observed [V-gap]; device/data realities unknown — PWA, offline-tolerant status posts. **Open Q:** capacity unit; customer-contact rules for drivers (BR-023).

## M11 — Notification Module — **MVP-lite** (internal only)
- **Purpose:** Template-based notifications with delivery history.
- **Why:** GAP-NOT-01…03; legacy push is raw broadcast [V].
- **BRs:** BR-034 (MVP), BR-035 (future — customer channel needs DEC-002).
- **Inputs:** Events (aging drafts, kitchen escalations, payment failures, dispatch readiness). **Outputs:** In-app/email alerts (MVP); WhatsApp/push/SMS customer messages (future via adapters).
- **Entities:** Template, NotificationLog.
- **Dependencies:** M13 (template admin rights), Integration adapters. **Priority:** P0-lite. **Risks:** WhatsApp template approval rules constrain content [NC]. **Open Q:** customer notification channel + consent.

## M12 — Admin User Management Module — **MVP**
- **Purpose:** Staff account lifecycle: create, deactivate, role assignment, password/session policy.
- **Why:** Legacy admin users exist [V] with no role model (GAP-SEC-01); ambiguous "Add New User" mixed staff/customers (GAP-ADM-01).
- **BRs:** BR-032 (role assignment surface). **Entities:** StaffUser, RoleAssignment, Session.
- **Dependencies:** M13, M14. **Priority:** P0. **Risks:** account sprawl repeat — joiner/leaver process documented in `09_Roles_and_Permissions/`. **Open Q:** SSO appetite [NC — DEC-011].

## M13 — RBAC / Permissions Module — **MVP (foundation)**
- **Purpose:** Roles, permissions, field-visibility classes (PII/HEALTH/PAYMENT), enforcement API for every module.
- **Why:** GAP-SEC-01 Critical. **BRs:** BR-032, BR-043.
- **Inputs:** Role definitions (`rbac_architecture.md`). **Outputs:** allow/deny + visibility masks; rbac.* audit events.
- **Entities:** Role, Permission, VisibilityClass, RoleAssignment (with M12).
- **Dependencies:** none downstream (root). **Priority:** P0 — first build (ADR-004). **Risks:** over-restriction blocks ops — staged enforcement log-only→warn→deny. **Open Q:** matrix sign-off (workshop S8 Q22).

## M14 — Audit Log Module — **MVP (foundation)**
- **Purpose:** Immutable audit write path + query/export UI for authorized roles.
- **Why:** GAP-AUD-01 Critical. **BRs:** BR-033, BR-043 (read-access logging).
- **Spec:** `audit_architecture.md`. **Entities:** AuditEvent.
- **Dependencies:** none downstream (root; M13 for read access). **Priority:** P0 — first build (ADR-005). **Risks:** volume growth — retention tiers defined up front. **Open Q:** mandatory event list confirmation (workshop S8).

## M15 — Reports Module — **MVP-lite**
- **Purpose:** Read-side projections. MVP: intake funnel (drafts/aging/approval rate), daily ops sheet (orders, exceptions), kitchen day-list. Parity rebuild of the 5 legacy finance reports [V] happens at migration Phase 5 before legacy retirement.
- **Gaps:** GAP-REP-01/02, GAP-ANA-01…03 (post-MVP). **BRs:** BR-025…028 (post-MVP), BR-031.
- **Dependencies:** event stream, M13 (report access), export logging (GAP-AUD-03). **Priority:** P0-lite. **Risks:** scope creep — locked to 3 MVP reports (ADR-009). **Open Q:** DEC-010 KPI set.

## M16 — System Settings Module — **MVP**
- **Purpose:** Business-owned configuration: SectionMaster, areas/zones, slots, cutoff times, capacity units, transition gates (payment gate), draft retention, templates, feature flags.
- **Why:** Operational rules are unknown/changing (R3/R8) — they must be config, not code (BR-044, guardrail 4).
- **Entities:** Setting, SectionMaster, Area, Slot, FeatureFlag.
- **Dependencies:** M13 (who edits what), M14 (settings.changed audit — legacy settings are unaudited [V]). **Priority:** P0. **Risks:** mis-set cutoffs disrupt kitchen — change preview + effective-date. **Open Q:** initial values all come from workshop.

## M17 — WhatsApp Order Module — **MVP = manual-assisted; API = Future**
- **Purpose:** Channel adapter for WhatsApp-originated orders. MVP: structured side-panel for agents — message reference, timestamp, sender phone → prefills M01 (paste-assisted, BR-002, ENH-QW-05 made systematic). Future (DEC-002): Business API inbound capture, consented message storage (GAP-AI-02), template outbound.
- **Gaps:** GAP-AUT-01, GAP-AI-02. **BRs:** BR-001, BR-002; BR-035 outbound (future).
- **Entities:** WhatsAppMessageRef (MVP), WhatsAppMessage (future, consent-flagged).
- **Dependencies:** M01, M04 (phone match), Integration layer (future). **Priority:** P0 (manual mode). **Risks:** API account approval/cost unknown (R7) — architecture works without it. **Open Q:** DEC-002; message retention/consent rules.

## M18 — Legacy System Bridge Module — **MVP**
- **Purpose:** Controlled coexistence with the legacy dashboard (ADR-008): read-side import, reconciliation reports, cutover flags. Three escalating patterns by access level (see `legacy_transition_architecture.md` §3): (P1) manual reconciliation checklists + CSV-assisted compare, (P2) scheduled export/import sync, (P3) DB/API read-replica sync. Baseline assumption: **pattern P1** (no access, R2).
- **Why:** R10 double-entry; BO-5 no-regression; reports parity.
- **Entities:** SyncRecord, ReconciliationReport, CutoverFlag.
- **Dependencies:** M19, access disposition (Phase 0). **Priority:** P0. **Risks:** the bridge becomes permanent — every bridge element carries a retirement date tied to a migration phase exit. **Open Q:** access level (workshop S1 Q4) → pattern choice.

## M19 — Migration / Transition Module — **MVP (tooling/process)**
- **Purpose:** One-time and repeatable migration tooling: customer import + dedup runs (DEC-012), catalog import, active-plan import, validation reports, cutover checklists, rollback runbooks per slice.
- **Why:** DEC-012; GAP-DQ-01 cleanup is a precondition for intake go-live.
- **Entities:** ImportBatch, ValidationReport.
- **Dependencies:** M04/M05/M03 targets, M18 source data, `16_Deployment/` runbooks. **Priority:** P0. **Risks:** legacy data quality unknown [NC]; imports are idempotent + dry-run-first. **Open Q:** migration scope per DEC-012 (recommend: customers + catalog + active plans only — ADR-010).

---

## Module dependency map

```
M16 Settings ──┐
M13 RBAC ──────┼──► every module (enforcement + config)
M14 Audit ─────┘
M04 Customer ◄─── M19 Migration ◄─── M18 Legacy Bridge ◄─── [legacy dashboard, read-only]
M05 Product  ◄─── M19
   │  │
   ▼  ▼
M01 Intake ◄── M17 WhatsApp ─── (future: WhatsApp API adapter)
   │
   ▼
M02 Review ──► M03 Order Mgmt ──► M08 Kitchen ──► (post-MVP: labels/packing) ──► M09 Dispatch ◄── M10 Drivers
                   │                                                                 │
                   ├──► M07 Payment (parallel machine)                               ▼
                   └──► events ──► M15 Reports · M11 Notifications · (Phase 5: AI layer)
```

Build order inside MVP: M13+M14+M16 → M12 → M04+M05 (with M19 imports) → M01+M17(manual)+M02 → M03 → M08 → M07/M11/M15 lite → M18 reconciliation running throughout.
