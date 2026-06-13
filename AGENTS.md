# AGENTS.md — Nutrezee Order System

Main instruction file for AI agents (Claude Code / Codex) working in this repository. **Read this first, every session.** Companion docs: `00_AGENT_OPERATING_SYSTEM.md` (how agents operate), `19_Roadmap/AUTO_EXECUTION_RULES.md` (the autonomous rulebook), `19_Roadmap/SPRINT_MODE.md` (the six modes + sprint loop), `19_Roadmap/NEXT_ACTION_QUEUE.md` (the live next-work cursor), `03_EXECUTION_MODES.md` (original modes), `05_TEST_COMMANDS.md` (commands), `07_BLOCKERS_AND_DECISIONS.md` (live blockers).

## ⭐ Standing command — "Continue Nutrezee OS Agent"

When the user says **"Continue Nutrezee OS Agent"** (or starts any Build/Sprint session), do **not** wait for a detailed prompt. Run the OS:

1. **Session start** (`AUTO_EXECUTION_RULES.md` §A): `git status` → `git pull --ff-only` → read `build_progress_register.md`, `07_BLOCKERS_AND_DECISIONS.md`, `ASSUMPTION_REGISTER.md`, `19_Roadmap/NEXT_ACTION_QUEUE.md` — live, from disk.
2. **Detect the frontier automatically** — the first unblocked item in the Engineering Queue, cross-checked against the register's WP status.
3. **Choose + execute** the next unit per the `AUTO_EXECUTION_RULES.md` §B decision tree, in the right mode (`SPRINT_MODE.md`). Default = Sprint Mode.
4. **Commit, push, update the registers** after each completed unit; loop to the next eligible unit without asking.
5. **Close** with the mandatory SESSION REPORT (`AUTO_EXECUTION_RULES.md` §F).

The agent never re-asks a question whose answer is already in the repo, never restarts discovery, and stops only for a genuine blocker (`AUTO_EXECUTION_RULES.md` §E).

## Project goal

Build the Nutrezee Order System — a healthy-food meal-plan order platform — **incrementally beside the live legacy dashboard** (strangler-fig, ADR-001/002), via gated work packages. **The objective is to replace the legacy daily order operation** (Orders, Subscribers/intake, Customers, Packages, Products, Reports, Settings) — not to satisfy MVP theory. Shortest-path plan: `19_Roadmap/Legacy_Core_Gap_To_Cutover.md`; coverage state: `19_Roadmap/Legacy_Core_Coverage_Matrix.md`. Stack per signed DEC-011: NestJS/TS modular monolith · managed PostgreSQL 16 · React/Vite admin SPA + kitchen PWA · SQL-first migrations · GitHub Actions CI.

## Current state (verify live each session; this is a dated snapshot — 2026-06-13)

