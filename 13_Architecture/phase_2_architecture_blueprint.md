# Phase 2A — Architecture Input Review & Blueprint Index

**Date:** 2026-06-11 · **Status:** Baselined v1.0 · **Owner:** Solution Architect
**Strategy mandate:** Strangler-fig — keep the current system running, build new modules beside it, move one workflow at a time starting with order intake/review, retire old workflows only when proven (per DEC-001 leaning, ADR-001/002).

Evidence labels used in every blueprint file: **[V]** Verified · **[I]** Inferred · **[A]** Assumed · **[NC]** Needs Confirmation.

## Blueprint file set (this phase's output)

| File | Content | Covers prompt phase |
|---|---|---|
| `phase_2_architecture_blueprint.md` | Input review, this index | 2A |
| `target_architecture.md` | 10-layer target architecture | 2B |
| `module_blueprint.md` | 19 modules fully specified | 2C |
| `workflow_architecture.md` | 16 future-state workflows | 2D |
| `order_lifecycle_status_model.md` | Dual-level status model + transition tables | 2E |
| `rbac_architecture.md` | 12 roles, permissions matrix | 2F |
| `audit_architecture.md` | Audit event catalog, record schema, retention | 2G |
| `legacy_transition_architecture.md` | Strangler-fig coexistence & migration phases | 2H |
| `data_ownership_blueprint.md` | 19 entities: ownership, quality, audit | 2I |
| `integration_boundaries.md` | 6 integration boundaries | 2J |
| `mvp_architecture_cut.md` | Strict MVP scope | 2K |
| `../20_Decisions/architecture_decision_records.md` | ADR-001…010 | 2L |
| `../19_Roadmap/phase_2_to_phase_3_handoff.md` | Handoff package | 2M |
| `../00_Phase_2_Architecture_Executive_Summary.md` | Executive summary | 2N |

## 1. Architecture Input Summary

| Source document | Architecture-relevant input |
|---|---|
| `00_Executive_Summary.md` | 46/50 old routes confirmed [V]; manual WhatsApp/kitchen/labels/dispatch chain [A]; 12 major gaps; DEC-001…012 register |
| `01_Discovery/discovery_consolidation.md` | Objectives BO-1…5, OO-1…5, SO-1…6; stakeholder table; evidence convention |
| `02_Current_State/current_state_assessment.md` | Six as-is journeys; end-to-end workflow map; confidence register (kitchen/delivery/customer = Low confidence) |
| `03_Gap_Analysis/gap_analysis.md` | 52 gaps; 6 Critical: GAP-OM-01, GAP-OPS-01, GAP-AUT-01, GAP-SEC-01, GAP-SEC-02, GAP-AUD-01 |
| `04_Enhancement_Blueprint/enhancement_blueprint.md` | ENH dependency spine; MVP cut-line guidance (ENH-1-01→1-03+1-04 floor) |
| `13_Architecture/domain_map.md` | 17 domains; root domains = Settings/RBAC/Audit; Orders = hub; Cart/Checkout provisional |
| `19_Roadmap/implementation_roadmap.md` | Phases 0–5; gates G0–G4 |
| `20_Decisions/decision_register.md` | All 12 decisions OPEN; DEC-001 leaning strangler-fig |
| `21_Risks/risk_register.md` | R1–R10; R2 (access), R3 (unvalidated requirements), R10 (double entry) shape architecture directly |
| `22_Meeting_Notes/verification_workshop_agenda.md` | 22 questions; sessions map 1:1 to open decisions |
| `nutrezee-step-1-discovery/` (evidence record) | BR-001…044 backlog [V as documented]; 50-screen coverage map; route/screen inventory |

**Missing inputs:** none of the listed files are missing. Missing *evidence* (not files): old-system source, schema, API, customer/driver/kitchen surfaces — all [NC], tracked as the 12 access items (Phase 0 gate).

## 2. Confirmed Requirements (architecture treats as fixed)

Confirmed = Verified old-system behavior to preserve, or backlog items marked Proposed-P0 with unambiguous intent:

- Order lifecycle categories pending/active/pause/expired/cancelled exist and must be preserved [V — order lists, screen coverage refs 13–17].
- Staff-assisted order creation with payment-link generation exists and remains a supported workflow [V — `/orders/create`, Step 2C pack].
- Catalog masters exist: products, packages, ingredients, allergies, meal types, diet status, tags, package-for, slots, methods [V].
- Five finance reports are the reporting parity contract [V — monthly/daily/by-method/customer revenue/expiration].
- Draft intake + incomplete-order queue + review before kitchen/dispatch impact (BR-001…005) — cornerstone requirement.
- Customer phone-matched profiles with multi-address (BR-006/007).
- RBAC for 10+ roles, field-level privacy, audit of sensitive actions (BR-032/033/043) — Critical gaps GAP-SEC-01/GAP-AUD-01.
- Kitchen section routing from order items (BR-009…011) — Critical gap GAP-OPS-01.
- 50-screen coverage map is the regression checklist; no module dropped without a DEC [Step 2B map].

