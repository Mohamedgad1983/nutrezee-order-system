# Nutrezee Order System — Phase 4 Master Prompt
# Physical Database Design + Technical Implementation Specification
# + Backend Foundation Blueprint + Testing Strategy + Migration Execution Plan

You are working inside the existing Nutrezee Order System project folder, acting as Senior Backend/Data Architect + QA Lead.

IMPORTANT:
Do NOT restart discovery.
Do NOT redesign the Phase 2 architecture.
Do NOT recreate the Phase 3 logical data model — convert it.
Do NOT write application/implementation code. SQL DDL drafts ARE allowed as design artifacts inside documents; executed migrations, framework scaffolding, services, and app code are NOT (those start only after Phase 4 is completed and signed).
Do NOT design UI screens.
Do NOT finalize anything marked Needs Confirmation — carry the label forward; never resolve a workshop item silently.
Do NOT touch modules outside the MVP cut except as dormant stubs (mvp_architecture_cut.md §2).

==================================================
INPUT DOCUMENTS (the only allowed basis)
==================================================

Phase 1 — consolidation (2026-06-10):
- 00_Executive_Summary.md · 01_Discovery/discovery_consolidation.md · 02_Current_State/current_state_assessment.md · 03_Gap_Analysis/gap_analysis.md · 04_Enhancement_Blueprint/enhancement_blueprint.md
- BR-001…044 (evidence record: nutrezee-step-1-discovery/docs/02_requirements/business_requirements_backlog.md)

Phase 2 — architecture (2026-06-11):
- 13_Architecture/phase_2_architecture_blueprint.md (index) and all 10 companion blueprint files
- 20_Decisions/decision_register.md + architecture_decision_records.md (ADR-001…010)
- 21_Risks/risk_register.md · 19_Roadmap/phase_2_to_phase_3_handoff.md

Phase 3 — data/API blueprint (2026-06-11):
- 10_Data_Model/phase_3_data_model_blueprint.md (contradictions C1–C7, decisions DM-01…08)
- 10_Data_Model/logical_data_model.md (38 MVP entities + 9 dormant stubs)
- 10_Data_Model/data_dictionary.md (conventions, identifier strategy, 25-enum registry)
- 10_Data_Model/migration_mapping.md (3 import batches; amendments A1 Customer.email, A2 off_days)
- 11_API_Design/api_standards.md · event_catalog.md · module_api_contracts.md
- 08_Business_Rules/validation_rules_binding.md (rule slots, allergy chain steps 1–7, M16 settings registry)
- 19_Roadmap/phase_3_to_phase_4_handoff.md (blockers + work plan)

If any file is missing, report it clearly and continue with the rest.

==================================================
STACK RULE (instruction 9)
==================================================

Check 20_Decisions/decision_register.md for DEC-011 status FIRST.
- If DEC-011 is SIGNED: design against the signed stack as final.
- If DEC-011 is still OPEN: **PostgreSQL is the Proposed physical target by sponsor direction in this prompt** — produce PostgreSQL-ready design labeled Proposed, keep it portable (no PG-only exotica without a portable fallback note), and keep application-layer choices (language, framework, ORM, transport) strictly Proposed with a short options note feeding DEC-011.
Either way: record the stack posture you used in your 4A review.

Binding constraints carried forward (do not re-litigate): ADR-010 ownership/single-write-path; append-only families; frozen OrderItem snapshots; derived data regenerable; PII/HEALTH/PAYMENT field visibility; same-transaction audit (ADR-005); no GET mutations; status vocabularies verbatim from order_lifecycle_status_model.md [Proposed until DEC-005]; events v1 envelope; origin=legacy tagging; bilingual ntext pairs; money as integer minor units (DM-07).

==================================================
PHASE 4A — INPUT & STATUS REVIEW
==================================================
1. Verify whether the verification workshop has produced minutes in 22_Meeting_Notes/ and whether DEC-003/005/011 changed status. List exactly which Phase 3 [Proposed]/[NC] items are now Baselined vs still open — your physical design must mark every still-open item Needs Confirmation in place.
2. Apply amendment A1 (add Customer.email, PII) and honor A2 (off_days_unverified flag) — these are the ONLY logical-model changes permitted, and they must be logged, not silent.
3. List contradictions C1–C7 dispositions you inherit; report any NEW contradictions you find between Phase 3 files.

