# Live Blockers & Decisions — Build Execution

**Date:** 2026-06-10 (verify live each session — `build_progress_register.md` gate snapshot + `20_Decisions/decision_register.md` are the operative sources; this file is the orientation summary) · **Status:** Living

## Decision status

| Item | Status | Evidence |
|---|---|---|
| **DEC-011** stack & hosting | ✅ **SIGNED 2026-06-10** — NestJS/TS + managed PostgreSQL 16 + React/Vite, SQL-first migrations, server-side sessions, GitHub Actions | `20_Decisions/DEC-011_stack_hosting.md` |
| **DEC-003** MVP cut | ✅ **SIGNED 2026-06-10** — `DEC-003_mvp_cut.md` signs the cut as the Release-1 contract | decision_register.md |
| DEC-005 status-model finals · DEC-006 kitchen sections · DEC-002/004/007/008/009/010/012 | ❌ OPEN — workshop-fed; structure built config-tolerant, content [NC] | decision_register.md |
| R1 remote backup | ✅ CLOSED 2026-06-10 (GitHub private remote, both branches) | `21_Risks/risk_register.md` |

## Infrastructure status

| Item | Status |
|---|---|
| CI | ◐ Workflow live since WP-00 (`.github/workflows/ci.yml`); **first GitHub run unverified** from the authoring machine (no `gh`) — check the Actions tab |
| Staging | ❌ **Deferred** — blocked by the PG-region/data-residency item below; provisioning checklist ready (`16_Deployment/environment_plan.md` §3) |
| Local environment | ✅ Verified (typecheck/lint/tests/build/smoke); Docker compose authored but **unvalidated locally** (Docker not installed) |
| Workshop / NC-carry | ◐ **NC-carry accepted 2026-06-10** for WP-01–06 (`NOTE_nc_carry_acceptance_wp01_06.md`); workshop itself still outstanding — WP-07+ stay workshop-blocked |
| PG region / data residency | ◐ **Interim staging region noted 2026-06-10**: AWS me-south-1 (`NOTE_pg_staging_region_interim.md`); final production region revisited pre-launch (residency check stays open toward Phase 6) |

## What blocks WP-01+ (after DEC-014 staging re-scope, 2026-06-10)

WP-01 entry = global gate ①–⑤ of `phase_5_master_prompt.md`. Now: ① ✅ ② ✅ ③ ✅ ④ ✅-for-WP-01–06 (DEC-014: local + CI verification; CI mandatory and unweakened) ⑤ ✅ (NC-carry, WP-01–06).

**→ WP-01–06: ALL DONE (built 2026-06-10, Sprint Build Mode — 6 WPs, 74 tests, 6× CI 13/13). The NC-carry envelope is exhausted; WP-07 is the frontier and is workshop-blocked.**

Still standing, clearly scoped:
1. **Staging live + smoke-tested — hard WP-14 / pre-pilot entry gate** (DEC-014). NOT provisioned, never to be marked done until it is. **Cloud credentials remain the blocker for provisioning** (not for WP-01–06 build). Region: AWS me-south-1 interim.
2. **WP-07+ workshop blockers** — intake field set (S3), DEC-005 finals, DEC-006 sections; untouched by NC-carry or DEC-014.
3. ~~Practical session duty: CI verification tooling~~ **Resolved 2026-06-10**: `gh` CLI installed + authed; all CI runs to date verified green (latest 14/14 jobs). Sessions verify per-WP runs with `gh run list` / `gh run view`.

## Exact next action

`Execute Phase 5 Sprint Build Mode per 19_Roadmap/phase_5_master_prompt.md` — runs WP-01→02→03→04/05→06 atomically, stopping honestly at WP-07's workshop dependency. In parallel (human): provision staging per env plan §3 so the WP-14 gate is ready when the build arrives.
