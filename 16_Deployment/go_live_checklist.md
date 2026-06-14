# Go-Live Checklist & Sponsor Sign-Off Pack (DEC-013)

**Date:** 2026-06-14 · **Status:** Template ready; sign-off pending WP-14 completion · **Owners:** Release Reviewer (assembles), Sponsor (signs)
**Design source:** `19_Roadmap/phase_6_master_prompt.md` STEP 6, `13_Architecture/legacy_transition_architecture.md §8` (retirement), `13_Architecture/mvp_architecture_cut.md §7`
**Output:** `20_Decisions/DEC-013_go_live.md` — signed. This is the **hard gate** before `cutover_checklist.md` runs.

> **Go-live is a sponsor business decision, not an engineering one.** Engineering assembles the evidence pack below; the sponsor signs DEC-013 (or signs with waivers, or declines). This checklist is both the readiness gate **and** the table of contents for the sign-off pack.

---

## 1. Readiness gate (every item evidenced before assembling the pack)

### Engineering complete
- ☐ WP-00 … WP-13 DONE & merged (register confirms).
- ☐ WP-UI-01/02/03/04 + WP-API-01/01b/02 DONE (all daily-ops + admin screens live on staging).
- ☐ WP-14 operational items complete (restore drill ✅ 2026-06-14; perf baseline MG-E3; monitoring MG-E7).
- ☐ No open Critical/High defect on the order-ops slice.

### Data migration ready
- ☐ Legacy access granted (MG-A1); entities calibrated; extraction dry-run 🟢.
- ☐ Batch 1 (catalog) + Batch 2 (customers) applied to the cutover target; reconciliation clean.
- ☐ Batch 3 dry-run green on a recent snapshot (DQ gates pass).
- ☐ Rollback rehearsed on staging (`rollback_checklist.md §Rehearsal`).

### Validation complete
- ☐ UAT PASS recorded (`15_Testing/uat_execution_log.md`); `[NC]` cases passed behaviorally; real values logged.
- ☐ TS-S 7/7 + TS-A audit acceptance green **on staging** with pilot data.
- ☐ Pilot exit-review GO (`pilot_plan.md §6`): 9 success criteria met or waived.

### Workshop applied
- ☐ DEC-005/006 content seeded (validators L1/L2, kitchen routing) or risk-accepted.
- ☐ RBAC matrix S8 signed; deny-mode posture decided.
- ☐ Settings critical trio + `kitchen_cutoff_time` set (MG-D4).
- ☐ ASM-001..050 reviewed/signed (MG-D6).

### Operational ready
- ☐ Production environment provisioned + restore-drilled (MG-E6) OR explicit decision to cut over on the current host.
- ☐ Monitoring/alerting live (health + backup-freshness non-negotiable; rest per `operations_runbook.md §2`).
- ☐ Hypercare plan staffed (`support_hypercare_plan.md`); on-call roster confirmed.
- ☐ Training delivered per persona (sign-ins recorded).
- ☐ Cutover date chosen (MG-D7, lowest-volume day) + window agreed.

## 2. Sign-off pack contents (assemble for the sponsor)

| # | Pack section | Source |
|---|---|---|
| 1 | **UAT results + waivers** | `15_Testing/uat_execution_log.md` (signed) |
| 2 | **Pilot metrics vs baseline** | `pilot_plan.md §6` exit review + KPI sheet |
| 3 | **MVP success-criteria scorecard** | `mvp_architecture_cut.md §7` — 9 criteria, met/waived |
| 4 | **Open-defect register** w/ risk statement per item | this run's defect register |
| 5 | **Security posture** | `21_Risks/risk_register.md` + RBAC/audit/masking summary; PII/SQLi review history (WP-API-01 caught + fixed pre-merge) |
| 6 | **Cutover-weekend runbook + proposed date** | `cutover_checklist.md` |
| 7 | **Rollback plan + rehearsal evidence** | `rollback_checklist.md` |
| 8 | **Hypercare plan (2 weeks)** | `support_hypercare_plan.md` |
| 9 | **Data-migration readiness** | `10_Data_Model/migration_execution_runbook.md` + extraction dry-run report |
| 10 | **Outstanding assumptions/risks carried** | `ASSUMPTION_REGISTER.md`, `migration_gap_register.md` |

## 3. The decision

| | Name | Date | Decision |
|---|---|---|---|
| Sponsor | | | ☐ GO · ☐ GO with waivers (listed) · ☐ NO-GO (conditions) |
| Ops Manager | | | endorse ☐ |
| Release Reviewer | | | pack complete + accurate ☐ |

**On GO:** record `20_Decisions/DEC-013_go_live.md`; proceed to `cutover_checklist.md` entry gate. **On waivers:** list each waived item + accepted risk + owner + revisit date. **On NO-GO:** record the blocking conditions; they become the next work list.

## 4. Retirement linkage (closes the loop)

Go-live starts the 30-day reconciliation clock. Legacy order-create retires only when ALL hold for 30 consecutive days (legacy_transition §8): 100% volume through new system · phase success criteria met · no open Critical/High · rollback rehearsed+documented · sign-off recorded. That retirement is its **own** DEC (`20_Decisions/`), separate from DEC-013 — go-live authorizes the cutover; retirement authorizes switching legacy off.

---

## Current standing (2026-06-14)

**Engineering:** ✅ build complete; restore drill done. **Blocking the gate:** MG-A1 (legacy access → real migration), the S2 workshop (validators/RBAC/settings/cutover date/ASM sign-off), MG-E6 (production env decision), and the run-once items that depend on them (UAT with real staff, pilot, Batch 1/2 apply). Engineering cannot self-clear any of these — they are the consolidated sponsor ask in `22_Meeting_Notes/SPONSOR_DECISION_PACK.md`. Everything engineering *can* prepare for go-live is prepared.
