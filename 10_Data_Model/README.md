# Data_Model (10_Data_Model)

**Purpose:** Logical and physical data design
**Store here:** Per-domain ERDs, data dictionary, old-to-new migration mapping (DEC-012), retention rules

## Contents (Phase 3, 2026-06-11)
- `phase_3_data_model_blueprint.md` — input review, contradictions C1–C7, modeling decisions DM-01–08 (start here)
- `logical_data_model.md` — 38 MVP entities + 9 dormant stubs, ERDs per module
- `data_dictionary.md` — entity index, conventions, identifier strategy, 25-enum registry
- `migration_mapping.md` — catalog/customer/active-plan imports, dedup, rollback (amendments A1/A2)

## Contents (Phase 4, 2026-06-11)
- `physical_schema_design.md` — PostgreSQL-ready (Proposed, DEC-011 open): ~50 tables in 5 creation waves, justified indexes, append-only/frozen enforcement, amendments A1–A4
- `migration_execution_plan.md` — batch runner design, 3 batch step-lists, data-quality gates, rollback, cutover-weekend runbook skeleton
**Owner:** Data Architect
**Depends on:** 13_Architecture, old-schema access

See `00_Documentation_Structure.md` for full conventions (IDs, status headers, source-of-truth rules).
