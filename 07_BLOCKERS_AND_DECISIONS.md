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

## What blocks WP-01+ (after the 2026-06-10 sponsor unblock pack)

WP-01 entry = global gate ①–⑤ of `phase_5_master_prompt.md`. Now: ① ✅ ② ✅ ③ ✅ ⑤ ✅ (WP-01–06 via NC-carry). **Sole remaining blocker:**
1. **④ staging half — staging is not provisioned/live.** The region note unblocked the checklist (`16_Deployment/environment_plan.md` §3), but executing it needs a cloud account + credentials — a human/infra action an agent cannot invent (missing-credential = sprint stop condition).

WP-07+ additionally remain workshop-blocked (hard NCs: intake field set, DEC-005 finals, DEC-006 sections) — untouched by the NC-carry note. WP-00: ✅ DONE.

## Exact unblock actions (one of)

1. **Provision staging** per `16_Deployment/environment_plan.md` §3 (AWS me-south-1 interim): managed PG 16 + container host + secrets, deploy the WP-00 shell, record the URL — or hand the agent credentials to do it.
2. **Or** a sponsor decision re-scoping gate ④'s staging-live requirement to pre-pilot (WP-14 entry), letting WP-01–06 build on local+CI verification. One short note in `20_Decisions/`; the gate text itself would then be amended with a dated status note.

Then: `Execute Phase 5 Sprint Build Mode per 19_Roadmap/phase_5_master_prompt.md` runs WP-01→02→03→04/05→06 in one session, stopping honestly at WP-07's workshop dependency.
