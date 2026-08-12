# Live Blockers & Decisions — Build Execution

**Date:** 2026-08-12 (verify live each session — `build_progress_register.md` gate snapshot + `20_Decisions/decision_register.md` are the operative sources; this file is the orientation summary) · **Status:** Living

## WP-OPS-01 daily Partner selector — resolved 2026-08-12

A36 replaced the incomplete `/integration/meal-history` + `/integration/orders` daily membership logic with Partner's exact-date live `/integration/daily-deliveries` endpoint. A37 then resolved the verified Aug-13 one-row membership surplus by requiring a root-protected, PII-free Driver Orders order-number manifest when one is present. Fleetbase now contains exactly 883 unique Aug-12 orders and exactly 855 unique Aug-13 orders; Aug-13 has 657 dispatched/assigned and 198 explicitly held, with 0 duplicates and the API-only order excluded. Aug-14 was independently verified as a zero-delivery day. The rolling 48-hour (+1/+2 day) timer is enabled for 07:00 Kuwait; each date is isolated, uses two-pass count/digest reconciliation, and the service has `Restart=no`. The separate read-only 01:00 snapshot remains enabled and cannot write Fleetbase.

## WP-KDS-02 user-assigned section isolation — resolved 2026-08-08

A35 corrects the Kitchen Display from one shared all-sections credential to one or more exact section assignments per authenticated user. PR #50 merged the server session claims, assignment-scoped totals API, and redesigned section-focused UI as `251e1f2`; PR #51 corrected the uncached live-read deadline mismatch and merged as final production release `0fd988a`. Final KDS/root CI is green (`31256752632`, `31256752652`). The protected six-user manifest is active, every current Partner section account returned exactly its own section, a cross-section query was rejected with HTTP 400, and protected Chromium plus direct browser/API isolation passed. The container is healthy with zero restarts and zero error logs. There is no remaining KDS blocker.

## WP-KDS-01 production activation — resolved 2026-08-08

The standalone Kitchen Display is production-active at `https://kds.13-140-159-201.sslip.io` on final release `0fd988a`. The user supplied the dedicated production Partner credential and explicitly directed autonomous production activation. It is held only in the protected server-side secret file; it was never committed, printed, returned to the browser, or found in the container logs. The protected user manifest stores independently salted scrypt hashes plus exact section assignments, and the current temporary plaintext handoff remains root-only at `/root/nutrezee-kds-display-initial-password`; its literal value is intentionally excluded from source control and documentation. User-directed A33 makes English/LTR the initial login/display language while retaining an explicit persistent Arabic/RTL toggle.

The production service is healthy with zero restarts, non-root runtime user `node`, read-only root filesystem, `cap_drop=ALL`, no direct secret environment entries, and only a read-only `/run/secrets` bind. HTTPS, security headers, unauthenticated 401, secure/HttpOnly/SameSite=Strict session cookie, logout revocation, unsafe-method 405, invalid-query 400, Arabic RTL, English LTR, and 390px responsive rendering all passed.

For Kuwait delivery date `2026-08-08`, an independent server-side GET-only verifier paginated four Partner requests and exactly matched the displayed projection: 3,178 source rows, source quantity 3,266, section-work quantity 6,532, six sections, 222 meal/portion groups, and zero unrouted quantity. The live API/browser privacy scan and container log scan passed with no customer, phone, address, order/item identifier, driver, barcode, label, API-key, or display-password exposure. WP-KDS-01 is DONE; there is no remaining KDS blocker for Release 1.

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
| CI | ✅ Workflow live; draft parent PR #43 is clean/mergeable and push/PR runs 30170042208 + 30170050086 passed 14/14. |
| Staging | ✅ **Live and healthy** at `https://13-140-159-201.sslip.io`; Nutrezee database currently has 22 migrations through `0023_address_block.sql`. WP-OPS-02/03 are not deployed. |
| Local environment | ✅ Current operational branch is clean and pushed; full app checks and 313 tests passed during WP-OPS-03 closeout. |
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

> **2026-07-25 — WP-OPS-02/03 release gate verified:** provision separate least-privilege Fleetbase service identities for credential rotation and order reassignment, store their tokens only in `/opt/nutrezee/.env` mode `0600`, and identify the named human Logistics Manager account. The three required integration variables are currently unset; no dedicated Logistics Manager exists; migrations `0025/0026` are not deployed. Draft PR #43 is green and mergeable but must remain unmerged until those inputs exist and its broad operational parent diff is reviewed. Then merge PR #43, deploy migrations `0024–0026`, and run the required staging Playwright and Navigator proof. Do not use the UAT seed account or silently add logistics privileges to the existing super-admin as a substitute.

**WP-14's remaining critical path** is now the non-infrastructure items per `19_Roadmap/wp14_blocker_report.md` §4: the workshop items (validator semantics L1, cancel-cascade L2, UAT values, S8 matrix), assumption-register sign-off, and the staging **restore drill** (environment_plan §4). UAT/pilot can now exercise the live staging URL.
