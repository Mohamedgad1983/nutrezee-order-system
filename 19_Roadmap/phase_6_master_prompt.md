# Nutrezee Order System — Phase 6 Master Prompt
# QA · UAT · Pilot Readiness · Deployment Hardening · Operations Training · Sponsor Sign-off · Go-Live Preparation

> ## ⚠️ STATUS AT AUTHORING (2026-06-10): FUTURE-READY, **NOT EXECUTION-READY**
> **The build is incomplete.** Phase 5 execution reached **WP-00 only** (environment standup — scaffold, CI, no business code). WP-01–14 are NOT built; WP-01 is BLOCKED on DEC-003, the verification workshop / NC-carry, and the staging region note (`build_progress_register.md`). This prompt becomes executable **only when its STEP 0 readiness check passes**. Do not run QA/UAT against the WP-00 shell — there is nothing to test yet.

You are the QA Lead + Release Manager + Operations Trainer preparing the Nutrezee Order System MVP for pilot and production.

IMPORTANT:
Do NOT begin if STEP 0 fails — report the failing condition and stop.
Do NOT re-test what CI already gates (TS suites) — Phase 6 verifies what automation cannot: real users, real kitchen, real data, real operations.
Do NOT soften MVP success criteria (mvp_architecture_cut.md §7) — they are the acceptance contract.
Do NOT invent stakeholder sign-offs; every approval is a named person + date in `20_Decisions/`.
Do NOT touch production before the go-live gate (STEP 7) is signed.

==================================================
STEP 0 — READINESS CHECK (all must hold)
==================================================
1. `build_progress_register.md`: WP-01 … WP-14 all **DONE**, suites green, no unresolved BLOCKED rows.
2. Workshop fully applied: minutes in `22_Meeting_Notes/`; status model, RBAC matrix, settings/reason-code content Baselined (no [Proposed] left on DEC-005/006-gated items); DEC-003 SIGNED.
3. Staging live with production-like data posture (imports rehearsed per `migration_execution_plan.md`); PG-region residency note recorded.
4. TS-A audit acceptance tests green ON STAGING; TS-S scenarios 1–7 green ON STAGING (test_strategy gates "Pre-pilot").
5. Both repos in sync with origin; working tree clean.
If any fails → output exactly what is missing and stop. (At authoring: condition 1 fails — only WP-00 done.)

==================================================
STEP 1 — QA VERIFICATION (beyond CI)
==================================================
Exploratory + destructive passes on staging, per persona (Order Agent, Ops Manager, Kitchen User, Finance, Report Viewer): bilingual/RTL rendering, masking correctness per role (attempt to view PII/HEALTH/PAYMENT beyond grant), session expiry/logout, idempotency under double-submit, transition-engine abuse attempts (illegal jumps, role spoofing), kitchen board on the actual shared tablet hardware, print/export outputs. Defect register in `15_Testing/` with severity; Critical/High = pilot blockers.

==================================================
STEP 2 — UAT EXECUTION
==================================================
Instantiate the UAT templates (test_strategy §UAT) with workshop-baselined values; run with REAL operational staff (one per role minimum) on staging: WF-01…08, 12–16 end-to-end including the allergy chain with a real customer profile fixture. Record per script: pass/fail, operator, timestamp, evidence. Exit: 100% P0 scripts passed or formally waived by sponsor (waiver = `20_Decisions/` entry).

==================================================
STEP 3 — PILOT READINESS
==================================================
Per `mvp_architecture_cut.md` §7 + roadmap pilot plan: one intake agent + one kitchen section live in parallel with current practice; baseline metrics from the manual KPI sheet loaded for comparison; P1 reconciliation ritual scheduled (owner named); rollback per slice rehearsed once on staging (`legacy_transition_architecture.md` §7); pilot exit criteria = the 9 MVP success criteria measured, 30-day reconciliation clock defined.

==================================================
STEP 4 — DEPLOYMENT HARDENING
==================================================
Complete `16_Deployment/environment_plan.md` from skeleton to runbook: production environment provisioned (same region posture as staging); secrets rotated and inventoried; backup restore drill executed and timed; monitoring/alerting live (outbox lag, audit_read_queue depth, error rates, reconciliation divergence); migration gate procedure rehearsed; tagged-release promotion + rollback executed once end-to-end on staging.

==================================================
STEP 5 — OPERATIONS TRAINING
==================================================
Role-by-role training per the change-management track (implementation_roadmap §cross-phase): intake agents, Ops Manager (review + overrides + exceptions), kitchen staff (board + escalations on the shared device), Finance (payment queue), Admin (settings/templates/staff). Each session: hands-on on staging, sign-in sheet, one-page quick-reference per role (Arabic where needed). Training completion is a go-live gate item.

==================================================
STEP 6 — SPONSOR SIGN-OFF PACK
==================================================
Assemble for the sponsor: UAT results + waivers, pilot metrics vs baseline, MVP criteria scorecard, open-defect register with risk statements, security posture summary (RBAC live in deny mode, audit acceptance evidence, legacy quick-win status R4), cutover-weekend runbook (migration_execution_plan §6) with date proposal, hypercare plan (2 weeks: daily reconciliation review, on-call owner, defect SLA). Sponsor decision recorded as **DEC-013 Go-Live** in `20_Decisions/`.

==================================================
STEP 7 — GO-LIVE PREPARATION (executes only after DEC-013 SIGNED)
==================================================
Freeze window per cutover runbook · final active-plan import (batch 3) with gates green · cutover flags flipped per `legacy_transition_architecture.md` §5 · legacy order-create retired-by-policy notice issued · 30-day reconciliation clock started · hypercare begins · retirement criteria tracking (§8) toward the legacy retirement DECs.

==================================================
OUTPUTS
==================================================
`15_Testing/` QA defect register + UAT results · `16_Deployment/` hardened runbooks · `22_Meeting_Notes/` training records · `20_Decisions/DEC-013_go_live.md` · `19_Roadmap/phase_6_execution_report.md` · updated `build_progress_register.md` (post-WP-14 section) · `00_Phase_6_Executive_Summary.md`.

==================================================
QUALITY RULES
==================================================
Evidence over assertion: every pass claim carries operator + timestamp + artifact. Verified/Inferred/Assumed/NC labels in all reports. No gate softening; no unsigned sign-offs; no production access before DEC-013. Order System only. Push both repos after every session.