- **Phases 1–5 complete. WP-00 … WP-13 DONE & merged** (all CI-green).
- **WP-UI-01 DONE & merged** (PR #3, `b06d646`): login + app shell + sidebar nav + kitchen board + read-only drafts/review-queue/orders lists.
- **Staging LIVE** at `https://13-140-159-201.sslip.io` (VPS + Caddy TLS); gate ④ both halves ✅; 10/10 smoke; **D1–D7 fixed**. Operated via the `nutrezee-vps` MCP server (`tools/vps-mcp/`).
- **Frontier:** WP-API-01 → WP-UI-02 → WP-UI-03 → WP-UI-04 (`NEXT_ACTION_QUEUE.md`). No legacy core module is browser-operable end-to-end yet.
- Sponsor-owned parallel track gates WP-14: legacy export access + workshop pack.

## Source-of-truth documents (never edit; amend via register)

| Topic | File |
|---|---|
| Autonomous rulebook (how to continue without a prompt) | `19_Roadmap/AUTO_EXECUTION_RULES.md` |
| Execution modes + sprint loop | `19_Roadmap/SPRINT_MODE.md` |
| Live next-work cursor | `19_Roadmap/NEXT_ACTION_QUEUE.md` |
| Cutover gap + prioritized build list | `19_Roadmap/Legacy_Core_Gap_To_Cutover.md` |
| Legacy coverage matrix | `19_Roadmap/Legacy_Core_Coverage_Matrix.md` |
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
| Assumptions in force | `ASSUMPTION_REGISTER.md` |
| Staging operations (VPS/MCP) | `20_Decisions/NOTE_vps_staging_host.md`, `tools/vps-mcp/README.md` |

## Execution rules

1. **Gate check first, live** — STEP 0 of the master prompt; never trust cached/snapshot statuses; read the registers from disk.
2. **One unit at a time, atomic** — scope-only implementation per the WP/queue row; modes (`SPRINT_MODE.md`) decide whether you continue to the next unit (Sprint Mode) or stop (Build Mode).
3. **Evidence labels everywhere:** Verified / Inferred / Assumed / Needs Confirmation. Never silently convert an [NC] into a rule — workshop-owned values are config (settings/reason codes/transition_config), not code.
4. **Amendments, not edits:** contradictions or gaps in Phase 1–4 docs are logged as A-ids in `build_progress_register.md` §Amendments (next free id lives there).
5. **Assumptions are expected, not deviations** — when a business answer is missing, apply the conservative interpretation, log a new ASM-id, build to it, flag `[NC]` (`AUTO_EXECUTION_RULES.md` §D). Stop only if no defensible assumption exists.
6. **Binding technical constraints** (full list = master prompt): no GET mutations · same-transaction audit · single write path per owning module · masking at serialization · transitions only via the config-seeded engine · bilingual EN/AR · money in minor units · server-side sessions, no JWTs · no new npm deps without a recorded reason.

## Forbidden actions

- Bypassing or weakening a gate; assuming an OPEN decision is signed; inventing sponsor/stakeholder decisions.
- **Restarting discovery or re-architecting** without a genuine code-vs-frozen-doc contradiction (which is logged as an amendment; structural ones STOP for review).
- Building dormant modules (dispatch M09, drivers M10, cart/checkout M06, refunds, WhatsApp webhook, customer notifications) beyond `not_enabled` stubs, or any **deferred** legacy module (`NEXT_ACTION_QUEUE.md` Deferred list) — no tables, no UI — without a new amendment.
- Editing Phase 1–4 source-of-truth docs (status notes/amendments/register updates are the only exceptions).
- Skipping tests, marking suites pending to get green, or proceeding past a red suite.
- Committing secrets; touching production; writing to the legacy system (bridge is read-only).
- Scope creep past the invoked unit's row — "while I'm here" is forbidden.

## Git discipline

- Feature work: branch `build/<wp-id>-<slug>` → merge to `main` only when the unit's DoD suites are green → push same session (R1 residual duty). If a direct `main` push is gated by the runtime, open a PR instead — do not abandon the push.
- Doc-only changes (register, run log, amendments, status notes, OS files): commit directly to `main`.
- Commit messages reference the WP/queue id; never rewrite pushed history; never force-push.
- Before starting: working tree clean, `main` in sync with `origin/main`. If files are unexpectedly missing/modified (it has happened to master-prompt files), restore from git history and report — never silently absorb.

## Test discipline

- Suites TS-U/I/M/R/A/C/E/S per `15_Testing/test_strategy.md`; commands in `05_TEST_COMMANDS.md`; CI = 14 jobs.
- A unit is DONE only when its DoD suites pass in CI. Placeholder tests mean "not yet implemented", never "verified".
- Generated suites stay generated (TS-R from the M13 matrix; TS-U transitions from `transition_config`) — hand-enumerating them is a defect.
- Audit acceptance tests (TS-A) are cumulative: once green, they remain CI gates forever.
- UI units additionally ship a visible Playwright e2e (`tools/e2e-staging`) proving the flow on staging.

## Blocker rules

Stop ONLY for a real blocker (`AUTO_EXECUTION_RULES.md` §E): failed gate · NC/blocker affecting the active unit's DoD with no defensible assumption · test failure not safely fixable within scope · missing secret/credential · product/sponsor decision required with no conservative default · forbidden scope reached · no eligible units remain. When blocked: record it (register row BLOCKED + run log + exact blocker), commit, push, report — never improvise around it, never ask permission to continue between *eligible* units in Sprint Mode.

## Final response format (every session)

Emit the mandatory **SESSION REPORT** from `AUTO_EXECUTION_RULES.md` §F: Mode + gate result · Done (merge commits + CI) · Tests · Commits pushed · Assumptions logged · Current blocker · Next task · the exact command to continue (`Continue Nutrezee OS Agent`).
