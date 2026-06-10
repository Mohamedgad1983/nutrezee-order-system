# Phase 2 → Phase 3 Handoff

**Date:** 2026-06-11 · **Status:** Active
Phase 2 (Architecture Blueprint) is complete as documentation. Phase 3 = **Detailed Design & Build Preparation** (workflow detailing, data model, API/event contracts, UI/UX, environment standup) feeding the MVP build. This file is the entry ticket.

## 1. What Phase 2 delivers to Phase 3

| Artifact | Status | Phase 3 consumes it for |
|---|---|---|
| `13_Architecture/target_architecture.md` | Baselined | Container/deployment design after DEC-011 |
| `13_Architecture/module_blueprint.md` (M01–M19) | Baselined boundaries | Work breakdown; build order |
| `13_Architecture/order_lifecycle_status_model.md` | **Proposed** (DEC-005) | State-machine implementation spec |
| `13_Architecture/workflow_architecture.md` (WF-01–16) | Proposed | Detailed BPMN + acceptance criteria in `07_Workflows/` |
| `13_Architecture/rbac_architecture.md` | Proposed matrix | `09_Roles_and_Permissions/` final matrix + enforcement config |
| `13_Architecture/audit_architecture.md` | Baselined | Audit service spec + event vocabulary v1 |
| `13_Architecture/legacy_transition_architecture.md` | Baselined approach | Cutover runbooks in `16_Deployment/` |
| `13_Architecture/data_ownership_blueprint.md` | Baselined | ERDs + dictionary in `10_Data_Model/` |
| `13_Architecture/integration_boundaries.md` | Baselined | Adapter contracts in `14_Integrations/` |
| `13_Architecture/mvp_architecture_cut.md` | **Proposed = DEC-003 recommendation** | Release 1 scope |
| `20_Decisions/architecture_decision_records.md` | Mixed (see statuses) | Constraint set for all detailed design |

## 2. Hard blockers Phase 3 cannot start without

1. **Verification workshop held** (`22_Meeting_Notes/verification_workshop_agenda.md`) — closes DEC-002/004/005/006/009 inputs; converts status model + RBAC matrix from Proposed to Baselined.
2. **DEC-001 finalized** (access disposition → bridge pattern, ADR-008).
3. **DEC-003 signed** (MVP cut acceptance or amendment by sponsor).
4. **DEC-011 stack/hosting chosen** — everything in Phase 2 is deliberately stack-agnostic; Phase 3 is where that ends.
5. **R1 closed** — repos pushed to a private remote. Non-negotiable before more work accumulates.

## 3. Phase 3 work plan (recommended order)

| # | Workstream | Output folder | Depends on |
|---|---|---|---|
| 1 | Workshop synthesis: update backlog statuses, baseline status model + RBAC matrix, fill Settings initial values | `05_Requirements/`, `08_Business_Rules/` | Workshop |
| 2 | Data model: ERDs per owning module, dictionary, migration mapping detail (DEC-012) | `10_Data_Model/` | ADR-010, workshop |
| 3 | API + event contracts: module APIs, event catalog v1 (order./fulfillment./payment.*), audit API | `11_API_Design/` | 2 |
| 4 | UI/UX: intake form, review queue, kitchen board, settings admin — bilingual/RTL standards | `12_UI_UX/` | 1; journeys in `06_User_Journeys/` |
| 5 | Environments: staging, CI/CD, secrets, backup/restore (SO-1) | `16_Deployment/` | DEC-011 |
| 6 | Test strategy: audit acceptance tests, regression-vs-50-screens checklist, UAT scripts for WF-01…08 | `15_Testing/` | 1–4 |
| 7 | Migration tooling spec: customer dedup rules, import dry-runs, reconciliation report formats | `10_Data_Model/`, M19 | 2, DEC-012 |
| 8 | Pilot plan: one agent + one kitchen section, baseline metrics from ENH-QW-06 sheet | `19_Roadmap/` | All |

## 4. Open questions inventory (carried from Phase 2 files)

- Status model items 1–6 (`order_lifecycle_status_model.md` §open items) — workshop S2/S4/S7.
- RBAC questions 1–5 (`rbac_architecture.md` §open questions) — S2/S3/S4/S8.
- Audit retention statutory check — legal input [NC].
- Kitchen shared-device login model — S4.
- Catalog ownership role — S8.
- Customer surface existence (Cart/Checkout fate) — S1 Q1.
- Refunds existence (WF-13 scope) — S7 Q20.

## 5. Do-not-do list for Phase 3 (scope guard)

- No production source code beyond environment/CI scaffolding until DEC-003 signed.
- No UI for modules outside the MVP cut.
- No schema for dormant entities beyond ownership stubs (Driver/Dispatch instantiate in Phase 4 design refresh).
- No ERP/HR/accounting integration design (out of scope per `integration_boundaries.md`).