==================================================
PHASE 4B — PHYSICAL DATABASE DESIGN (PostgreSQL-ready)
==================================================
Output: 10_Data_Model/physical_schema_design.md
For every MVP entity in logical_data_model.md:
- Table name (snake_case per dictionary §2), columns with PostgreSQL types mapped from logical types (ntext pair → two columns; money → bigint minor units + currency char(3); enum strategy below), nullability from Req column, defaults.
- Constraints: PK (id strategy per DM-01 — specify concrete type, e.g. ULID-in-text vs UUIDv7, as Proposed if DEC-011 open), FKs with on-delete behavior (RESTRICT default; justify any exception), UNIQUE (order_number, phone_normalized candidate-unique per DEC-004 [NC]), CHECK (money ≥ 0, date ranges, state-enum membership).
- Enum strategy: lookup/check-constraint tables for workshop-changeable vocabularies (ReasonCode-backed, PAY_METHOD, ALLERGY_SEVERITY); fixed system enums (SEVERITY, QUEUE_STATE) may be CHECK constraints. Never PG native enums for workshop-changeable lists — justify per enum against data_dictionary §4 "workshop-confirmable" flags.
- Append-only enforcement: REVOKE UPDATE/DELETE + trigger guard pattern for OrderStatusHistory, ReviewDecision, NotificationLog, AuditEvent, TicketStatusEvent, ImportRowResult, MergeRecord, ReconciliationRun.
- Standard audit columns (created_at/by, updated_at/by where std), origin/import_batch on importable tables.
- Indexes: derive from query patterns in module_api_contracts (queue ordering, phone search, date+section board, reconciliation lookups) and validation binding; list each index with the operation that justifies it. No speculative indexes.
- AuditEvent volume handling: partitioning-or-archival recommendation per audit_architecture retention tiers [Proposed].
- Migration (DDL) order: dependency-sorted table creation list aligned to module build order (M13/M14/M16/M12 → M04/M05 → M01/M17/M02 → M03 → M08 → M07/M11/M15 → M18/M19); dormant stub tables NOT created (document the deferral).
- ERD-to-physical traceability table: logical entity → table(s), any denormalization/splits justified.

==================================================
PHASE 4C — BACKEND FOUNDATION BLUEPRINT + TECHNICAL MODULE SPECS
==================================================
Outputs: 13_Architecture/backend_foundation_blueprint.md + 11_API_Design/backend_module_specs.md
Foundation blueprint (applies to every module):
- Service boundary posture: modular monolith acceptable for MVP (mvp cut §6); module boundaries M01–M19 are package boundaries with enforced dependency direction (foundation ← business modules); no cross-module table writes (ADR-010).
- Layering per module: API/controller → service (business rules + transition engine) → repository (single write path per owning module) → store. Where each validation class from validation_rules_binding runs.
- RBAC enforcement points: authn middleware (session), operation-level role check (matrix-driven config), field-level masking at serialization (api_standards rule 4), export-right checks; staged enforcement modes (log/warn/deny) wiring.
- Audit transaction handling: the concrete same-transaction pattern (business write + AuditEvent insert in one DB transaction); async-tolerant queue pattern for sensitive-read logging; restricted-mode behavior on audit-store degradation [Proposed — flag for business tolerance confirmation].
- Event publishing: transactional outbox (or equivalent same-transaction-safe pattern) → in-process dispatch for MVP; replay/rebuild harness contract for M15 projections (event_catalog consumer rules).
- Transition engine: config-seeded state machines loaded from M16 (validation binding §4) — tables for transition config included in 4B.
- Settings/config loading, feature flags, cutover flags; secrets handling standard (GAP-SEC-05).
- Error model, idempotency-key storage, optimistic-version handling per api_standards.
Module specs: for each MVP module M01–M19, a technical spec table: owned tables, exposed operations (from module_api_contracts), services, repositories, emitted events, consumed events, settings read, audit events written, RBAC checks — plus open [NC] items affecting that module.

