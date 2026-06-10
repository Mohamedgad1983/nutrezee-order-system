# Nutrezee Order System — Phase 2 Architecture Executive Summary

**Date:** 2026-06-11 · **Status:** For sponsor review
**Builds on:** Discovery consolidation of 2026-06-10 (00_Executive_Summary.md) and the Step 0–2C evidence record. No discovery was restarted; no production code written; no UI designed.

## What Phase 2 produced

A complete architecture blueprint for **improving and extending** the existing Nutrezee operation via the strangler-fig approach: the current dashboard keeps running, new modules go live beside it, workflows move one at a time starting with order intake/review, and old workflows retire only after 30 clean days. Eleven architecture documents, ten ADRs, and a Phase 3 handoff (file list: `13_Architecture/phase_2_architecture_blueprint.md`).

## The architecture in one paragraph

A 10-layer target architecture with security at the root: RBAC + immutable audit + business-owned settings are built before any feature (ADR-004/005). Order intake and review form the first strangler slice (ADR-003) — structured drafts with mandatory WhatsApp message references replace manual transcription. Orders follow a **two-level lifecycle** (the plan/subscription, and per-day fulfillment units — the key design insight reconciling legacy subscription states with daily kitchen/delivery reality, closing GAP-OM-02). Kitchen routing ships in MVP as a thin slice (auto-generated section tickets + shared board) with routing rules as editable settings, never code (ADR-006). Payments run as a parallel attribute machine so the open finance-policy decision (DEC-009) is a configuration, not a redesign. Everything external sits behind adapters; the legacy bridge is strictly read-only with three patterns scaled to whatever access is granted (ADR-008).

## Key architecture decisions (ADR-001…010)

1. **ADR-001/002 (Proposed/Accepted):** incremental coexistence, per-workflow per-date cutovers, rehearsed rollbacks, retirement criteria — neither codebase extension nor big-bang.
2. **ADR-003 (Accepted):** intake → review → order management first.
3. **ADR-004/005 (Accepted):** RBAC with field-level PII/HEALTH/PAYMENT visibility classes and same-transaction immutable audit as the foundation.
4. **ADR-006 (Accepted):** kitchen in MVP as ticket-generation + board; sections/rules are data.
5. **ADR-007 (Accepted):** channel-agnostic intake; WhatsApp is an adapter — manual-assisted now, API later without redesign.
6. **ADR-008 (Accepted):** read-only legacy bridge, patterns P1/P2/P3 by access.
7. **ADR-009 (Proposed = DEC-003):** MVP strictly equals closure of the six Critical gaps.
8. **ADR-010 (Accepted):** single write path per entity, append-only histories, frozen order snapshots, `origin=legacy` tagging; migrate customers + catalog + active plans only.

## MVP recommendation (DEC-003)

**In:** foundation (RBAC/audit/settings/staff), customer profiles + dedup + import, catalog mirror with routing metadata, intake + review + order lifecycle, WhatsApp manual-assisted capture, kitchen tickets + board, payment record-only + finance queue, internal alerts, 3 reports, P1 reconciliation bridge.
**Out (with return dates):** dispatch/driver app (Phase 4), labels/packing (Phase 3 follow-on), WhatsApp API (DEC-002), gateway/refunds (post-access), chef personal app (Phase 3), customer notifications, analytics suite, AI (Phase 5).
**Done when:** zero review-bypass, every WhatsApp order referenced, intake time ≤ legacy baseline, 100% items ticketed with empty unrouted queue, audit reconstruction test passes, 8 roles in deny-mode, 30 clean reconciliation days.

## Critical risks

| Risk | Why it matters now |
|---|---|
| **R1 — no remote backup** | Two days of project knowledge on one machine. Push before anything else. |
| R2 — access never granted | Architecture survives it (P1 bridge baseline), but quick wins on legacy security (mutating GET, leaked exceptions, no logout) die without an owner — those are live production exposures [V]. |
| R3 — desk-derived requirements | Status model, RBAC matrix, routing/dispatch rules are **Proposed** until the workshop; building UAT on unconfirmed rules is the main schedule risk. |
| R9 — adoption | Intake agents and kitchen staff make or break the strangler slices; time-per-order and pilot-first are designed in, but management sponsorship is required. |
| R5 — scope pressure | 34 P0 requirements vs a strict MVP — ADR-009 is the contract; amendments go through the sponsor. |

## Open questions (must close at the verification workshop)

Order state machine finals (EXPIRED vs COMPLETED, cutoffs, payment gate, draft retention) · kitchen sections/routing/shifts/devices · label specs · dispatch areas + capacity unit · payment methods + refunds existence · customer surface existence (Cart/Checkout fate) · RBAC matrix sign-off + catalog ownership · KPI set · WhatsApp API appetite. Full inventory: `19_Roadmap/phase_2_to_phase_3_handoff.md` §4.

## What Phase 3 should do next

1. Close the five hard blockers: workshop, DEC-001, DEC-003, DEC-011, **R1 backup**.
2. Then in order: workshop synthesis → data model (`10_Data_Model/`) → API/event contracts (`11_API_Design/`) → UI/UX for the four MVP surfaces (`12_UI_UX/`) → staging/CI (`16_Deployment/`) → test strategy + migration tooling → pilot plan (one agent, one section).
3. Scope guards: no production code before DEC-003 signature; no design for excluded modules; no ERP/HR expansion.
