# WP-14 Blocker Report — Pilot Hardening & Gate

**Date:** 2026-06-11 · **Session verdict: WP-14 remains BLOCKED — no execution started, nothing deployed, nothing marked done.**
Companion: `16_Deployment/staging_provisioning_checklist.md` (ready to execute once sponsor inputs arrive).

## 1. Why blocked — verified live this session, not assumed

| Check | Result |
|---|---|
| Cloud credentials (AWS CLI, env vars, GH secrets, repo sweep for keys/account-ids/endpoints) | **None exist anywhere.** Repo-wide sweep: zero credential traces; the only cloud fact on record is the region note (me-south-1 interim). Four docs consistently record credentials as missing |
| Docker on this machine | **Not installed** — compose/Dockerfiles remain unvalidated since WP-00; even a local staging-like rehearsal is impossible here |
| Staging environment | **Not provisioned** (gate ④ staging-half open; DEC-014 hard WP-14 entry) |
| Region note (checklist step 1) | ✅ satisfied — AWS me-south-1 interim |
| Baseline quality on `main` (`bd51afe`) | ✅ re-verified this session: 163/163 tests, both scans green locally; CI 13/13 green |

Per DEC-014 and the WP-14 stop-rule, none of this can be assumed away (ASM-042). **Entry gate fails ⇒ WP-14 scope work (UAT authoring, TS-A completion, perf baseline, training) was deliberately NOT started.**

## 2. Readiness matrix (29 requirements, by status)

### ✅ Done (4)
| Requirement | Evidence |
|---|---|
| All suites green on CI/local (DoD baseline) | 163/163, 13/13 CI on `bd51afe` (post-review) |
| TS-S #2–#6 scenario tests | ts-s-kitchen-flow / order-core / payments-flow / merge / cancel-and-reconcile (#3 added by review) |
| TS-A #2 (immutability) + #3 (same-transaction) | ts-a-audit.test.ts |
| Pilot definition (1 agent + 1 kitchen section + OM + Finance) | codex WP-14 row + test_strategy §UAT; sections config-seeded per ASM-028 |

### 🔧 Possible NOW (locally, before staging — ready-to-start backlog the moment WP-14 opens)
| Requirement | Note |
|---|---|
| TS-A #1 — reconstruct an order end-to-end from audit alone | all emitting paths exist; test authoring only |
| TS-A #4 — masked rendering per reader | maskFields infrastructure now active (review F2) |
| TS-A #5 — HIGH-severity weekly review completeness query | HIGH events emitted across M02/M07/M13/M18 |
| TS-S #1 — explicit single 7-step allergy-chain test | steps individually covered; one end-to-end test missing |
| TS-S #7 — resolution-note surface for reconciliation | small M18 addition + test (review L6) |
| UAT script **templates** (content stays workshop-gated) | format defined in test_strategy §UAT; no files exist |
| 50-screen regression mapping table in 15_Testing/ | source material exists (old_to_new_feature_map) |
| Training material **drafts** per role | format in phase_6_master_prompt STEP 5; finalize post-workshop |
| Perf-baseline harness + proposed thresholds (measurement itself needs staging) | no tooling exists yet; DEC-011 carries no thresholds |
| L4 read-boundary decision (bless config-master reads or add read-scan) | tech-lead decision, local CI work |

### ⛔ Staging-blocked (the DEC-014 chain)
TS-S full pass **on staging** · TS-A full **on staging with pilot data** (closes GAP-AUD-01) · TS-M applied-mode rehearsal / cutover runbook rehearsal · perf baseline measurement · restore drill (environment_plan §4) · pilot execution + exit review · MVP success criteria §7 measured (9 criteria, incl. the 30-day reconciliation clock; the legacy intake-time baseline ENH-QW-06 could be captured early if legacy access permits).

### 🧑‍⚖️ Workshop-blocked (no NC-carry permitted into WP-14)
Validator semantics for the four no-op validators (review L1: `same_day_ack`, `pause_window`, `plan_still_active`, `routing_rules_present`) · cancel-cascade day-state policy (review L2, incl. `ready_to_pack→cancelled_day` having no config row) · UAT **content** (cutoffs, mandatory fields, reason codes, sections — DEC-005/006/S3-Q8) · S8 matrix sign-off → deny-mode RBAC flip (success criterion 6; also resolves L3 payment-visibility hard-code).

### 📝 Sponsor-blocked
Cloud credentials + platform inputs STG-1…STG-7 (checklist §1) · assumption-register review/sign-off (ASM-001..050 — sponsor package already exists in 22_Meeting_Notes/).

## 3. New findings from this session (deploy-blocking defects, discovered by inspection)

D1–D6 in checklist §3 — most importantly: **the admin SPA cannot reach the API in the deployed topology** (relative fetches, stock nginx, no proxy/CORS/SPA-fallback), **TLS is mandatory** (Secure-only cookie baked into the image), **the API image cannot run migrations** (run from checkout), and `SESSION_SECRET` is dead config. None block the *provisioning start*; D1/D2 must be fixed during deploy or the smoke's admin-shell step and all browser logins fail.

## 4. Exact unblock sequence

1. **Sponsor:** supply checklist §1 inputs (STG-1…STG-6; STG-7 optional) — the single hard blocker for everything in §2's staging column.
2. **Operator (Docker-equipped machine):** execute checklist §4–§6 — provision, fix D1/D2 (validate D6), deploy `main`, run the 10-step smoke; record results; flip gate ④.
3. **Sponsor/workshop (parallel-safe with 1–2):** hold the workshop (validator semantics, cancel-cascade, UAT values, S8 matrix) + assumption-register sign-off.
4. Only after 2 (staging live + smoke recorded): open WP-14, starting with the "possible now" backlog above.

**Per mission constraint: staging is not available → this blocker report is the deliverable. No deployment occurred; no smoke ran; WP-14 is not marked complete or started.**
