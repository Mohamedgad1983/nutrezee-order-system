# Nutrezee Order System — Phase 3 Data Model + API Contract Executive Summary

**Date:** 2026-06-11 · **Status:** For review (Proposed where gated on DEC-003/005 and the verification workshop)
**Builds on:** Phase 1 consolidation (2026-06-10) and Phase 2 architecture blueprint (2026-06-11). No code, no DDL, no UI was produced. Stack remains undecided (DEC-011) — everything is logical/contract-level.

## What Phase 3 produced

Eight working documents + this summary + a Phase 4 handoff: a **logical data model** (38 MVP entities, 9 dormant stubs) with field-level types and PII/HEALTH/PAYMENT visibility classes; a **data dictionary** with naming/ID/money/bilingual standards and a 25-enum registry; an **event catalog v1** (7 families, versioned envelope, replay-rebuildable projections); **API standards** (explicit transition operations, same-transaction audit, idempotent creates, masked rendering); **per-module API contracts** for all 16 MVP modules with role lists mirroring the RBAC matrix; a **migration mapping** for the three import batches (catalog → customers → active plans) with dedup pipeline and rollback; and a **validation rules binding** that turns every workshop-unknown into a configuration slot rather than code.

## Key modeling decisions (DM-01…08)

1. **Drafts and Orders are separate entities** — high-churn incomplete drafts (M01) vs audited frozen-snapshot orders (M03); the business statuses DRAFT/PENDING_REVIEW project from draft state (resolves blueprint ambiguity C6).
2. **Internal surrogate IDs + preserved business `order_number`** with a prefix rule preventing collision with legacy numbers during coexistence.
3. **Phones are their own entity**, normalized, as the matching index — keeps DEC-004 reversible.
4. **The allergy safety chain is schema-visible end to end** (7 explicit carrier fields from CustomerAllergy to KitchenTicket.allergy_marker to substitution recheck).
5. **Unrouted kitchen items are null-section tickets**, one queue, alert-on-nonzero — no silent drops.
6. **All taxonomies (reason codes) are config**, workshop-fillable, report-aggregable.
7. **Money = integer minor units**; single currency assumed, flagged for confirmation.
8. **Audit is written in-transaction, not via the event bus** — events feed projections/notifications only; security events stay off the bus entirely.

## Contradictions found in Phase 1/2 inputs (C1–C7)

All reported in `10_Data_Model/phase_3_data_model_blueprint.md` §3. Two required resolution here: RoleAssignment dual-ownership (resolved: M12 owns, M13 grants) and the draft-vs-order storage split (resolved: DM-02). One genuine model fix surfaced during migration mapping: **legacy shows customer email on screens but the logical model omitted it (amendment A1)** — to be added in the Phase 4 dictionary revision. The EXPIRED-vs-COMPLETED overlap remains a workshop item, deliberately carried in the enum.

## What is deliberately flexible (because decisions are open)

Payment gate position, kitchen cutoff, draft retention, slot capacity, coupon validation strictness, RBAC enforcement mode, and cutover switches are all **M16 settings with Proposed defaults** — the workshop fills values without schema or API change. Sections, areas, routing rules, and reason codes are **zero-row-ready** entities. Refund operations, dispatch endpoints, WhatsApp webhooks, and cart/checkout exist as **dormant, `not_enabled` stubs**.

## Top risks for this blueprint

| Risk | Note |
|---|---|
| Status model still Proposed (DEC-005) | Transition tables are config-seeded, but UAT cannot be written against unconfirmed rules — workshop before UAT remains the hard dependency |
| Legacy field knowledge is screen-level only | Migration mapping marks everything else TBD-pending-access; if P2/P3 bridge access arrives, the mapping upgrades in revision — schedule one revision pass |
| R1 still open | This phase added ~10 more uncommitted-to-remote documents until pushed |
| Payment-status vocabulary unknown | Active-plan import's payment mapping is a placeholder; finance review queue absorbs ambiguity at cutover |

## What Phase 4 should do

Physical schema + implementation specs **after** DEC-011: translate logical types to the chosen store, add indexes/constraints from the validation binding, apply amendment A1, formalize JSON field schemas, generate OpenAPI from the module contracts, build the audit/event plumbing first (ADR-004/005 order), and write UAT from the validation rule slots once the workshop fills their values. Full checklist: `19_Roadmap/phase_3_to_phase_4_handoff.md`.
