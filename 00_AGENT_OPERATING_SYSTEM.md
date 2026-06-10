# Agent Operating System — Nutrezee Order System

**Date:** 2026-06-10 · **Status:** Active control layer · Entry point: `AGENTS.md` · Modes: `03_EXECUTION_MODES.md`
How AI agents (Claude / Codex) run long, focused, test-driven build sessions in this repository without losing scope.

## 1. Roles (one agent may wear several hats, but always knows which is active)

| Role | Responsibility | Key documents | May write |
|---|---|---|---|
| **Planner** | Gate checks, WP selection per dependency diagram, blocker analysis, register/run-log upkeep | master prompt STEP 0, codex sequence, registers | Registers, run log, amendments — docs only |
| **Builder** | Scope-only implementation of the active WP per module specs + foundation patterns | WP row, backend_foundation, module specs, physical schema | `app/`, `db/migrations/`, `docker/`, `.github/` on the WP branch |
| **QA Reviewer** | DoD suites green; generated suites actually generated; adversarial pass on masking/transitions/audit | test_strategy, validation_rules_binding | Tests; defect notes |
| **Release Reviewer** | Merge discipline, register accuracy, push verification, honest session report | git history, register | Merge to main, doc-only commits |

Within one session the lifecycle order **is** the role order: Planner opens, Builder builds, QA verifies, Release closes. No role skips another's checkpoint.

## 2. Lifecycle (every WP, every session)

```
READ → GATE CHECK → PLAN → IMPLEMENT → TEST → COMMIT → REGISTER → CONTINUE?
 │         │           │        │          │       │         │          │
 │         │           │        │          │       │         │          └─ Sprint Build Mode: next eligible WP
 │         │           │        │          │       │         │             (per dependency diagram) — do not ask.
 │         │           │        │          │       │         │             Single WP Mode: stop, report.
 │         │           │        │          │       │         └─ build_progress_register.md row + run log
 │         │           │        │          │       └─ branch commit → merge only if green → push origin/main
 │         │           │        │          └─ WP's DoD suites (05_TEST_COMMANDS.md); red = not done
 │         │           │        └─ scope-only, per module spec + binding constraints
 │         │           └─ restate WP scope/DoD/out-of-scope in your own words BEFORE coding
 │         └─ master prompt STEP 0, live from disk; stop honestly on failure
 └─ AGENTS.md → master prompt → WP row → module spec → schema waves → test gates
```

## 3. Avoiding context loss (long sessions, multiple sessions)

- **The registers are the agent's durable memory.** Session state that matters (WP status, run log, amendments, gate snapshot) lives in `build_progress_register.md` — never only in conversation. If a session dies mid-WP, the branch + register row reconstruct it.
- **Re-read before reuse:** any fact older than the current session (gate states, decision statuses, file existence) is re-verified from disk/git, not recalled. Snapshots in prompts self-describe as possibly stale.
- **IDs are the anchor:** every piece of work traces to WP / M / BR / GAP / ADR / DEC / A ids — when in doubt, grep the id, don't reconstruct from memory.
- **Scope restating:** Builder writes the WP's scope + out-of-scope in the session before coding; drift is checked against that restatement at commit time.
- **Small atomic units:** one WP per branch per merge keeps any loss bounded to one WP.

## 4. Phase 1–4 as source of truth

Phases 1–4 (discovery → architecture → data/API → physical design) are **frozen inputs**. Agents never edit them to match code; code matches them. The only writes allowed: dated status notes, decision-register updates, and amendments logged as A-ids in the register (canonical counter there). A contradiction discovered during build = amendment + (if structural) STOP for sponsor/architect review. `module_api_contracts.md` outranks `packages/shared` types; the status model outranks any hard-coded enum; the master prompt outranks convenience.

## 5. Stop only for real blockers

Agents are expected to run long and not ask permission between eligible WPs (Sprint Build Mode). The ONLY stop conditions: failed gate · NC blocker affecting the active/next WP's DoD · test failure not safely fixable in scope · missing secret/credential · product decision required · forbidden scope · no eligible WPs. Everything else — long output, many files, tedium — is not a blocker. A stop is itself work: register updated, blocker named exactly, committed, pushed, reported with the single next unblock action.
