# Nutrezee Order System — Phase 3 Master Prompt
# Data Model + API Contract Blueprint Based on Completed Phase 1 + Phase 2 Documents

You are working inside the existing Nutrezee Order System project folder.

IMPORTANT:
Do NOT restart discovery.
Do NOT redesign the Phase 2 architecture — extend it.
Do NOT write production source code, SQL/DDL, or framework-specific code.
Do NOT design UI screens.
Do NOT produce OpenAPI/proto specs yet — DEC-011 (stack/hosting) is open; stay stack-agnostic.
Do NOT finalize anything the Phase 2 documents mark Needs Confirmation — model it as configurable, or label it Proposed with the blocking DEC/workshop question.
Do NOT model excluded-from-MVP modules beyond ownership stubs (mvp_architecture_cut.md §2).

Your job: read the completed Phase 1 + Phase 2 documentation and produce
PHASE 3 — LOGICAL DATA MODEL + API/EVENT CONTRACT BLUEPRINT
detailed enough that Phase 4 can write physical schema and implementation specs without reinterpreting the business.

==================================================
INPUT DOCUMENTS (the only allowed basis)
==================================================

Phase 1 — consolidation (2026-06-10):
- 00_Executive_Summary.md
- 01_Discovery/discovery_consolidation.md
- 02_Current_State/current_state_assessment.md
- 03_Gap_Analysis/gap_analysis.md          (52 gaps, GAP-xx-nn)
- 04_Enhancement_Blueprint/enhancement_blueprint.md (ENH-x-nn)
- 05_Requirements → BR-001…044 (source: nutrezee-step-1-discovery/docs/02_requirements/business_requirements_backlog.md)

Phase 2 — architecture (2026-06-11), start with the index file:
- 13_Architecture/phase_2_architecture_blueprint.md   (index + input review)
- 13_Architecture/target_architecture.md              (10 layers, technology guardrails)
- 13_Architecture/module_blueprint.md                 (modules M01–M19 + dependency map)
- 13_Architecture/workflow_architecture.md            (workflows WF-01–16)
- 13_Architecture/order_lifecycle_status_model.md     (two-level status model — THE SPINE)
- 13_Architecture/rbac_architecture.md                (12 roles, PII/HEALTH/PAYMENT visibility classes)
- 13_Architecture/audit_architecture.md               (event schema, same-transaction rule)
- 13_Architecture/legacy_transition_architecture.md   (bridge patterns P1/P2/P3)
- 13_Architecture/data_ownership_blueprint.md         (19 entities, ownership rules — HARD CONSTRAINTS)
- 13_Architecture/integration_boundaries.md           (INT-01…06)
- 13_Architecture/mvp_architecture_cut.md             (MVP scope = ADR-009)
- 20_Decisions/decision_register.md + architecture_decision_records.md (DEC-001…012, ADR-001…010)
- 19_Roadmap/phase_2_to_phase_3_handoff.md            (blockers + open-question inventory)
- 21_Risks/risk_register.md                           (R1–R10)

If any file is missing, report it clearly and continue with the rest.

Binding constraints you must not violate:
1. One owning module per entity, single write path (ADR-010).
2. Append-only: OrderStatusHistory, ReviewDecision, DeliveryEvent, NotificationLog, AuditEvent.
3. Frozen-at-approval snapshots for Order Items.
4. Derived data (KitchenTicket, report projections) regenerable, never source of truth.
5. PII / HEALTH / PAYMENT visibility classes attach at field level.
6. Audit written in the same transaction as the state change; no GET mutations.
7. Bilingual EN/AR data fields from the first entity.
8. Events versioned v1, append-only, consumers tolerate unknown fields.
9. Imported rows carry origin=legacy + import_batch.
10. Status vocabularies come from order_lifecycle_status_model.md verbatim — do not invent states.

==================================================
PHASE 3A — INPUT REVIEW
==================================================
Produce a short review (one file section):
1. Locked constraints inherited from Phase 2 (list, with ADR/DEC refs).
2. Open items that affect data/API design (status-model open items 1–6, RBAC open questions 1–5, DEC-002/004/005/006/009/011/012) and HOW each is kept flexible in your design.
3. Anything in Phase 1/2 documents that is contradictory or ambiguous — report, do not silently resolve.
Label every statement Verified / Inferred / Assumed / Needs Confirmation.

==================================================
PHASE 3B — LOGICAL DATA MODEL (per MVP module)
==================================================
Scope: MVP modules only — M01, M02, M03, M04, M05, M07 (record-only slice), M08, M11 (lite), M12, M13, M14, M15 (3 reports), M16, M17 (manual mode), M18, M19.
Dormant stubs only (entity name + owner + activation phase): Driver, Shift, CapacityRule, DriverAssignment, Manifest, DeliveryEvent, StopStatus, Cart/Checkout.

