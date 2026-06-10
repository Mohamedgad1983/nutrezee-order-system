# Phase 3 → Phase 4 Handoff

**Date:** 2026-06-11 · **Status:** Active
Phase 3 (Logical Data Model + API/Event Contracts) is complete as documentation. Phase 4 = **Physical Design & Build Preparation**: schema, OpenAPI, environment standup, UAT authoring, then the MVP build per the migration phases. This file is the entry ticket.

## 1. What Phase 3 hands over

| Artifact | Status | Phase 4 uses it for |
|---|---|---|
| `10_Data_Model/logical_data_model.md` | Proposed (DEC-005/003) | Physical schema per chosen store |
| `10_Data_Model/data_dictionary.md` | Proposed | Naming/type/enum source of truth |
| `10_Data_Model/migration_mapping.md` | Proposed; screen-level evidence | Import tooling (M19) build |
| `11_API_Design/api_standards.md` | Baselined | API framework conventions |
| `11_API_Design/event_catalog.md` | Baselined envelope / Proposed payloads | Event plumbing + projection rebuild tests |
| `11_API_Design/module_api_contracts.md` | Proposed | OpenAPI generation after DEC-011 |
| `08_Business_Rules/validation_rules_binding.md` | Rule slots fixed; values workshop-gated | Validation layer + UAT templates |
| `10_Data_Model/phase_3_data_model_blueprint.md` §3 | C1–C7 + amendments A1/A2 | Known-issues list — apply A1 (Customer.email) first |

## 2. Hard blockers — unchanged from Phase 2 handoff, still open

1. **R1: no git remote.** Three phases of documentation on one machine. First action, before any Phase 4 work.
2. **Verification workshop** — fills: status-model items 1–6, RBAC Qs 1–5, sections/areas/routing content, reason-code lists, PAY_METHOD + payment-status vocabularies, ALLERGY_SEVERITY scale, nutrition mandatory set, settings defaults.
3. **DEC-003** (MVP cut sign-off) and **DEC-011** (stack/hosting) — Phase 4 literally cannot choose column types or generate OpenAPI without DEC-011.
4. **DEC-001 finalization** via Phase 0 access disposition → bridge pattern (P1/P2/P3) → possible migration-mapping upgrade to schema-level.

## 3. Phase 4 work plan (recommended order)

| # | Workstream | Notes |
|---|---|---|
| 1 | Apply workshop outputs: baseline status model, RBAC matrix, enum values, settings defaults; update Phase 3 docs from Proposed→Baselined | Re-stamp statuses; log changes in `20_Decisions/` |
| 2 | DEC-011 ADR + environment standup (staging, CI/CD, secrets, backup) | `16_Deployment/`; SO-1 gate |
| 3 | Physical schema from logical model (+A1, JSON sub-schemas, indexes from validation binding) | `10_Data_Model/` physical rev |
| 4 | Foundation build: M13 RBAC → M14 audit → M16 settings → M12 staff (ADR-004/005 order); audit acceptance tests from `audit_architecture.md` | First code of the project |
| 5 | OpenAPI from module contracts; event plumbing + replay-rebuild test harness | `11_API_Design/` formal specs |
| 6 | M19 import tooling + dry-runs against whatever legacy data access allows | Validation reports reviewed with Ops |
| 7 | UAT scripts from validation rule slots + allergy-chain scenarios 1–7 (mandatory) | `15_Testing/` |
| 8 | Intake/review/kitchen UI build per `12_UI_UX/` designs (UI design itself is also Phase 4, per Phase 2's no-UI rule) | Pilot: one agent, one section |

## 4. Do-not-do list (scope guard, inherited + extended)

- No build of dormant stubs (dispatch, drivers, cart/checkout, refunds, WhatsApp webhook) beyond keeping enums/flags in place.
- No invention of legacy schema details — migration mapping upgrades only on real access.
- No transition logic hard-coded — config-seeded per validation binding §4.
- No bus transport gold-plating — in-process eventing is acceptable for MVP; the contract tests are what matter.
- Order System only; no ERP/HR/accounting.

## 5. Success criteria for Phase 4 completion

MVP success criteria in `13_Architecture/mvp_architecture_cut.md` §7 apply unchanged; Phase 4 is done when the MVP is live for the pilot scope (one agent, one kitchen section), audit acceptance tests pass, and the 30-day reconciliation clock (legacy_transition §8) is running.
