# Architecture (13_Architecture)

**Purpose:** System architecture
**Owner:** Solution Architect
**Depends on:** 03, 04, DEC-001/011

## Contents (Phase 2 Architecture Blueprint, 2026-06-11)

| File | Content |
|---|---|
| `phase_2_architecture_blueprint.md` | Input review + blueprint index (start here) |
| `target_architecture.md` | 10-layer target architecture + technology guardrails |
| `module_blueprint.md` | 19 modules (M01–M19) + dependency map |
| `workflow_architecture.md` | 16 future-state workflows (WF-01–16) |
| `order_lifecycle_status_model.md` | Two-level status model + transition tables (the spine) |
| `rbac_architecture.md` | 12 roles, permissions matrix, visibility classes |
| `audit_architecture.md` | Audit event catalog, schema, retention |
| `legacy_transition_architecture.md` | Strangler-fig coexistence, bridge patterns, rollback |
| `data_ownership_blueprint.md` | 19 entities: ownership, quality risks, audit |
| `integration_boundaries.md` | INT-01…06 boundaries |
| `mvp_architecture_cut.md` | Strict MVP scope (= DEC-003 recommendation) |
| `domain_map.md` | Phase 5 (discovery consolidation) domain map |

## Phase 4 addition (2026-06-11)
| `backend_foundation_blueprint.md` | Binding build patterns: layering, same-transaction audit, transactional outbox, config-seeded transition engine, staged RBAC enforcement |

Still to come: container/deployment diagrams + ADR addenda after DEC-011 signature.

See `00_Documentation_Structure.md` for full conventions (IDs, status headers, source-of-truth rules).
