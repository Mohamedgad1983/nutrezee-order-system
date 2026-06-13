# Agent Operating System — Nutrezee Order System

**Date:** 2026-06-13 · **Status:** Active control layer · Entry point: `AGENTS.md` · Autonomous rulebook: `19_Roadmap/AUTO_EXECUTION_RULES.md` · Modes: `19_Roadmap/SPRINT_MODE.md` · Next-work cursor: `19_Roadmap/NEXT_ACTION_QUEUE.md`
How AI agents (Claude Code / Codex) run long, focused, test-driven sessions in this repository **and continue large-scale work from project state automatically — without a new prompt each time.**

## 0. The one-line contract

Say **"Continue Nutrezee OS Agent"** → the agent inspects the repo, detects the frontier, executes the next eligible unit, commits/pushes, updates the registers, and reports — looping until a real blocker. No detailed prompt required. The mechanics live in `AUTO_EXECUTION_RULES.md`; this file is the *why* and the operating model behind it.

## 1. Roles (one agent may wear several hats, but always knows which is active)

| Role | Responsibility | Key documents | May write |
|---|---|---|---|
| **Planner** | Session start, gate checks, frontier detection, WP selection, blocker analysis, register/queue upkeep | `AUTO_EXECUTION_RULES.md` §A–B, master prompt STEP 0, codex sequence, registers, `NEXT_ACTION_QUEUE.md` | Registers, run log, amendments, queue — docs only |
| **Builder** | Scope-only implementation of the active unit per module specs + foundation patterns | WP/queue row, backend_foundation, module specs, physical schema | `app/`, `db/migrations/`, `docker/`, `.github/`, admin SPA on the unit branch |
| **QA Reviewer** | DoD suites green; generated suites actually generated; adversarial diff pass on masking/transitions/auth/integration; visible Playwright for UI | test_strategy, validation_rules_binding, `tools/e2e-staging` | Tests; defect notes |
| **Release Reviewer** | Merge discipline, register accuracy, push verification, the mandatory SESSION REPORT | git history, register | Merge to main / PR, doc-only commits |
| **Operator** | Staging deploy + verification via the `nutrezee-vps` MCP server (Deployment Mode) | `NOTE_vps_staging_host.md`, `tools/vps-mcp/`, `docker/` | Staging only (never app logic) |

Within one session the lifecycle order **is** the role order: Planner opens, Builder builds, QA verifies, Release closes (Operator deploys when the unit is a deploy). No role skips another's checkpoint.

## 2. Lifecycle (every unit, every session)

```
START → SESSION-START → DETECT FRONTIER → PLAN → IMPLEMENT → TEST → REVIEW → COMMIT/PUSH → REGISTER+QUEUE → CONTINUE?
  │          │                │             │         │          │       │          │              │              │
  │          │                │             │         │          │       │          │              │              └─ Sprint Mode: next eligible unit (decision tree) — do not ask.
  │          │                │             │         │          │       │          │              │                 Build Mode: stop, report.
  │          │                │             │         │          │       │          │              └─ build_progress_register row + run log; rewrite NEXT_ACTION_QUEUE
  │          │                │             │         │          │       │          └─ branch commit → merge only if green (or PR if main push gated) → push
  │          │                │             │         │          │       └─ adversarial diff review; UI also gets visible Playwright on staging
  │          │                │             │         │          └─ unit DoD suites + CI 14 jobs; red = not done → Fix Mode
  │          │                │             │         └─ scope-only, binding constraints, NO re-architecture
  │          │                │             └─ restate scope/DoD/out-of-scope in your own words BEFORE coding
  │          │                └─ first unblocked Engineering Queue item, cross-checked vs register WP status
  │          └─ git status → pull → read register + blockers + assumptions + queue (AUTO_EXECUTION_RULES §A)
  └─ AGENTS.md → AUTO_EXECUTION_RULES → NEXT_ACTION_QUEUE → WP/module spec → schema waves → test gates
```

