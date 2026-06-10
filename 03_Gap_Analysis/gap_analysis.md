# Phase 3 — Gap Analysis: Current State vs. Desired Future State

**Date:** 2026-06-10 · **Status:** Baseline v1.0
Severity scale: **Critical** = blocks safe operation or the whole program · **High** = major operational/financial/compliance impact · **Medium** = efficiency/quality impact · **Low** = polish/convenience.
Each gap maps to backlog requirements (BR-xxx) and feeds enhancements (ENH-xxx in `04_Enhancement_Blueprint/`).

## Severity summary

| Dimension | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Customer Experience | – | 2 | 2 | 1 | 5 |
| Order Management | 1 | 3 | 1 | – | 5 |
| Operations (Kitchen/Packing) | 1 | 3 | 1 | – | 5 |
| Delivery | – | 3 | 1 | – | 4 |
| Administration | – | 1 | 2 | 1 | 4 |
| Reporting | – | 1 | 2 | – | 3 |
| Analytics | – | 2 | 1 | – | 3 |
| Notifications | – | – | 3 | – | 3 |
| Automation | 1 | 2 | – | – | 3 |
| Scalability | – | 2 | 1 | – | 3 |
| Security | 2 | 3 | – | – | 5 |
| Data Quality | – | 3 | 1 | – | 4 |
| Auditability | 1 | 1 | 1 | – | 3 |
| AI Readiness | – | – | 2 | – | 2 |
| **Total** | **6** | **26** | **18** | **2** | **52** |

---

## 1. Customer Experience (CX)

| ID | Gap (current → future) | Refs | Severity |
|---|---|---|---|
| GAP-CX-01 | Customer repeats identity/address/allergies every order → profile reuse with phone matching | BR-006/007 | High |
| GAP-CX-02 | No order confirmation or delivery status communication → customer notifications | BR-035 | High |
| GAP-CX-03 | Allergy/diet preferences not systematically applied at intake → restriction flags in review | BR-039 | Medium |
| GAP-CX-04 | No self-service order/subscription visibility → customer orders view | Customer Orders module | Medium |
| GAP-CX-05 | Feedback (ratings/contact) disconnected from orders → linked feedback | Customer Feedback module | Low |

## 2. Order Management (OM)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-OM-01 | No draft/incomplete-order queue; orders enter system fully-formed or not at all → structured draft + review workflow | BR-001–005 | **Critical** |
| GAP-OM-02 | Order state machine undocumented; no delivered/completed state → explicit lifecycle with transition rules and side effects | DEC-005, BR-036 | High |
| GAP-OM-03 | Change requests/pauses/substitutions hand-applied without downstream propagation → managed changes updating kitchen/labels/dispatch | BR-005/037 | High |
| GAP-OM-04 | No exception handling across the chain → exception management | BR-042 | High |
| GAP-OM-05 | Birthday-order handling is a standalone list with unknown rules → confirmed rule or retirement | Workshop Q | Medium |

## 3. Operations — Kitchen & Packing (OPS)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-OPS-01 | No item→section routing or task decomposition; sections coordinated verbally → section master + routing rules + generated tasks | BR-009–011 | **Critical** |
| GAP-OPS-02 | Chef assignment informal → chef-section-shift mapping + scoped task app | BR-012–014 | High |
| GAP-OPS-03 | Manual handwritten labels → auto-generated labels from order/meal/route data | BR-016–018 | High |
| GAP-OPS-04 | No packing checklist or recorded kitchen→packing→dispatch handoff → checklist gated on task completion + handoff events | BR-019/022 | High |
| GAP-OPS-05 | Shortage/substitution escalation undefined → kitchen exception reporting | BR-015 | Medium |

## 4. Delivery (DEL)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-DEL-01 | Manual driver assignment; auto-assign route unsafe → dispatch board with area/slot/capacity rules and overrides | BR-020–022 | High |
| GAP-DEL-02 | No driver capacity enforcement → capacity model (unit per DEC-008) | BR-021 | High |
| GAP-DEL-03 | No driver app / status capture / failure reasons → driver app with status workflow | BR-023/024 | High |
| GAP-DEL-04 | Delivery areas undefined in system → areas & zones configuration | BR-044 | Medium |

## 5. Administration (ADM)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-ADM-01 | Ambiguous user creation (staff vs customer), duplicate risk → guided creation + duplicate detection | Step 2B Replace #6 | High |
| GAP-ADM-02 | Settings lack validation/scoping/audit → audited business settings | BR-044 | Medium |
| GAP-ADM-03 | Static/legal content lacks versioning/effective dates → versioned legal content | Module 10 analysis | Medium |
| GAP-ADM-04 | Hidden/orphan video modules of unknown business value → confirm or retire | Workshop Q | Low |