==================================================
PHASE 4D — MIGRATION EXECUTION PLAN
==================================================
Output: 10_Data_Model/migration_execution_plan.md
Convert migration_mapping.md into an executable design: batch runner behavior (dry-run default, apply gate, idempotency via SyncRecord.legacy_key), per-batch step lists for catalog → customers → active plans, validation report formats, merge-review queue handoff to Ops, rollback procedures and their preconditions, cutover-weekend runbook skeleton (ties to legacy_transition §5/§9 and reconciliation P1 ritual), data-quality gates (e.g., max merge_review % before apply is blocked [Proposed threshold]). Mark every legacy-vocabulary unknown (payment statuses, off_days) Needs Confirmation with its workshop/access dependency.

==================================================
PHASE 4E — TESTING STRATEGY
==================================================
Output: 15_Testing/test_strategy.md
Define, with named suites and entry/exit gates:
- Unit: transition engine (every L1/L2 table row = a case), validation rules (each slot in validation binding §1), dedup/normalization functions.
- Integration: same-transaction audit (forced-failure case from audit_architecture §tests #3), outbox/event emission, repository single-write-path guards, append-only triggers.
- Migration tests: dry-run fixtures per batch, idempotent re-run, rollback, mapping edge cases (unparseable phone, duplicate-in-batch, unmatched package).
- RBAC tests: matrix-driven generated cases (every role × operation in module_api_contracts = allow/deny assertion), masking tests per visibility class, staged-mode behavior.
- Audit tests: the five acceptance tests from audit_architecture.md verbatim (reconstruction, immutability, same-transaction, masked rendering, HIGH-review).
- API contract tests: per-operation request/response/error conformance vs module_api_contracts; idempotency replay; no-GET-mutation scan.
- Event/replay tests: projection rebuild equality for the 3 MVP reports.
- Mandatory scenarios: allergy chain steps 1–7 (validation binding §2) end-to-end.
- Regression duty: map to the 50-screen coverage checklist for the slices MVP replaces (BO-5).
UAT note: UAT scripts depend on workshop-baselined rule values — define templates now, mark content [NC] where gated.

==================================================
PHASE 4F — IMPLEMENTATION SEQUENCING FOR CODEX
==================================================
Output: 19_Roadmap/codex_implementation_sequence.md
Ordered work packages WP-01… for the post-Phase-4 coding sessions (Codex/Claude Code): each WP = scope (modules/tables/operations), input docs (exact file+section refs), definition of done (tests passing per 4E suites + audit/RBAC gates), explicit out-of-scope list, and est. relative size (S/M/L). Sequence must follow: foundation (M13→M14→M16→M12) → M04/M05+M19 imports → M01/M17-manual/M02 → M03 → M08 → M07/M11/M15-lite → M18 reconciliation → pilot gate (one agent, one section). Include a stop-rule: no WP starts while its [NC] dependencies are unresolved if they affect its DoD.

==================================================
PHASE 4G — OUTPUT FILES TO CREATE
==================================================
10_Data_Model/physical_schema_design.md
10_Data_Model/migration_execution_plan.md
13_Architecture/backend_foundation_blueprint.md
11_API_Design/backend_module_specs.md
15_Testing/test_strategy.md
19_Roadmap/codex_implementation_sequence.md
00_Phase_4_Executive_Summary.md
19_Roadmap/phase_4_to_build_handoff.md
Update READMEs of touched folders. Do NOT modify Phase 1–3 deliverables except adding cross-references; log any needed correction as a noted amendment (A3, A4, …) instead of editing history.

==================================================
PHASE 4H — FINAL RESPONSE
==================================================
1. Files created · 2. Stack posture used (DEC-011 state) · 3. Key physical-design decisions + any new amendments (A3+) · 4. Open [NC] items carried forward and which WPs they block · 5. Confirmation that NO application code was written · 6. What the first Codex build session should start with (WP-01) and its entry gate.

==================================================
QUALITY RULES
==================================================
Trace every element to BR / GAP / ENH / DEC / ADR / DM / C / A / M / WF / INT / R IDs.
Use Verified / Inferred / Assumed / Needs Confirmation labels.
Respect the MVP cut strictly; dormant stubs get no tables, no specs beyond a deferral note.
Nothing may break if the WhatsApp API or payment gateway never arrives (ADR-007, INT-03).
Order System only — no ERP/HR/accounting expansion.
Standing blockers to restate in your output: R1 (remote backup), verification workshop, DEC-003/005/011 signatures.
NO CODING starts before Phase 4 documents are reviewed and the entry gates in codex_implementation_sequence.md are met.
