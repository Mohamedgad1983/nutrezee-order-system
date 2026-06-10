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
| ④ Staging + CI live | ✅ **for WP-01–08 per DEC-014 re-scope**. CI half **Verified on GitHub 2026-06-10**: all runs green since WP-00; latest merge run 27290329062 = 13/13 jobs success (lint, typecheck, build, ts-u…ts-s, scans); `gh` CLI authed locally for per-WP verification. Staging half: **NOT provisioned, NOT done** — hard pre-pilot/WP-14 entry gate; region AWS me-south-1 interim; provisioning still needs cloud credentials |
| ⑤ Workshop held / assumption-carry acceptance | ✅ **Assumption-carry recorded 2026-06-10 for WP-07+** (`20_Decisions/NOTE_assumption_carry_wp07_plus.md`, `ASSUMPTION_REGISTER.md`); workshop itself still outstanding and all assumptions stay sponsor-review-required |

**Currently eligible: WP-09.** WP-07+ unresolved business questions are carried as explicit assumptions in `ASSUMPTION_REGISTER.md`, with sponsor review still required. Build continues as far as technically possible under those assumptions. Staging live + smoke-tested remains the hard WP-14/pre-pilot gate and cannot be assumed away.

## Work package status

| WP | Title | Status | Branch / merge commit | Suites green | Amendments | Notes / NC carried |
|---|---|---|---|---|---|---|
| WP-00 | Environment standup | **DONE 2026-06-10** | `build/wp-00-environment-standup` → merge `e704eca` (feat `213478c`) | lint ✅ typecheck ✅ build ✅ placeholder suites 8/8 ✅ + `GET /health` runtime smoke ✅ (all local) | A5 | Staging deferred per A5 carve-out (no PG-region note); compose authored but unvalidated locally (Docker not installed); first GitHub CI run to be verified post-push |
| WP-01 | Platform foundation | **DONE 2026-06-10** | `build/wp-01-platform-foundation` → merge `569dfe1` (feat `fddb1d1`) | Local: 25/25 (TS-I, TS-A #2/#3, TS-R generated 132-case, TS-U auth) + lint/typecheck/build/scans. CI run 27281542344: **13/13 jobs green** incl. DB-backed suites vs postgres:16 service + real boundary/no-GET-mutation scans | — | Wave-1 schema (18 tables) + seeds (12 roles, 48 transition rows [Proposed DEC-005], 13 settings); audit/outbox/idempotency/sessions/staged-RBAC platform. NC carried: DEC-005 enums Proposed; argon2 params pinned at WP-02; audit monthly-partition automation deferred (default partition) |
| WP-02 | RBAC & staff admin | **DONE 2026-06-10** | `build/wp-02-rbac-staff-admin` → merge `2091f7c` (feat `ce9f762`) | Local 37/37 (TS-R full matrix log+warn+deny sweeps; TS-U staff ×10) + lint/scans; CI 13/13 green | — | Staff lifecycle HIGH-audited w/ diffs; grants only via M13 (C4); dormant-grant alert; level caps [Proposed]; matrix export-compare CLI; argon2 params pinned. NC carried: matrix content awaits S8 sign-off; admin SPA screens consolidate at WP-07 UI |
| WP-03 | Settings & transition engine | **DONE 2026-06-10** | `build/wp-03-settings-transition-engine` → merge `4906fbc` | Local 51/51 (TS-U transitions GENERATED from config: 40+ active rules × allow/role/reason + fail-closed validators + no-redeploy config edits; TS-I settings invalidation proven) + CI 13/13 | — | Engine = platform service; owning modules write their own tables via apply callback (ADR-010). Rule CONTENT stays workshop-owned [NC DEC-005/006] |
| WP-04 | Customers | **DONE 2026-06-10** | `build/wp-04-customers` → merge (see git log) | Local 61/61 (TS-U dedup/read-logging; TS-S #6 merge+undo) + CI 13/13 | A1 applied in DDL | Soft-unique phones (family-share NC); merge re-link hook ready for WP-07 drafts; HTTP surface consolidates at WP-07; primary-phone ordering bug caught by partial index in test |
| WP-05 | Catalog | **DONE 2026-06-10** | `build/wp-05-catalog` → merge (git log) | Local 68/68 (TS-U allergen-resolver + mirror-mode DoD) + CI 13/13 | **A6** | Mirror mode proven (import-only core writes until cutover_catalog); cycle guard (C7); routing rules zero-row [NC DEC-006]; catalog owner [NC Q1] |
| WP-06 | Import tooling | **DONE 2026-06-10** | `build/wp-06-import-tooling` → merge (git log) | Local 74/74 (TS-M real: dry-run report, apply gate, idempotency, quality gates, rollback) + CI 13/13 (ts-a rerun after Docker-registry flake) | — | Boundary scan caught 3 ADR-010 violations in first draft → import APIs on owning modules. Real legacy runs still blocked on access/export (WP-13) |
| WP-07 | Intake & WhatsApp panel | **DONE 2026-06-10** | `build/wp-07-intake-whatsapp-panel` → merge `59dfa3c` (feat `074417f`) | Local 83/83 full Vitest + lint/typecheck/build/scans; CI run 27289272120: **13/13 jobs green** | A7, A8 | M01 draft intake/completeness/incomplete queue/allergy warnings + M17 immutable manual WhatsApp refs. Built under ASM-003..024; sponsor review still required for assumptions. |
| WP-08 | Review queue | **DONE 2026-06-10** | `build/wp-08-review-queue` → merge `f68177d` (feat `c22885f`) | Local 93/93 full Vitest + lint/typecheck/build/scans; CI run 27290329062: **13/13 jobs green** | A9 | M02 queue/SLA/claim/decisions, append-only review decisions, return/reject via M01 transition port, approval emits `order.approved` with WP-09 conversion pending. ASM-025 reviewer=creator allow+audit remains sponsor-review-required. |
| WP-09 | Order core | NOT STARTED | — | — | — | DEC-005 finals and cutoff carried as assumptions ASM-026/ASM-027; sponsor review still required |
| WP-10 | Kitchen | NOT STARTED | — | — | — | DEC-006 sections/shared-device model carried as assumptions ASM-028/ASM-029; sponsor review still required |
| WP-11 | Payments-lite | NOT STARTED | — | — | — | |
| WP-12 | Notifications & reports | NOT STARTED | — | — | — | |
| WP-13 | Bridge & cutover tooling | NOT STARTED | — | — | — | Hard NC: real apply needs legacy access/export + workshop (payment vocab / off_days are soft — TS-M build-around) |
| WP-14 | Pilot hardening & gate | NOT STARTED | — | — | — | Workshop fully applied — no NC-carry. **Hard entry gate per DEC-014: staging provisioned, live, and smoke-tested** (env plan §3) |

Status vocabulary: NOT STARTED · IN PROGRESS (branch open) · BLOCKED (gate/NC — name it) · DONE (merged, suites green, pushed).

## Run log

| Date | Mode | Result |
|---|---|---|
| 2026-06-10 | Mode A — WP-00 | DONE (merge `e704eca`); suites green locally; staging deferred (region NC); WP-01 declared BLOCKED |
| 2026-06-10 | **Sprint Mode** (first run, after Mode B added @ `1ac4876`) | STEP 0 re-verified live: ①③ ✅, ② ❌, ⑤ ❌, ④ ◐. WP-00 already DONE (artifacts verified). Next eligible per dependency diagram = WP-01 → entry gate fails (② DEC-003, ⑤ workshop/NC-carry) → sprint stopped honestly, **0 new WPs executed**, no eligible WPs remain. Unblock = sign DEC-003 + record NC-carry note (or hold workshop) + PG-region note. |
| 2026-06-10 | Sponsor unblock pack (docs only) | DEC-003 SIGNED; NC-carry acceptance recorded (WP-01–06); interim PG staging region noted (AWS me-south-1). Gate re-check: ①②③⑤ ✅, ④ ◐ (CI ✅; staging not provisioned). **WP-01 still blocked on ④ staging-live only.** No WP executed (per session mission). |
| 2026-06-10 | Sponsor DEC-014 staging gate re-scope (docs only) | Staging-live moved to hard pre-pilot/WP-14 entry for WP-01–06; build proceeds on local + CI (CI mandatory). Gate re-check: all gates pass for WP-01–06 → **WP-01 ELIGIBLE**. Staging remains NOT provisioned (credentials blocker stands for provisioning only). No WP executed (per session mission). |
| 2026-06-10 | **Sprint Build Mode** (second run) | **WP-01→02→03→04/05→06 ALL DONE in one session** — 6 atomic WPs, each branch→scope→suites→green-CI→merge→register→push. 74 tests (12 files) green; 6 CI runs 13/13 (one ts-a Docker-registry flake re-run, never merged past red). Local PostgreSQL 16 installed for DB-backed suites. Amendment A6 raised (ingredient_allergen). Boundary scan caught 3 real ADR-010 violations mid-sprint (fixed via owning-module import APIs). Sprint stopped honestly at WP-07's workshop NC (stop-rule; NC-carry ends at WP-06). |
| 2026-06-10 | Discovery Mode - Legacy-first section alignment audit | Audit created at `19_Roadmap/legacy_first_section_alignment_audit.md`. Result **PASS_WITH_GAPS**: old-system section evidence is sufficient for a baseline map, current build coverage is foundation-heavy through WP-06, and WP-07 remains blocked on the mandatory intake-field set/workshop S3 Q8. No WP statuses changed; no feature code/tables/APIs/UI created. |
| 2026-06-10 | Discovery Mode - WP-07 `/orders/create` legacy review pack | Pack created at `22_Meeting_Notes/WP07_orders_create_legacy_review_pack.md`. Result **READY_FOR_SPONSOR_SIGNOFF**: old `/orders/create` field categories are documented, but submit blockers/defaults/warnings/customer identity/WhatsApp/allergy/payment/coupon/delivery decisions remain missing. WP-07 stays **BLOCKED**; no feature code/tables/APIs/UI created. |
| 2026-06-10 | Assumption-carry setup for WP-07+ | `ASSUMPTION_REGISTER.md`, `20_Decisions/NOTE_assumption_carry_wp07_plus.md`, and `22_Meeting_Notes/sponsor_review_package_unresolved_business_questions.md` created from sponsor/user directive. Result: WP-07 is eligible under explicit Assumed-for-build values; unresolved questions remain sponsor-review-required. No feature code/tables/APIs/UI created in this doc-only step. |
| 2026-06-10 | **Sprint Build Mode** (WP-07) | **WP-07 DONE** — branch `build/wp-07-intake-whatsapp-panel`, feature `074417f`, merge `59dfa3c`; local full Vitest 83/83 plus lint/typecheck/build/scans green; GitHub CI run 27289272120 13/13 green. Built under `ASSUMPTION_REGISTER.md`; WP-08 becomes next eligible. |
| 2026-06-10 | **Sprint Build Mode** (WP-08) | **WP-08 DONE** — branch `build/wp-08-review-queue`, feature `c22885f`, merge `f68177d`; local full Vitest 93/93 plus lint/typecheck/build/scans green; GitHub CI run 27290329062 13/13 green. Built under `ASSUMPTION_REGISTER.md`; WP-09 becomes next eligible. |

## Amendments log (continues `phase_4_to_build_handoff.md` §4 — A1–A4 recorded there)

| ID | Date | Amendment | Raised by |
|---|---|---|---|
| A5 | 2026-06-10 | WP-00 "Environment standup" added ahead of WP-01 to satisfy global gate ④ (staging+CI) — resolves the bootstrap circularity in the Phase 4 gate; entry gate ①+③ only, no business code; staging provisioning conditional on a PG-region residency note in 20_Decisions/ (stop-rule carve-out); CI guards remain placeholders until WP-01 implements them | Phase 5 master prompt |
| A6 | 2026-06-10 | `ingredient_allergen` link table added (wave-2 catalog DDL) — AllergenResolver's derived_from_ingredient semantics required ingredient→allergen links missing from the logical data model; structure-only, discovered during WP-05 | WP-05 build session |
| A7 | 2026-06-10 | Assumption-carry control added for WP-07+ after sponsor/user directive: unresolved business decisions are captured in `ASSUMPTION_REGISTER.md`, assigned risk, marked sponsor-review-required, and allowed for implementation until revised; hard technical gates, dormant-module boundaries, real legacy access/export, and WP-14 staging gate still stop the build | Sponsor/user directive |
| A8 | 2026-06-10 | `draft_order.unverified_reason` added in WP-07 to carry the explicit unverified-customer submit justification required by ASM-005/006 without creating a separate review table before WP-08; structure-only, intake-owned, reversible if sponsor signs a different identity workflow | WP-07 build session |
| A9 | 2026-06-10 | WP-08 added a boundary-safe M02→M01 review port and `TransitionEngine.transitionInTx` so review decisions can atomically return/reject drafts without M02 writing `draft_order`; approve records an append-only review decision and emits `order.approved` with `conversion_pending_wp09` because OrderFactory belongs to WP-09 | WP-08 build session |
| *next: A10* | | | |
