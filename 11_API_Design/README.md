# API_Design (11_API_Design)

**Purpose:** Service and event contracts
**Store here:** API standards, per-domain endpoint specs, event catalog, webhook contracts

## Contents (Phase 3, 2026-06-11)
- `api_standards.md` — envelope, explicit transition operations, errors, masking, idempotency
- `event_catalog.md` — event families v1, envelope, consumer/replay contracts
- `module_api_contracts.md` — per-MVP-module operations with RBAC role lists; dormant stubs named

## Contents (Phase 4, 2026-06-11)
- `backend_module_specs.md` — per-MVP-module technical specs (owned tables, services, events, settings, audit) + the closed list of allowed cross-module calls

OpenAPI generation: build phase, after DEC-011 signature.
**Owner:** Tech Lead
**Depends on:** 10_Data_Model, 13_Architecture

See `00_Documentation_Structure.md` for full conventions (IDs, status headers, source-of-truth rules).
