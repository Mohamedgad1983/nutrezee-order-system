# Sponsor Decision Pack — One Page to Cutover

**Date:** 2026-06-14 · **Status:** Awaiting sponsor action · **Audience:** Project sponsor + operations leadership
**Purpose:** the **single** consolidated list of everything the sponsor must supply or decide for the new system to replace the legacy daily order operation. Engineering has built and tested every unit that does not need an external input; what remains is on this page. Each item names exactly what to provide and what it unblocks. Detailed backing docs are linked, not duplicated.

> **One-line status:** the order-ops system is **engineering-complete on staging** (`https://13-140-159-201.sslip.io`) and proven (build done, restore drill done, 23/23 migration-toolkit tests, e2e suite green). It cannot reach cutover without the four sponsor inputs below. Nothing engineering can do substitutes for them.

---

## The ask, in priority order

### 🔴 S1 — Legacy system access (the longest pole)
**Provide:** legacy admin URL + a **read-only** account (`LEGACY_BASE_URL`, `LEGACY_ADMIN_EMAIL`, `LEGACY_ADMIN_PASSWORD`), and choose a bridge pattern (P1 manual / P2 export-import / P3 DB-API) by dispositioning the 12 access items.
**Unblocks:** all real data migration — entity calibration (12 entities), every extraction dry-run, legacy-vs-new comparison, Batch 1/2/3 apply, and therefore cutover itself.
**Why it's safe:** the extraction toolkit is **read-only and dry-run-only** — it logs in, switches to strict read-only, blocks every mutating request, redacts PII, and never imports. It physically cannot change the legacy system. (Proof: `tools/legacy-migration/reports/extraction-validation-record.md`.)
**Detail:** `10_Data_Model/migration_gap_register.md` (MG-A1/A2/A3), `modules/11_undiscovered_surfaces_access_needed.md` (the 12 items).
**Status:** ☐ not provided.

### 🔴 S2 — Workshop pack (one session)
**Decide:** the content the engines were built to receive (engines are live and zero-row-ready):
- DEC-005 transition-validator semantics (L1) + cancel-cascade (L2) — `migration_gap_register.md` MG-D1/D2.
- DEC-006 kitchen sections → routing-rule content — MG-D3.
- Settings critical trio + `kitchen_cutoff_time` — MG-D4.
- RBAC matrix S8 sign-off (→ deny-mode flip) — MG-D5.
- Cutover day-of-week (lowest-volume day) — MG-D7.
- ASM-001..050 sign-off — MG-D6 / `ASSUMPTION_REGISTER.md`.
- UAT values: mandatory intake fields, reason-code wording, refund/payment policies (the `[NC]` tags in `15_Testing/uat_pack.md`).
**Unblocks:** correct transition guards, kitchen routing, RBAC final posture, UAT with real values, cutover scheduling, formal assumption closure.
**Detail / agenda:** `22_Meeting_Notes/verification_workshop_agenda.md`, `22_Meeting_Notes/sponsor_review_package_unresolved_business_questions.md`, `WP07_orders_create_legacy_review_pack.md`.
**Status:** ☐ workshop not held.

### 🟠 S3 — Production environment decision
**Decide:** production posture — same VPS pattern as staging, or managed PostgreSQL — and authorize provisioning (production "not before the WP-14 gate").
**Unblocks:** the cutover target (MG-E6); on decision, engineering provisions → migrates → restore-drills → smokes it.
**Detail:** `16_Deployment/environment_plan.md §1`, `16_Deployment/operations_runbook.md §6`.
**Status:** ☐ undecided.

### 🟡 S4 — Operational unblocks (user/admin, not engineering)
- **GitHub Actions billing** — restore it so PRs get a real CI gate again (units are currently admin-merged after local tests + staging Playwright). `migration_gap_register.md` MG-E8.
**Status:** ☐ billing blocked.

---

## What each unlock turns on (dependency view)

```
S1 (legacy access) ──► calibrate ──► extraction dry-run ──► Batch 1+2 apply ──► Batch 3 (cutover) ─┐
S2 (workshop)      ──► validators/routing/RBAC/settings ──► UAT real values ──► pilot ─────────────┤──► GO-LIVE (DEC-013) ──► cutover weekend ──► 30-day clock ──► legacy retired
S3 (prod env)      ──► provision + restore-drill prod ────────────────────────────────────────────┤
S4 (CI billing)    ──► live CI gate (quality-of-life, not a hard cutover gate) ───────────────────┘
```

**The two gates that actually move the date: S1 and S2.** S3 runs in parallel once decided. S4 is hygiene.

## What engineering has already done (so the sponsor sees the asymmetry)

| Area | State |
|---|---|
| Build (WP-00..13, all UI/API) | ✅ done, merged, on staging |
| Migration machinery (toolkit + M19 import + reconciliation) | ✅ built + tested; dry-run-safe; waits on S1 |
| Migration readiness (gap register, calibration playbook, execution runbook, validation record) | ✅ `10_Data_Model/` + toolkit reports |
| UAT pack + execution log | ✅ `15_Testing/` — runnable on staging with placeholders |
| Cutover / rollback / pilot checklists | ✅ `16_Deployment/` |
| Operations / hypercare / go-live pack | ✅ `16_Deployment/` |
| Restore drill | ✅ done 2026-06-14 (backups proven recoverable) |
| Staging live + seeded for UAT | ✅ |

## Decision capture (sponsor fills)

| Item | Decision / value | Date | By |
|---|---|---|---|
| S1 legacy access + bridge pattern | | | |
| S2 workshop (DEC-005/006, RBAC, settings, cutover day, ASM) | | | |
| S3 production environment posture | | | |
| S4 GitHub Actions billing | | | |

**On S1 + S2 landing, the path to cutover is engineering-executable end-to-end** — calibrate → dry-run → Batch apply → UAT → pilot → go-live → cutover weekend → 30-day reconciliation → legacy order-ops retired. Sequencing detail: `19_Roadmap/Legacy_Core_Gap_To_Cutover.md §3` and `19_Roadmap/CUTOVER_READINESS_INDEX.md`.
