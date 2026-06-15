# Support & Hypercare Plan

**Date:** 2026-06-14 · **Status:** Ready; activates at intake cutover (T-0 +2h) · **Owners:** Ops Manager (business support), on-call engineer (technical), Operator (infra)
**Design source:** `19_Roadmap/phase_6_master_prompt.md` (2-week hypercare), `13_Architecture/legacy_transition_architecture.md §6`
**Pairs with:** `operations_runbook.md` (the technical procedures), `rollback_checklist.md`, `cutover_checklist.md`

> **Hypercare = elevated, time-boxed support immediately after cutover.** For the first 2 weeks the order-ops slice gets daily attention, a named on-call, and a fast path from "staff hits a problem" to "fixed or rolled back." Legacy stays dormant-functional for +30 days as the safety net.

---

## 1. Coverage window

| Phase | Duration | Support level |
|---|---|---|
| **Hypercare** | cutover T-0 → T+14d | daily standups; on-call during operating hours; same-day defect triage |
| **Stabilization** | T+15d → T+30d | weekly review; on-call for SEV-1/2; reconciliation continues |
| **Steady-state** | T+30d onward | normal ops (`operations_runbook.md §1`); retirement decision taken |

## 2. Support roster & escalation

| Tier | Who | Handles | Reaches |
|---|---|---|---|
| **T1 — floor** | Ops Manager | staff "how do I…", workflow questions, data entry fixes | T2 if app misbehaves |
| **T2 — technical** | on-call engineer | app defects, errors, stuck queues | T3 for infra/data |
| **T3 — infra/data** | Operator | deploy/infra, DB, backup/restore, rollback execution | sponsor for go/no-go |

**Escalation rule:** SEV-1 (order-ops down / data-loss risk) → T2 + T3 + sponsor immediately. SEV-2 → T2 same-day. SEV-3 → logged, batched.

## 3. Daily hypercare checklist (T-0 → T+14d)

- ☐ Morning health + backup-freshness check (`operations_runbook.md §1`).
- ☐ P1 reconciliation: new-vs-legacy active-plan counts + stray-order list → OM works every stray.
- ☐ Queue depths (review, payment, exceptions) within normal; nothing stuck.
- ☐ Defect log reviewed; any Critical/High → assess rollback (`rollback_checklist.md §0`).
- ☐ 15-min standup: agent + OM + Finance + on-call — surface friction, decide fixes.
- ☐ Allergy-safety spot check: every flagged order in the day fired the warning chain.
- ☐ End-of-day: note status, open defects, reconciliation result.

## 4. Defect handling

| Severity | Response | Resolution target | Rollback? |
|---|---|---|---|
| SEV-1 | immediate | same day | yes if no safe forward-fix |
| SEV-2 | same day | ≤ 48h | only if blocking + no workaround |
| SEV-3 | logged | next release | no |

- All defects: file with WF id + severity + repro; link to the audit row.
- Forward-fix preferred during hypercare; rollback is the safety valve, not the default.
- Track in the run's defect register (`uat_execution_log.md` format reused for production).

## 5. Communication

- **Channel:** a dedicated hypercare channel (staff ↔ T1/T2) — `[NC set channel]`.
- **Daily summary** to sponsor during week 1 (status, defects, reconciliation).
- **Weekly review** during stabilization.
- **Incident comms:** SEV-1 → immediate notice to all personas + sponsor with ETA.

## 6. Staff support materials

- One-page quick-ref per persona (from `pilot_plan.md §5`), printed and at each station (EN/AR).
- "Who to call" card: T1/T2/T3 names + how to reach.
- Known-issues list kept current during hypercare (workarounds for open SEV-2/3).

## 7. Hypercare exit (→ steady-state)

- ☐ Zero open Critical/High on the slice.
- ☐ Reconciliation clean ≥ 7 consecutive days.
- ☐ Staff running unaided (T1 volume dropped to normal).
- ☐ On-call load back to baseline.
- ☐ Decision recorded: hypercare → steady-state; continue the 30-day reconciliation clock toward the retirement DEC.

**Exit feeds:** the retirement criteria (`cutover_checklist.md §T+30d`) and the legacy order-ops retirement decision.
