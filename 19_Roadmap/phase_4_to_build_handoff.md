# Phase 4 → Build Handoff

**Date:** 2026-06-11 · **Status:** Active — the entry ticket for the first coding session (WP-01)

## 1. What Phase 4 hands over

| Artifact | Status | Build uses it for |
|---|---|---|
| `10_Data_Model/physical_schema_design.md` | Proposed (PG-as-Proposed, DEC-011 open) | Wave-ordered DDL; amendments A1–A4 applied |
| `13_Architecture/backend_foundation_blueprint.md` | Proposed | Binding patterns: layering, audit-in-transaction, outbox, transition engine, staged RBAC |
| `11_API_Design/backend_module_specs.md` | Proposed | Per-module build scope + the only allowed cross-module calls |
| `10_Data_Model/migration_execution_plan.md` | Proposed | M19 tooling (WP-06/13) + cutover runbook |
| `15_Testing/test_strategy.md` | Suites fixed; UAT content [NC] | CI gates wired into every WP DoD |
| `19_Roadmap/codex_implementation_sequence.md` | Proposed | WP-01…14 order, stop-rules, entry gates |

## 2. The build entry gate (verbatim from the sequence — ALL five before WP-01)

① DEC-011 signed · ② DEC-003 signed · ③ **R1 closed — repos pushed to remote** · ④ staging + CI live · ⑤ workshop held, or sponsor accepts NC-carry for WP-01–06 only (WP-07+ and WP-14 have hard workshop dependencies).

## 3. Open [NC] register at handoff (carried, never silently resolved)

Workshop-gated: DEC-005 finals (EXPIRED item 1, cutoffs, draft retention, payment gate) · DEC-006 sections/routing content · RBAC Qs 1–5 (matrix sign-off, catalog owner, reviewer=creator, shared-device, driver COD) · ALLERGY_SEVERITY scale · PAY_METHOD + legacy payment vocabulary · mandatory intake field set · reason-code lists · off_days source · currency code · merge-review threshold sign-off · cutover day.
Access-gated: bridge pattern P1/P2/P3 (ADR-008) · real-data import runs · migration-mapping upgrade to schema-level.
Decision-gated: DEC-002 (WhatsApp API), Q20 (refunds), DEC-012 detail.

## 4. Amendments log (Phase 4 additions)

A1 customer.email applied · A2 off_days_unverified applied · **A3 transition_config table (M16)** · **A4 platform tables: outbox_event, idempotency_key, audit_read_queue**. Next free id: A5.

## 5. First session instruction

Start with **WP-01 Platform foundation** exactly as scoped; end with TS-I/TS-A(#2,#3)/TS-R(log) green and a commit referencing WP-01. No business modules, no UI beyond a login shell, no dormant tables. If any entry-gate item is unmet, the session must stop and report — not improvise.
