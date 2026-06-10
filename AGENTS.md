# AGENTS.md — Nutrezee Order System

Main instruction file for AI agents (Claude / Codex) working in this repository. Read this first, every session. Companion docs: `00_AGENT_OPERATING_SYSTEM.md` (how agents operate), `03_EXECUTION_MODES.md` (modes), `05_TEST_COMMANDS.md` (commands), `07_BLOCKERS_AND_DECISIONS.md` (live blockers).

## Project goal

Build the Nutrezee Order System MVP — a healthy-food meal-plan order platform replacing manual WhatsApp intake, verbal kitchen coordination, and manual dispatch — **incrementally beside the live legacy dashboard** (strangler-fig, ADR-001/002), via gated work packages WP-00…WP-14. Stack per signed DEC-011: NestJS/TS modular monolith · managed PostgreSQL 16 · React/Vite admin SPA + kitchen PWA · SQL-first migrations · GitHub Actions CI.

## Source-of-truth documents (never edit; amend via register)

| Topic | File |
|---|---|
| Build session protocol (BINDING) | `19_Roadmap/phase_5_master_prompt.md` |
| WP scopes, DoD, dependency diagram | `19_Roadmap/codex_implementation_sequence.md` |
| Live status, run log, amendment counter | `19_Roadmap/build_progress_register.md` |
| Backend patterns (layering, audit, outbox, transitions, RBAC) | `13_Architecture/backend_foundation_blueprint.md` |
| Module specs + only-allowed cross-module calls | `11_API_Design/backend_module_specs.md` |
| Physical schema, wave order | `10_Data_Model/physical_schema_design.md` |
| API/event contracts | `11_API_Design/` (api_standards, module_api_contracts, event_catalog) |
| Test suites + gates | `15_Testing/test_strategy.md` |
| Validation rules + settings slots | `08_Business_Rules/validation_rules_binding.md` |
| Decisions (signed vs OPEN) | `20_Decisions/decision_register.md` (+ `DEC-011_stack_hosting.md`) |
| Status model (the spine) | `13_Architecture/order_lifecycle_status_model.md` |

## Execution rules

1. **Gate check first, live** — STEP 0 of the master prompt; never trust cached/snapshot statuses; read the registers from disk.
2. **One WP at a time, atomic** — scope-only implementation per the WP row; modes in `03_EXECUTION_MODES.md` decide whether you continue to the next WP (Sprint Build Mode) or stop (Single WP Mode).
3. **Evidence labels everywhere:** Verified / Inferred / Assumed / Needs Confirmation. Never silently convert an [NC] into a rule — workshop-owned values are config (settings/reason codes/transition_config), not code.
4. **Amendments, not edits:** contradictions or gaps in Phase 1–4 docs are logged as A-ids in `build_progress_register.md` §Amendments (next free id lives there).
5. **Binding technical constraints** (full list = master prompt): no GET mutations · same-transaction audit · single write path per owning module · masking at serialization · transitions only via the config-seeded engine · bilingual EN/AR · money in minor units · server-side sessions, no JWTs.

## Forbidden actions

- Bypassing or weakening a gate; assuming an OPEN decision is signed; inventing sponsor/stakeholder decisions.
- Building dormant modules (dispatch M09, drivers M10, cart/checkout M06, refunds, WhatsApp webhook, customer notifications) beyond `not_enabled` stubs — no tables, no UI.
- Editing Phase 1–4 source-of-truth docs (status notes/amendments/register updates are the only exceptions).
- Skipping tests, marking suites pending to get green, or proceeding past a red suite.
- Committing secrets; touching production; writing to the legacy system (bridge is read-only).
- Scope creep past the invoked WP's row — "while I'm here" is forbidden.

## Git discipline

- Feature work: branch `build/wp-XX-<slug>` → merge to `main` only when the WP's DoD suites are green → push `origin/main` same session (R1 residual duty).
- Doc-only changes (register, run log, amendments, status notes): commit directly to `main`.
- Commit messages reference the WP id; never rewrite pushed history; never force-push.
- Before starting: working tree clean, `main` in sync with `origin/main`. If files are unexpectedly missing/modified (it has happened to master-prompt files twice), restore from git history and report — never silently absorb.

## Test discipline

- Suites TS-U/I/M/R/A/C/E/S per `15_Testing/test_strategy.md`; commands in `05_TEST_COMMANDS.md`.
- A WP is DONE only when its DoD suites pass in CI. Placeholder tests mean "not yet implemented", never "verified".
- Generated suites stay generated (TS-R from the M13 matrix; TS-U transitions from `transition_config`) — hand-enumerating them is a defect.
- Audit acceptance tests (TS-A) are cumulative: once green, they remain CI gates forever.

## Blocker rules

Stop ONLY for a real blocker: failed gate · NC blocker affecting the active WP's DoD · test failure not safely fixable within scope · missing secret/credential · product/sponsor decision required · forbidden scope reached · no eligible WPs remain. When blocked: record it (register row BLOCKED + run log + exact blocker), commit, push, report — never improvise around it, never ask permission to continue between *eligible* WPs in Sprint Build Mode.

## Final response format (every session)

1. Mode + gate-check result · 2. WPs completed (merge commits + suite status) · 3. WPs blocked (exact blockers) · 4. Commits pushed · 5. Tests run · 6. Amendments logged · 7. Single next unblock action.