For each module:
- Entity list with: field name, logical type (text / number / money / date / datetime / enum / ref / flag / json-config), required?, visibility class (PII/HEALTH/PAYMENT/none), bilingual?, default, enum source.
- Relationships with cardinality, and an ASCII ERD per module cluster.
- Lifecycle markers: append-only / frozen-snapshot / derived / config.
- Legacy-origin fields where the entity can be imported (origin, import_batch).
- Open questions per entity (tie to workshop session / DEC).

==================================================
PHASE 3C — DATA DICTIONARY + CONVENTIONS
==================================================
One consolidated dictionary covering all 3B entities, plus:
- Naming conventions (entities, fields, enums, events).
- Identifier strategy (internal ids vs business numbers — order number exists in legacy [V], keep both).
- Enumeration registry: every enum with values, source document, and whether workshop-confirmable.
- Bilingual field standard (name_en/name_ar pattern or equivalent).
- Money/quantity/date-timezone standards (UTC storage, local render).

==================================================
PHASE 3D — EVENT CATALOG v1
==================================================
For the event families order.*, fulfillment.*, payment.*, kitchen.*, customer.*, settings.*, bridge.* (align names with audit_architecture.md):
- Payload field list per event (versioned envelope: event id, type, version, occurred_at, actor, entity refs).
- Producer module; consumer modules (M11 notifications, M15 reports, M14 audit linkage, future AI layer).
- Ordering, idempotency, and replay rules (reports/projections must be rebuildable — GAP-AI-01 dependency).
- Explicit note: transport is in-process-acceptable for MVP; contract is what matters.

==================================================
PHASE 3E — API CONTRACT BLUEPRINT (per MVP module)
==================================================
Stack-agnostic resource contracts (REST-style semantics, no framework detail):
- Resources + operations per module; for every operation: purpose, allowed roles (map to rbac_architecture.md matrix exactly), request fields, response fields, validation rules, error cases, emitted events, audit events.
- Hard rules: no state change on GET; status transitions only via explicit transition operations that enforce order_lifecycle_status_model.md (role + validation + history + audit atomically); masked rendering per visibility class is response-shaping, not storage.
- Standard envelope: pagination, filtering, error model, idempotency keys for create operations.
- Mark every operation MVP / dormant.

==================================================
PHASE 3F — MIGRATION & IMPORT MAPPING (DEC-012 scope)
==================================================
Scope per ADR-010: customers + catalog + active plans only.
- Old→new field mapping tables. Legacy fields known only from screen inventories [V at screen level] — map what the screens evidence; mark everything else TBD-pending-access (do not invent legacy schema).
- Dedup rules for customer import (phone-normalization, merge-review queue) per GAP-DQ-01.
- Validation report definitions, dry-run and idempotency requirements (ImportBatch, M19).
- Active-plan import: how legacy states map to the new plan machine (legacy pending/active/pause/expired/cancel mapping table from the status model §transition rules).

==================================================
PHASE 3G — VALIDATION & BUSINESS RULES BINDING
==================================================
- Field- and transition-level validation per WF-01…08, WF-12…16 (workflow_architecture.md is the source).
- Settings-driven rules (kitchen cutoff, payment gate, draft retention, slot capacity) → defined as M16 settings with type + default + who-may-edit; cross-reference 08_Business_Rules/.
- Allergy safety chain: profile → intake warning → review hard-warning → ticket marker (BR-039) — specify the exact fields/flags that carry it end to end.

==================================================
PHASE 3H — OUTPUT FILES TO CREATE
==================================================
10_Data_Model/
  phase_3_data_model_blueprint.md      (3A review + index)
  logical_data_model.md                (3B — entities + ERDs)
  data_dictionary.md                   (3C)
  migration_mapping.md                 (3F)
11_API_Design/
  api_standards.md                     (3E envelope/rules)
  event_catalog.md                     (3D)
  module_api_contracts.md              (3E per-module)
08_Business_Rules/
  validation_rules_binding.md          (3G)
00_Phase_3_Data_API_Executive_Summary.md
19_Roadmap/phase_3_to_phase_4_handoff.md

Update folder READMEs touched. Do not delete or rewrite Phase 1/2 documents; if you find an error in them, log it in the Phase 3A review and (only if factual) propose a correction as a note.

==================================================
PHASE 3I — FINAL RESPONSE
==================================================
1. Files created
2. Key modeling decisions (with ADR/DEC refs)
3. Contradictions/ambiguities found in Phase 1/2 inputs
4. Open questions still blocking Phase 4
5. What Phase 4 (physical schema + implementation spec) should do next

==================================================
QUALITY RULES
==================================================
Be specific; trace every important element to BR / GAP / ENH / DEC / ADR / M / WF / INT / R IDs.
Use Verified / Inferred / Assumed / Needs Confirmation labels.
Respect the MVP cut strictly — stubs only beyond it.
Nothing may break if the WhatsApp API or payment gateway never arrives (ADR-007, INT-03).
Order System only — no ERP/HR/accounting expansion.
Remember the standing blockers: verification workshop not yet held; DEC-001/003/011 unsigned; design accordingly (Proposed labels, config-over-code).
