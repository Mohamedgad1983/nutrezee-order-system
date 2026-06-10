# Phase 6 — Project Documentation Structure

**Date:** 2026-06-10 · **Status:** Active
Root: `NutrezeeOrderSystem/`. The original discovery repo (`nutrezee-step-1-discovery/`) is preserved unmodified as the evidence record; folders below hold the consolidated, living documentation. Each folder contains a `README.md` restating its charter.

| Folder | Purpose | Documents to store | Owner | Depends on |
|---|---|---|---|---|
| `01_Discovery/` | Consolidated discovery findings; index into the raw discovery repo | `discovery_consolidation.md` (Phase 1 deliverable), evidence index, access-request tracker | PM/BA | `nutrezee-step-1-discovery/` |
| `02_Current_State/` | As-is system and process documentation | `current_state_assessment.md` (Phase 2), journey maps, screen inventories (linked), confidence register | BA | 01 |
| `03_Gap_Analysis/` | Current vs. future gaps | `gap_analysis.md` (Phase 3, 52-gap register), severity matrix, gap-closure tracking | PM/BA | 02, 05 |
| `04_Enhancement_Blueprint/` | Future-state improvement designs | `enhancement_blueprint.md` (Phase 4), per-enhancement one-pagers, dependency spine | PM + Solution Architect | 03 |
| `05_Requirements/` | Functional/non-functional requirements | BR backlog (BR-001–044, source: discovery repo), NFRs, acceptance criteria, traceability matrix (BR↔GAP↔ENH↔test) | BA | 01, workshop outputs |
| `06_User_Journeys/` | Future-state journeys per persona | Customer, intake staff, kitchen manager, chef, packing, dispatcher, driver, finance, dietician, management journeys | UX + BA | 02, 04 |
| `07_Workflows/` | Operational workflow specifications | Intake→confirmation, order change, kitchen task, packing/label, dispatch, payment review, refund, exception workflows (BPMN/flowcharts) | BA + Ops leads | 06, 08 |
| `08_Business_Rules/` | Rules engine of the business | Order state machine (DEC-005), routing rules, capacity rules, coupon rules, cutoffs, allergy rules, pricing | Ops + BA | Workshop decisions |
| `09_Roles_and_Permissions/` | RBAC model | 10-role matrix (BR-032), field-level privacy map (BR-043), data-visibility rules per role, RACI | Security + PM | 08 |
| `10_Data_Model/` | Logical and physical data design | ERDs per domain, dictionary, migration mapping (old→new, DEC-012), retention rules | Data Architect | 13, old-schema access |
| `11_API_Design/` | Service contracts | API standards, per-domain endpoint specs, event catalog (order/payment/delivery events), webhook contracts | Tech Lead | 10, 13 |
| `12_UI_UX/` | Design system and screens | Wireframes (admin shell, intake queue, kitchen board, chef PWA, dispatch board, driver PWA), design tokens, bilingual/RTL standards | UX | 06 |
| `13_Architecture/` | System architecture | `domain_map.md` (Phase 5), context/container diagrams, stack decision (DEC-011), strangler migration plan (DEC-001), ADRs | Solution Architect | 03, 04, DEC-001/011 |
| `14_Integrations/` | External system contracts | WhatsApp Business API, payment gateway, printer/label hardware, maps/geo, push/SMS/email — one spec + adapter contract each | Tech Lead | 11, vendor docs |
| `15_Testing/` | Quality strategy | Test strategy, regression checklist (= 50-screen coverage map), UAT scripts per workflow, performance/security test plans | QA Lead | 05, 07 |
| `16_Deployment/` | Environments and release | Environment matrix (dev/staging/prod), CI/CD pipeline, release/rollback runbooks, backup/restore, monitoring | DevOps | 13 |
| `17_Analytics/` | KPI and reporting design | KPI definitions (DEC-010), dashboard specs, event-to-metric mapping, report catalog (preserving the 5 legacy reports) | PM + Finance | 11 (events) |
| `18_AI_Features/` | AI capability specs | AI intake assistant, forecasting, dispatch optimization, nutrition copilot — each with data prerequisites, evaluation criteria, human-in-the-loop design | PM + Tech Lead | 17, event history |
| `19_Roadmap/` | Delivery planning | `implementation_roadmap.md` (Phase 7), release plans, milestone tracker, capacity plan | PM | 04, 20 |
| `20_Decisions/` | Decision log | DEC-001…012 one file each: context, options, decision, consequences, date, approver | PM (gatekeeper: Sponsor) | All |
| `21_Risks/` | Risk register | Living risk log (R1–R8 seeded from exec summary), mitigation owners, review cadence | PM | All |
| `22_Meeting_Notes/` | Workshop and meeting records | Verification workshop (22 questions from Step 2B.1), department interviews, sign-off minutes — using `meeting_template.md` from discovery repo | PM | — |

## Conventions

- **One source of truth per fact.** Raw evidence stays in `nutrezee-step-1-discovery/` and is linked, never copied-and-drifted.
- **IDs everywhere:** BR-xxx (requirements), GAP-xx-nn (gaps), ENH-x-nn (enhancements), DEC-nnn (decisions), R-n (risks). The traceability matrix in `05_Requirements/` joins them.
- **Status header** on every doc: Draft → In Review → Baselined → Superseded.
- **Git:** this entire tree is version-controlled; baseline changes go through review. Push to a private remote (ENH-QW-01).
