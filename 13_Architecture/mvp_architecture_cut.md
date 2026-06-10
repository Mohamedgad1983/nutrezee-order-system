# Phase 2K — MVP Architecture Cut

**Date:** 2026-06-11 · **Status:** Proposed — this IS the recommendation for DEC-003 (ADR-009); sponsor sign-off required
Cut philosophy: the MVP must close the six Critical gaps (GAP-OM-01, GAP-OPS-01, GAP-AUT-01, GAP-SEC-01, GAP-SEC-02¹, GAP-AUD-01) and **nothing else**. Everything below the line is deliberately excluded, however attractive.
¹ GAP-SEC-02/03/04 are legacy quick wins (ENH-QW-02/03/04) running parallel to MVP, owned by the legacy-system owner — tracked with MVP but not built in it.

## 1. MVP modules (from `module_blueprint.md`)

| In | Slice |
|---|---|
| M13 RBAC + M14 Audit + M16 Settings | Full foundation (root layer) |
| M12 Staff accounts | Full |
| M04 Customers | Profiles, phone match, dedup, addresses, allergies + legacy import (M19) |
| M05 Product/Menu | Read-mostly mirror + routing metadata + structured allergens (macros completion continues post-MVP) |
| M01 Intake + M02 Review + M03 Order Mgmt | Full (the strangler slice, ADR-003) |
| M17 WhatsApp | Manual-assisted mode only (message refs) |
| M08 Kitchen Routing | Ticket generation + shared section board + escalations |
| M07 Payment | Record-only machine + finance review queue |
| M11 Notifications | Internal alerts only |
| M15 Reports | Exactly 3: intake funnel, daily ops sheet, kitchen day-list |
| M18 Bridge + M19 Migration | Pattern P1 reconciliation + customer/catalog import tooling |

## 2. Excluded from MVP (with the discipline reason)

| Excluded | Why excluded | Returns at |
|---|---|---|
| M06 Cart/Checkout | No verified customer surface [V-gap]; assumption-driven build | After workshop S1 Q1 |
| M09 Dispatch + M10 Driver app | DEC-008 inputs missing; kitchen must stabilize first | Migration Phase 4 |
| Labels + packing checklist module | DEC-007 hardware/spec unknown; kitchen board must exist first | Phase 3 follow-on |
| WhatsApp Business API | DEC-002 open; account approval risk (R7); manual mode already closes the transcription gap structurally | Phase 3+ |
| Gateway integration, refunds, wallet | Access item 8 missing; refunds existence unconfirmed (workshop Q20) | Post-access |
| Chef personal PWA + shift assignment (BR-012/013) | DEC-006 shifts unknown; shared board first (R9 adoption) | Phase 3 |
| Customer notifications (BR-035) | Channel + consent undecided (DEC-002) | Phase 4/5 |
| Analytics suite, 5-report parity (BR-025–028) | DEC-010 open; parity belongs to Phase 5 retirement work | Phase 5 |
| Meal-plan automation extras (renewal prompts, off-day self-service) | Core calendar (BR-036) IS in M03; automation extras are not | Phase 4 |
| Exception hub (full BR-042), inventory (BR-040), freshness (BR-041), AI (all) | Post-foundation by definition | Phases 4–5 |

## 3. MVP workflows

WF-01, WF-02 (manual mode), WF-03, WF-04, WF-05, WF-06, WF-07, WF-08, WF-12, WF-13 (failed-payment path; refunds only if workshop confirms), WF-14 (case capture + allergy escalation only), WF-15, WF-16. **Not in MVP:** WF-09/10/11 (Phase 4).

## 4. MVP roles (8 active)

Super Admin, Admin, Operations Manager, Order Agent, Kitchen User, Support Agent, Finance, Report Viewer. Dormant-defined: WhatsApp Agent, Branch Manager, Driver, Fleet Supervisor (`rbac_architecture.md`).

## 5. MVP reports (exactly 3)

1. **Intake funnel:** drafts created / aging / submitted / approved / rejected, by agent and channel, with SLA timers.
2. **Daily ops sheet:** orders active, fulfillment days by status, exceptions open, payment statuses — replaces manual ENH-QW-06 sheet.
3. **Kitchen day-list:** tickets by section/status, unrouted queue, escalations.
All exportable (INT-06, audited). Legacy finance reports remain in legacy untouched.

## 6. MVP technical boundaries

- Single deployable scope acceptable (modular monolith) — service split is a DEC-011/Phase 3 choice; module boundaries per blueprint are non-negotiable either way.
- Events versioned from v1 even if transport is in-process (future AI/analytics depend on it — GAP-AI-01).
- PWA web app only; no native apps; kitchen board runs on a shared tablet/terminal [NC device — workshop S4].
- Bilingual EN/AR data fields from day one; UI localization English-first, Arabic per workshop priority [NC].
- No GET mutations; same-transaction audit; staged RBAC enforcement (log→warn→deny).
- Integrations: INT-01 P1 + INT-06 only. Nothing real-time external.

## 7. MVP success criteria (gate to call MVP done)

1. 100% of new orders enter via M01/M02 — zero review bypass (GAP-OM-01 closed).
2. Every WhatsApp-originated order carries a message reference (GAP-AUT-01 structurally closed; BR-002).
3. Intake time per order ≤ legacy baseline (measured vs ENH-QW-06 baseline).
4. 100% of day-D items appear on section tickets; unrouted queue empty at pilot exit (GAP-OPS-01 closed).
5. Audit acceptance tests pass (`audit_architecture.md` §tests — GAP-AUD-01 closed).
6. All 8 roles operating under deny-mode RBAC with zero shared accounts (GAP-SEC-01 closed).
7. Duplicate-customer creation rate at intake ≈ 0; legacy import deduped with merge audit trail.
8. Daily reconciliation (P1) clean for 30 consecutive days → legacy order-create retired by policy.
9. Legacy quick wins (ENH-QW-02/03/04) confirmed live or formally blocked-with-owner — tracked, not forgotten.

## 8. MVP risks

| Risk | Mitigation |
|---|---|
| Workshop slips → DEC-005/006 inputs late | Status model + sections are config/Proposed; build proceeds, content lands at UAT — but **workshop before UAT is a hard dependency** |
| Agent adoption (R9) | Time-per-order is a tracked KPI from pilot day 1; intake must beat legacy form ergonomics |
| Kitchen shared-device audit fidelity | Accepted MVP trade-off: shared login + name-tap [Proposed]; per-chef identity arrives with chef app Phase 3 |
| Catalog mirror drift (P1 bridge) | Weekly reconciliation + stale banner; catalog cutover ASAP after MVP |
| Scope pressure to add dispatch "while we're at it" | This document is the contract; additions require DEC-003 amendment by sponsor |
| Legacy owner unresponsive on quick wins | Quick wins tracked as risks R4; MVP itself has zero legacy-change dependencies |