## 6. Reporting (REP)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-REP-01 | Report summary route unstable; daily planning views time out → reliable analytics hub | Step 2B Replace #4–5 | High |
| GAP-REP-02 | No exportable, role-gated reports → exports with RBAC | BR-031 | Medium |
| GAP-REP-03 | Expiration/renewal reporting not actionable → renewal pipeline view | BR-036 | Medium |

## 7. Analytics (ANA)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-ANA-01 | No kitchen throughput / chef productivity metrics → kitchen analytics | BR-026 | High |
| GAP-ANA-02 | No delivery performance metrics → delivery analytics | BR-027 | High |
| GAP-ANA-03 | Revenue not analyzable by channel/cohort → finance analytics | BR-028 | Medium |

## 8. Notifications (NOT)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-NOT-01 | Push broadcasts with no templates/approval/history → notification center with templates + audit | BR-034/035 | Medium |
| GAP-NOT-02 | No internal alerting (missing data, kitchen exceptions, dispatch issues) → internal notifications | BR-034 | Medium |
| GAP-NOT-03 | Customer comms ad-hoc via personal WhatsApp → templated customer messaging | BR-035 | Medium |

## 9. Automation (AUT)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-AUT-01 | WhatsApp intake fully manual → structured intake (manual-assisted first, API per DEC-002) | BR-001–003 | **Critical** |
| GAP-AUT-02 | Order→kitchen→label→dispatch chain has zero automation → event-driven task/label/dispatch generation | BR-010/016/020 | High |
| GAP-AUT-03 | Renewal/expiry handling manual → lifecycle automation with off-days/pause/renewal | BR-036 | High |

## 10. Scalability (SCA)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-SCA-01 | Intake throughput limited by staff typing speed → structured intake + profile reuse | BR-001–007 | High |
| GAP-SCA-02 | No staging/CI/tests/rollback observed → environments + pipeline before change | SO-1 | High |
| GAP-SCA-03 | Unknown DB/queries; several routes already time out under read load → performance baseline after access | DEC-011 | Medium |

## 11. Security (SEC)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-SEC-01 | No RBAC; full admin visibility of PII/payment/health data → 10-role least-privilege model + field-level privacy | BR-032/043 | **Critical** |
| GAP-SEC-02 | Mutating action exposed as GET (`AutoAssignMealToDrivers`) → remove/POST+confirm+authz | Quick win | **Critical** |
| GAP-SEC-03 | SQL/framework exceptions leaked on 2 routes → error handling hardening | Quick win | High |
| GAP-SEC-04 | No visible logout / session controls → session management | Quick win | High |
| GAP-SEC-05 | Integration secrets handling unknown; discovery creds in local `.env` only → secrets management standard | SO-5 | High |

## 12. Data Quality (DQ)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-DQ-01 | Duplicate customers from repeated manual entry → phone-keyed identity + dedup (DEC-004) | BR-006 | High |
| GAP-DQ-02 | No structured nutrition data (calories/macros possibly embedded in names) → nutrition facts model | BR-038 | High |
| GAP-DQ-03 | Order data incomplete/unvalidated at entry → field validation + incomplete queue | BR-003 | High |
| GAP-DQ-04 | Bilingual content consistency unmanaged → language-variant validation | BR-008 | Medium |

## 13. Auditability (AUD)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-AUD-01 | No audit log of order/payment/settings/permission changes → audit event catalog + immutable log | BR-033 | **Critical** |
| GAP-AUD-02 | Payment confirmation/refunds untraceable → audited payment review queue | BR-030 | High |
| GAP-AUD-03 | Data exports/views of sensitive data unrecorded → access/export logging | BR-043 | Medium |

## 14. AI Readiness (AI)

| ID | Gap | Refs | Severity |
|---|---|---|---|
| GAP-AI-01 | No structured event/history data (orders, kitchen timings, deliveries) to train/ground AI features → event backbone + retained history | Phase 5 prerequisite | Medium |
| GAP-AI-02 | WhatsApp messages unparsed and unstored → consented message capture with structured extraction targets | DEC-002, BR-002 | Medium |

---

## Reading the register

- **The 6 Critical gaps** (OM-01, OPS-01, AUT-01, SEC-01, SEC-02, AUD-01) define Phase 0–2 of the roadmap. Nothing else should ship before them except quick-win remediations.
- Gaps marked with DEC-xxx cannot be specified until that decision is made — they are workshop blockers, not build blockers.
- This register supersedes `step_1_initial_gap_analysis.md` as the working gap list; the original remains the discovery record.