## 3. Needs-Confirmation Requirements (architecture keeps flexible)

| Item | Why open | Flexibility built in |
|---|---|---|
| WhatsApp Business API vs manual-assisted (BR-001/002) | DEC-002 open; account status unknown [NC] | Intake module is channel-agnostic; WhatsApp module is an adapter (ADR-007) |
| Exact order state machine incl. delivered/completed | DEC-005 open; no terminal state observed [V-gap, GAP-OM-02] | Status model proposed in `order_lifecycle_status_model.md`, marked Proposed until workshop |
| Kitchen sections, routing rules, chef shifts (BR-011/012) | DEC-006 open [NC] | Sections/rules are Settings data, not code (ADR-006) |
| Label fields/printer (BR-016…018) | DEC-007 open [NC] | Outside MVP; label module isolated behind printing adapter |
| Dispatch areas/capacity unit (BR-020/021) | DEC-008 open [NC] | Delivery layer designed, build deferred to migration Phase 4 |
| Payment timing vs kitchen start, refunds (BR-029/030) | DEC-009 open [NC] | Payment is a parallel attribute machine, not an order state — gate configurable |
| Customer identity key (BR-006) | DEC-004 open; phone assumed [A] | Customer entity keyed by internal ID; phone is a unique-candidate index |
| Inventory/freshness (BR-040/041) | Future Candidate status | Excluded from architecture except event hooks |
| Branch/central-kitchen model | Never observed [NC] | Single-site assumed [A]; entities carry optional `site` field, unused in MVP |

## 4. Critical Gaps Shaping the Architecture

| Gap | Architectural consequence |
|---|---|
| GAP-SEC-01 no RBAC (Critical) | Security layer is layer 0; every module behind it from first commit (ADR-004) |
| GAP-AUD-01 no audit (Critical) | Audit is a write-path platform service, not a feature module (ADR-005) |
| GAP-OM-01 no draft/review (Critical) | Order Intake + Review Queue are the first strangler slice (ADR-003) |
| GAP-AUT-01 manual WhatsApp transcription (Critical) | Intake designed for structured capture from day one, message-reference field mandatory (BR-002) |
| GAP-OPS-01 no kitchen routing (Critical) | Kitchen Ticket generation included in MVP, minimal board not full chef app (ADR-006) |
| GAP-SEC-02 mutating GET route (Critical) | New system: no state change on GET ever; legacy: quick-win ENH-QW-02 independent of this blueprint |
| GAP-OM-02 incomplete state machine (High) | Dual-level lifecycle (plan vs fulfillment day) — see §order_lifecycle |
| GAP-DQ-01 duplicate customers (High) | Customer module owns identity; intake cannot create free-text customers |
| GAP-SCA-02 no staging/CI (High) | Transition architecture requires staging before any production-affecting bridge |

## 5. Decisions Still Open (and what blocks on them)

All DEC-001…012 are OPEN [decision_register.md]. Architecture proceeds on explicit provisional positions, recorded as ADRs with status *Proposed*:

| DEC | Provisional position in this blueprint | Blocked work if unresolved |
|---|---|---|
| DEC-001 | Strangler-fig (ADR-001/002) | Bridge design depth (ADR-008) |
| DEC-002 | Manual-assisted intake first, API-ready (ADR-007) | WhatsApp adapter build |
| DEC-003 | MVP per `mvp_architecture_cut.md` (ADR-009) | Build start |
| DEC-004 | Phone as matching key, internal ID as identity [A] | Customer dedup rules |
| DEC-005 | Status model as proposed [Proposed] | Workflow finalization |
| DEC-006 | Sections as configurable settings data | Routing rule content |
| DEC-009 | Payment parallel machine, configurable gate | Payment review behavior |
| DEC-011 | Stack-agnostic blueprint; constraints listed in `target_architecture.md` §Technology guardrails | Phase 3 detailed design |
| DEC-012 | Customer + active-order import only (ADR-010) | Migration tooling |

## 6. Risks That Must Shape Architecture

| Risk | Architectural response |
|---|---|
| R2 source/staging access may never come | Architecture assumes **zero integration with legacy internals** as baseline; Legacy Bridge has three escalating patterns (manual reconciliation → export/import → DB/API sync) chosen by access level (ADR-008) |
| R3 requirements desk-derived, unvalidated | Everything operational (sections, areas, capacities, templates) is configuration, not code; status model and RBAC matrix ship as Proposed pending workshop |
| R4 unsafe legacy surfaces | New system isolated from legacy auth/session; quick wins tracked separately |
| R6 PII/health exposure during transition | Field-level visibility classes (PII/HEALTH/PAYMENT) defined in RBAC architecture; legacy access shrink is QW-07 |
| R9 shop-floor adoption | Kitchen MVP = passive board + simple status taps, piloted one section first |
| R10 double entry during coexistence | Hard per-workflow cutover rule: a workflow lives in exactly one system at a time (legacy_transition §5) |
