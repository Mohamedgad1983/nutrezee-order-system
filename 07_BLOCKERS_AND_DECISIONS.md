# Live Blockers & Decisions — Build Execution

**Date:** 2026-06-10 (verify live each session — `build_progress_register.md` gate snapshot + `20_Decisions/decision_register.md` are the operative sources; this file is the orientation summary) · **Status:** Living

## Decision status

| Item | Status | Evidence |
|---|---|---|
| **DEC-011** stack & hosting | ✅ **SIGNED 2026-06-10** — NestJS/TS + managed PostgreSQL 16 + React/Vite, SQL-first migrations, server-side sessions, GitHub Actions | `20_Decisions/DEC-011_stack_hosting.md` |
| **DEC-003** MVP cut | ❌ **OPEN** — sponsor signature pending on `13_Architecture/mvp_architecture_cut.md` (ADR-009 is the recommendation) | decision_register.md |
| DEC-005 status-model finals · DEC-006 kitchen sections · DEC-002/004/007/008/009/010/012 | ❌ OPEN — workshop-fed; structure built config-tolerant, content [NC] | decision_register.md |
| R1 remote backup | ✅ CLOSED 2026-06-10 (GitHub private remote, both branches) | `21_Risks/risk_register.md` |

## Infrastructure status

| Item | Status |
|---|---|
| CI | ◐ Workflow live since WP-00 (`.github/workflows/ci.yml`); **first GitHub run unverified** from the authoring machine (no `gh`) — check the Actions tab |
| Staging | ❌ **Deferred** — blocked by the PG-region/data-residency item below; provisioning checklist ready (`16_Deployment/environment_plan.md` §3) |
| Local environment | ✅ Verified (typecheck/lint/tests/build/smoke); Docker compose authored but **unvalidated locally** (Docker not installed) |
| Workshop / NC-carry | ❌ **Neither** — no minutes in `22_Meeting_Notes/` beyond the agenda; no sponsor NC-carry acceptance note in `20_Decisions/` |
| PG region / data residency | ❌ **[NC]** — KSA/Gulf PII+health data may require an in-region host; one-line sponsor note (interim or final region) in `20_Decisions/` unblocks staging |

## What blocks WP-01+ (build halted here)

WP-01 entry = global gate ①–⑤ of `phase_5_master_prompt.md`. Today: ① ✅ ③ ✅, blocked by:
1. **② DEC-003 unsigned** — required for all business WPs regardless of NC-carry.
2. **⑤ workshop not held AND no NC-carry note** — either unblocks WP-01–06; WP-07+ require the workshop itself (hard NCs: intake field set, DEC-005 finals, DEC-006 sections).
3. **④ staging half** — needs the PG-region note, then the §3 checklist (CI half already satisfied).

WP-02–14 are transitively blocked (dependency diagram roots in WP-01). WP-00: ✅ DONE 2026-06-10.

## Exact unblock actions (sponsor, ~30 minutes total)

1. Sign **DEC-003** (say the word and the register row + decision file are applied like DEC-011 was).
2. Record either workshop minutes or a one-paragraph **NC-carry acceptance for WP-01–06** in `20_Decisions/`.
3. One line: **"interim PG region: <X>"** in `20_Decisions/` → staging provisioning proceeds.

Then: `Execute Phase 5 Sprint Build Mode per 19_Roadmap/phase_5_master_prompt.md` runs WP-01→02→03→04/05→06 in one session, stopping honestly at WP-07's workshop dependency.
