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
| CI | ✅ Workflow live since WP-00 (`.github/workflows/ci.yml`); `gh` CLI verified locally; latest WP-13 merge run 27297588422 = 13/13 jobs green |
| Staging | ❌ **Deferred** — blocked by the PG-region/data-residency item below; provisioning checklist ready (`16_Deployment/environment_plan.md` §3) |
| Local environment | ✅ Verified (typecheck/lint/tests/build/smoke); Docker compose authored but **unvalidated locally** (Docker not installed) |
| Workshop / assumption-carry | ✅ **Assumption-carry accepted 2026-06-10 for WP-07+** (`20_Decisions/NOTE_assumption_carry_wp07_plus.md`, `ASSUMPTION_REGISTER.md`); workshop itself still outstanding and all assumptions stay sponsor-review-required |
| PG region / data residency | ◐ **Interim staging region noted 2026-06-10**: AWS me-south-1 (`NOTE_pg_staging_region_interim.md`); final production region revisited pre-launch (residency check stays open toward Phase 6) |

## What blocks WP-01+ (after DEC-014 staging re-scope, 2026-06-10)

WP-01 entry = global gate ①–⑤ of `phase_5_master_prompt.md`. Now: ① ✅ ② ✅ ③ ✅ ④ ✅-for-WP-01–13 (DEC-014: local + CI verification; CI mandatory and unweakened) ⑤ ✅ (assumption-carry, WP-07+ active).

**→ WP-01–13: ALL DONE (built 2026-06-10, Sprint Build Mode — latest WP-13 merge `369266f`, 147 local tests, CI run 27297588422 13/13). The staging-live/smoke-tested WP-14 entry gate was SATISFIED 2026-06-12.**

Still standing, clearly scoped:
1. ~~Staging live + smoke-tested — hard WP-14 / pre-pilot entry gate (DEC-014)~~ ✅ **RESOLVED 2026-06-12**: sponsor provided a VPS (supersedes me-south-1 for staging — `20_Decisions/NOTE_vps_staging_host.md`); deployed `main` `d69a107` + D7 fix, **10/10 smoke passed** at `https://13-140-159-201.sslip.io`; gate ④ flipped in the register. Residual item from this gate: the **restore drill** (nightly dumps running, drill not yet exercised — WP-14 entry per environment_plan §4).
2. **WP-07+ business decisions** — intake field set, DEC-005 finals, DEC-006 sections, and related OPEN decisions are now carried as explicit assumptions in `ASSUMPTION_REGISTER.md`. They do not block build by themselves, but they remain sponsor-review-required and reversible.
3. ~~Practical session duty: CI verification tooling~~ **Resolved 2026-06-10**: `gh` CLI installed + authed; all CI runs to date verified green (latest WP-13 merge run 27297588422 = 13/13 jobs). Sessions verify per-WP runs with `gh run list` / `gh run view`.

## WP-07 legacy review pack and build status

**2026-06-10:** `22_Meeting_Notes/WP07_orders_create_legacy_review_pack.md` was created as a sponsor decision pack for old `/orders/create`. The pack confirms the old field categories visible in read-only discovery, but old-system evidence does **not** verify required flags, warning-only behavior, defaults, or submit blockers.

**2026-06-10 update:** Sponsor/user explicitly accepted assumption-based continuation. The missing decisions below are now active assumptions in `ASSUMPTION_REGISTER.md`; they remain sponsor-review-required but no longer block WP-07 by themselves:

1. Mandatory submit field set for `/orders/create` draft intake.
2. Draft-save vs submit-block rules.
3. DEC-004 customer identity and duplicate policy: phone matching, multiple phones, exact match, fuzzy match, force duplicate, merge role.
4. DEC-002 WhatsApp posture: manual reference fields, raw-content privacy, no webhook/API in WP-07 unless signed.
5. Allergy and health behavior: required allergy question, explicit "no allergy" vs blank, severity levels, conflict warning/blocking, override role.
6. Package/date/delivery/payment capture: package/sub-package/package-for, start/end or delivery dates, address/area/slot/method, pickup/branch posture, expected payment method, unpaid submit policy.
7. Coupon validation mode and slot capacity mode.
8. Order/draft creation state and edit-after-submit rule.

**2026-06-10 build update:** WP-07 was implemented and merged under those active assumptions. It adds draft intake/completeness/incomplete queue/allergy-warning behavior plus immutable manual WhatsApp reference capture. It does not close the sponsor questions above; they remain review-required and traceable through `ASSUMPTION_REGISTER.md`.

## Exact next action

> **2026-06-12 — superseded: staging inputs were supplied and executed.** Sponsor provided a VPS in place of STG-1/2; STG-3/4 satisfied by on-host PG 16 container + nightly dumps (deviation note `20_Decisions/NOTE_vps_staging_host.md`); STG-5 by Caddy/Let's Encrypt at `13-140-159-201.sslip.io`; STG-6 supplied in-session. Deployed → migrated → bootstrapped → **smoke 10/10** → gate ④ flipped. One live defect (D7, bare `/kitchen` 301) found and fixed during smoke — checklist §3.

**WP-14's remaining critical path** is now the non-infrastructure items per `19_Roadmap/wp14_blocker_report.md` §4: the workshop items (validator semantics L1, cancel-cascade L2, UAT values, S8 matrix), assumption-register sign-off, and the staging **restore drill** (environment_plan §4). UAT/pilot can now exercise the live staging URL.
