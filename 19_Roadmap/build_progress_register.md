# Build Progress Register

**Status:** Living document — updated by every Phase 5 build session (see `phase_5_master_prompt.md` STEP 5).
Created 2026-06-10. WP definitions: `codex_implementation_sequence.md` (WP-01…14) and `phase_5_master_prompt.md` (WP-00, amendment A5).
**This file's §Amendments table is the sole canonical A-id counter** — stale "next free id" notes in earlier documents are superseded.
*(Date note: Phase 2–4 documents carry 2026-06-11 date stamps written one day ahead in error; git history — all commits 2026-06-10 — is authoritative.)*

## Gate snapshot (re-verify live each session — last verified 2026-06-10)

| Gate | State |
|---|---|
| ① DEC-011 stack signed | ✅ SIGNED 2026-06-10 |
| ② DEC-003 MVP cut signed | ✅ **SIGNED 2026-06-10** (`20_Decisions/DEC-003_mvp_cut.md`) |
| ③ R1 remote backup | ✅ CLOSED 2026-06-10 (GitHub, both branches) |
| ④ Staging + CI live | ◐ CI half ✅ (workflow live since WP-00 — verify first GitHub run); staging half: region note ✅ (`NOTE_pg_staging_region_interim.md`, AWS me-south-1 interim) → provisioning **unblocked but not yet executed** (`16_Deployment/environment_plan.md` §3 — needs cloud account/credentials); staging is **not live** |
| ⑤ Workshop held / NC-carry acceptance | ✅ **NC-carry acceptance recorded 2026-06-10** for WP-01–06 only (`NOTE_nc_carry_acceptance_wp01_06.md`); workshop itself still outstanding — WP-07+ remain workshop-blocked |

**Currently eligible:** none yet — sponsor unblock pack of 2026-06-10 cleared ② and ⑤ (WP-01–06) and the region item; **WP-01's sole remaining blocker is gate ④'s staging half: staging is not provisioned/live** (provisioning needs cloud account/credentials — a human/infra action — or a sponsor decision re-scoping the staging-live requirement to pre-pilot). WP-01 becomes eligible the moment ④ is fully satisfied, all other gates passing live.

## Work package status

| WP | Title | Status | Branch / merge commit | Suites green | Amendments | Notes / NC carried |
|---|---|---|---|---|---|---|
| WP-00 | Environment standup | **DONE 2026-06-10** | `build/wp-00-environment-standup` → merge `e704eca` (feat `213478c`) | lint ✅ typecheck ✅ build ✅ placeholder suites 8/8 ✅ + `GET /health` runtime smoke ✅ (all local) | A5 | Staging deferred per A5 carve-out (no PG-region note); compose authored but unvalidated locally (Docker not installed); first GitHub CI run to be verified post-push |
| WP-01 | Platform foundation | **BLOCKED** (re-assessed 2026-06-10 after unblock pack) | — | — | — | Sole remaining blocker: ④ staging not provisioned/live (region note exists; checklist `16_Deployment/environment_plan.md` §3 needs cloud account/credentials). ② ✅ DEC-003 signed; ⑤ ✅ NC-carry (WP-01–06). Unblock: provision staging, or sponsor decision re-scoping staging-live to pre-pilot. |
| WP-02 | RBAC & staff admin | NOT STARTED | — | — | — | |
| WP-03 | Settings & transition engine | NOT STARTED | — | — | — | |
| WP-04 | Customers | NOT STARTED | — | — | — | |
| WP-05 | Catalog | NOT STARTED | — | — | — | |
| WP-06 | Import tooling | NOT STARTED | — | — | — | |
| WP-07 | Intake & WhatsApp panel | NOT STARTED | — | — | — | Hard NC: intake field set (workshop S3) |
| WP-08 | Review queue | NOT STARTED | — | — | — | |
| WP-09 | Order core | NOT STARTED | — | — | — | Hard NC: DEC-005 finals, cutoff |
| WP-10 | Kitchen | NOT STARTED | — | — | — | Hard NC: DEC-006 sections (pilot) |
| WP-11 | Payments-lite | NOT STARTED | — | — | — | |
| WP-12 | Notifications & reports | NOT STARTED | — | — | — | |
| WP-13 | Bridge & cutover tooling | NOT STARTED | — | — | — | Hard NC: real apply needs legacy access/export + workshop (payment vocab / off_days are soft — TS-M build-around) |
| WP-14 | Pilot hardening & gate | NOT STARTED | — | — | — | Workshop fully applied — no NC-carry |

Status vocabulary: NOT STARTED · IN PROGRESS (branch open) · BLOCKED (gate/NC — name it) · DONE (merged, suites green, pushed).

## Run log

| Date | Mode | Result |
|---|---|---|
| 2026-06-10 | Mode A — WP-00 | DONE (merge `e704eca`); suites green locally; staging deferred (region NC); WP-01 declared BLOCKED |
| 2026-06-10 | **Sprint Mode** (first run, after Mode B added @ `1ac4876`) | STEP 0 re-verified live: ①③ ✅, ② ❌, ⑤ ❌, ④ ◐. WP-00 already DONE (artifacts verified). Next eligible per dependency diagram = WP-01 → entry gate fails (② DEC-003, ⑤ workshop/NC-carry) → sprint stopped honestly, **0 new WPs executed**, no eligible WPs remain. Unblock = sign DEC-003 + record NC-carry note (or hold workshop) + PG-region note. |
| 2026-06-10 | Sponsor unblock pack (docs only) | DEC-003 SIGNED; NC-carry acceptance recorded (WP-01–06); interim PG staging region noted (AWS me-south-1). Gate re-check: ①②③⑤ ✅, ④ ◐ (CI ✅; staging not provisioned). **WP-01 still blocked on ④ staging-live only.** No WP executed (per session mission). |

## Amendments log (continues `phase_4_to_build_handoff.md` §4 — A1–A4 recorded there)

| ID | Date | Amendment | Raised by |
|---|---|---|---|
| A5 | 2026-06-10 | WP-00 "Environment standup" added ahead of WP-01 to satisfy global gate ④ (staging+CI) — resolves the bootstrap circularity in the Phase 4 gate; entry gate ①+③ only, no business code; staging provisioning conditional on a PG-region residency note in 20_Decisions/ (stop-rule carve-out); CI guards remain placeholders until WP-01 implements them | Phase 5 master prompt |
| *next: A6* | | | |