## 3. Choosing the next work (the autonomous core)

The agent does not need to be told what to build next — it derives it. Summarized from `AUTO_EXECUTION_RULES.md` §B:

- **Current unit blocked by a sponsor-owned item only?** → move to the next independent engineering item; the engineering and sponsor tracks run in parallel.
- **API missing and it blocks the UI?** → build the API first. (Today: WP-API-01 before WP-UI-02.)
- **API exists and only UI is missing?** → build the UI. (Backend-complete + UI-missing is always eligible.)
- **Staging/infra blocked?** → don't idle — produce docs/checklists/mappings or the next buildable unit.
- **Business answer missing?** → apply the conservative assumption, log an ASM-id, build to it, flag `[NC]`. Don't stop.
- **Nothing executable at all?** → the only legitimate "ask the user" case; stop with the exact unblock.

The objective that breaks every tie: **shorten the path to replacing the legacy daily order operation** (`Legacy_Core_Gap_To_Cutover.md`), in legacy-core priority order — Orders, Subscribers/intake, Customers, Packages, Products, Reports, Settings.

## 4. Avoiding context loss (long sessions, multiple sessions, two agents)

- **The registers + queue are the agent's durable memory.** What matters (WP status, run log, amendments, gate snapshot, next-work cursor) lives in `build_progress_register.md` and `NEXT_ACTION_QUEUE.md` — never only in conversation. A dead mid-unit session is reconstructed from the branch + register row + queue.
- **Re-read before reuse:** any fact older than the current session (gate states, decision statuses, file existence, WP status) is re-verified from disk/git, not recalled. Snapshots self-describe as possibly stale.
- **IDs are the anchor:** every piece of work traces to WP / M / BR / GAP / ADR / DEC / ASM / A ids — when in doubt, grep the id, don't reconstruct from memory.
- **Scope restating:** Builder writes the unit's scope + out-of-scope before coding; drift is checked against that restatement at commit time.
- **Small atomic units:** one unit per branch per merge keeps any loss bounded to one unit.
- **The SESSION REPORT is the handoff:** every session ends with `AUTO_EXECUTION_RULES.md` §F so the next session (Claude *or* Codex) resumes with zero extra context.

## 5. Phase 1–4 as source of truth (no re-discovery, no re-architecture)

Phases 1–4 (discovery → architecture → data/API → physical design) are **frozen inputs**. Agents never edit them to match code; code matches them. Discovery is **never restarted** — the legacy system is already fully discovered (`nutrezee-step-1-discovery/`, `01_Discovery/`, `03_Gap_Analysis/`, `Legacy_Core_Coverage_Matrix.md`). The only writes allowed: dated status notes, decision-register updates, and amendments logged as A-ids in the register. A contradiction discovered during build = amendment + (if structural) STOP for sponsor/architect review. `module_api_contracts.md` outranks `packages/shared` types; the status model outranks any hard-coded enum; the master prompt outranks convenience.

## 6. Stop only for real blockers

Agents are expected to run long and not ask permission between eligible units (Sprint Mode). The ONLY stop conditions (`AUTO_EXECUTION_RULES.md` §E): failed gate · NC/blocker affecting the active/next unit's DoD with no defensible assumption · test failure not safely fixable in scope · missing secret/credential · product decision required with no conservative default · forbidden scope · no eligible units. Everything else — long output, many files, tedium, many eligible WPs — is not a blocker. A stop is itself work: register updated, blocker named exactly, committed, pushed, reported with the single next unblock action.

## 7. The six modes (catalog in `SPRINT_MODE.md`)

Review · Build · Sprint · Fix · Deployment · UAT. Default for `Continue Nutrezee OS Agent` is **Sprint Mode** unless the queue's top item names another (e.g. a deploy item → Deployment Mode). Each mode declares its entry condition, allowed writes, and exit — see `SPRINT_MODE.md`.
