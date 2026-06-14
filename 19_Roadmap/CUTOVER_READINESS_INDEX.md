# Cutover Readiness Index & Scorecard

**Date:** 2026-06-14 · **Status:** Living · **Owner:** Planner · **Goal:** replace the legacy daily order operation
**What this is:** the single map of every cutover-readiness deliverable + a green/amber/red scorecard of where the project stands. Built in GOAL MODE (2026-06-14) to consolidate migration / UAT / pilot / production readiness into one navigable index. The next session reads this to know exactly what's ready and what's gated.

> **Bottom line:** every deliverable engineering can produce **without external input is produced.** The project is blocked on exactly two sponsor gates — **S1 (legacy access)** and **S2 (workshop)** — plus a production-env decision (S3). All four are consolidated in `22_Meeting_Notes/SPONSOR_DECISION_PACK.md`.

---

## Readiness scorecard

Legend: 🟢 ready/done · 🟡 ready, awaiting an external input to execute · 🔴 blocked on sponsor.

### A. Legacy migration readiness
| Item | State | Deliverable |
|---|---|---|
| Migration machinery (toolkit + M19 + reconciliation) | 🟢 built + tested (23/23) | `tools/legacy-migration/`, `app/.../m19-migration` |
| Extraction validated (pre-access) | 🟢 done | `tools/legacy-migration/reports/extraction-validation-record.md` |
| Entity calibration | 🟡 playbook ready, awaits S1 | `10_Data_Model/migration_entity_calibration_playbook.md` |
| Legacy-vs-staging comparison | 🟡 method ready, awaits S1 | `migration_execution_runbook.md §5`, toolkit comparators |
| Migration gaps identified | 🟢 consolidated | `10_Data_Model/migration_gap_register.md` |
| Migration execution plan/runbook | 🟢 ready | `10_Data_Model/migration_execution_plan.md` + `migration_execution_runbook.md` |
| Real Batch 1/2/3 apply | 🔴 needs S1 | (runbook ready to execute) |

### B. UAT readiness
| Item | State | Deliverable |
|---|---|---|
| Demo data seeded | 🟢 done | staging (memory `staging-uat-seed-data`) |
| Critical-workflow validation (automated) | 🟢 e2e suite green | `tools/e2e-staging/*.spec.ts` (15) |
| UAT pack (WF-01..16) | 🟢 ready | `15_Testing/uat_pack.md` |
| UAT execution log | 🟢 template ready | `15_Testing/uat_execution_log.md` |
| UAT with real staff + real values | 🟡 awaits S2 values + roster | (pack runnable with placeholders now) |
| TS-S 7/7 on staging | 🟡 awaits seed/values | `test_strategy.md` (MG-E2) |

### C. Pilot readiness
| Item | State | Deliverable |
|---|---|---|
| Cutover checklist | 🟢 ready | `16_Deployment/cutover_checklist.md` |
| Rollback checklist | 🟢 ready (rehearse before go-live) | `16_Deployment/rollback_checklist.md` |
| Pilot plan + checklist | 🟢 ready | `16_Deployment/pilot_plan.md` |
| Training per persona | 🟡 plan ready, awaits delivery | `pilot_plan.md §5` (MG-E4) |
| Pilot run | 🟡 awaits UAT pass + values | (entry gate defined) |

### D. Production readiness
| Item | State | Deliverable |
|---|---|---|
| Operations runbook | 🟢 ready | `16_Deployment/operations_runbook.md` |
| Backup/restore | 🟢 drill proven 2026-06-14 | `operations_runbook.md §3` (MG-E1 closed) |
| Monitoring/alerting | 🟡 manual now; wire before go-live | `operations_runbook.md §2` (MG-E7) |
| Perf baseline | 🟡 app-tier done; DB/authed/load pending | `16_Deployment/perf_baseline.md` (MG-E3) |
| Support/hypercare plan | 🟢 ready | `16_Deployment/support_hypercare_plan.md` |
| Go-live checklist + DEC-013 pack | 🟢 template ready | `16_Deployment/go_live_checklist.md` |
| Production environment | 🔴 needs S3 decision | `environment_plan.md §1` (MG-E6) |

### Gates
| Gate | State | Where |
|---|---|---|
| S1 legacy access | 🔴 | `SPONSOR_DECISION_PACK.md §S1` |
| S2 workshop | 🔴 | `SPONSOR_DECISION_PACK.md §S2` |
| S3 production env | 🔴 | `SPONSOR_DECISION_PACK.md §S3` |
| S4 CI billing | 🔴 (hygiene) | `SPONSOR_DECISION_PACK.md §S4` |

---

## Deliverable map (where everything lives)

| Objective | Documents |
|---|---|
| **A. Migration** | `10_Data_Model/`: `migration_gap_register.md`, `migration_entity_calibration_playbook.md`, `migration_execution_runbook.md`, `migration_execution_plan.md`, `migration_mapping.md` · `tools/legacy-migration/reports/extraction-validation-record.md` |
| **B. UAT** | `15_Testing/`: `uat_pack.md`, `uat_execution_log.md`, `test_strategy.md` · `tools/e2e-staging/` |
| **C. Pilot** | `16_Deployment/`: `cutover_checklist.md`, `rollback_checklist.md`, `pilot_plan.md` |
| **D. Production** | `16_Deployment/`: `operations_runbook.md`, `support_hypercare_plan.md`, `go_live_checklist.md`, `perf_baseline.md`, `environment_plan.md`, `staging_provisioning_checklist.md` |
| **Sponsor** | `22_Meeting_Notes/`: `SPONSOR_DECISION_PACK.md`, `sponsor_review_package_unresolved_business_questions.md`, `verification_workshop_agenda.md` |
| **Tie-back** | `19_Roadmap/`: this file, `Legacy_Core_Gap_To_Cutover.md`, `NEXT_ACTION_QUEUE.md`, `build_progress_register.md` |

## The critical path to legacy retirement

```
SPONSOR: S1 access + S2 workshop  (+ S3 prod env in parallel)
   │
   ▼
calibrate entities ─► extraction dry-run 🟢 ─► review w/ Ops ─► Batch 1+2 apply
   │
   ▼
UAT with real staff + values ─► TS-S 7/7 ─► pilot (1 agent + 1 section, 2 wks) ─► exit GO
   │
   ▼
GO-LIVE sign-off (DEC-013) ─► cutover weekend (Batch 3 + intake flag ON) ─► hypercare (2 wks)
   │
   ▼
30-day reconciliation clock clean ─► legacy order-ops retirement DEC ─► DONE (goal met)
```

**Engineering's part of this path is complete or executable-on-input at every step.** The schedule is set by S1 + S2, not by remaining build work.
