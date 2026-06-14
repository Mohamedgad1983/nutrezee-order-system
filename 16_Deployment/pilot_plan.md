# Pilot Plan — Order-Ops Slice

**Date:** 2026-06-14 · **Status:** Ready; start date gated on UAT PASS + workshop values · **Owners:** Ops Manager (pilot lead), Migration Operator, Admin/SA
**Design source:** `13_Architecture/legacy_transition_architecture.md §6`, `19_Roadmap/phase_6_master_prompt.md` STEP 3, `13_Architecture/mvp_architecture_cut.md §7` (success criteria)
**Pairs with:** `15_Testing/uat_pack.md` (precedes pilot), `cutover_checklist.md` (follows pilot), `support_hypercare_plan.md`

> **Pilot = a controlled parallel run, not a cutover.** A minimal slice of real operations runs in the new system *alongside* legacy for ~2 weeks. Legacy stays the system of record; the pilot proves the new system handles real daily order work before any flag flips. The manual KPI sheet (ENH-QW-06) doubles as the cross-check. Exit review decides go/no-go for the cutover weekend.

---

## 1. Scope (deliberately minimal)

| Dimension | Pilot scope | Rationale |
|---|---|---|
| Agents | **1 intake agent** | smallest unit that produces real drafts |
| Kitchen | **1 kitchen section** | one section validates routing + prep without disrupting the floor |
| Reviewers | 1 Ops Manager | review + cancel + exception path |
| Finance | 1 Finance user | payment-review + refund path |
| Volume | a defined daily slice (e.g. N orders/day `[NC — OM sets]`) | bounded, recoverable |
| Duration | **2 weeks parallel** | enough to see weekday/weekend variation + the reconciliation ritual |
| System of record | **legacy** (pilot runs alongside, not instead) | zero business risk during pilot |

**Not in pilot:** dispatch/driver (Phase 4), full multi-section kitchen, marketing/finance-report parity (§1.6).

## 2. Entry gate (all before pilot day 1)

- ☐ UAT PASS recorded (`15_Testing/uat_execution_log.md`); TS-S 7/7 green on staging.
- ☐ Workshop values applied where they affect the pilot: `kitchen_cutoff_time`, mandatory intake fields, reason codes, the section's routing rule (MG-D1..D4) — or a documented placeholder with OM acceptance.
- ☐ Staging (or prod-like) seeded with pilot-representative catalog + customers (Batch 1+2 dry-run reviewed; ideally applied to the pilot environment).
- ☐ Pilot roster trained (§5) with sign-in recorded.
- ☐ P1 reconciliation owner named; daily ritual scheduled.
- ☐ Rollback rehearsed once (`rollback_checklist.md §Rehearsal`).
- ☐ Hypercare channel + on-call defined (`support_hypercare_plan.md`).

## 3. Schedule

| Day | Activity |
|---|---|
| D0 | Kickoff; confirm roster, environment, KPI sheet baseline; first agent login + smoke order |
| D1–D5 (week 1) | Agent enters the daily slice in **both** systems (or new + legacy reconciliation); OM reviews; kitchen section preps from the new board; Finance reviews payments; daily P1 reconciliation each evening |
| D5 | Week-1 checkpoint: defect triage, metric snapshot vs baseline, adjust |
| D6–D10 (week 2) | Continue; reduce double-entry where confidence allows; stress the cancel/change/exception paths at least once each |
| D10 | **Exit review** (§6) → go/no-go for cutover |

## 4. Success criteria (measured against the manual KPI baseline)

Per `mvp_architecture_cut.md §7` (9 MVP criteria). Pilot must demonstrate, with evidence:

- ☐ **Intake time ≤ legacy baseline** (per-order, agent-timed) `[NC baseline from KPI sheet]`.
- ☐ **Zero review-queue bypass** — every order passes through review (a new control legacy lacked).
- ☐ **Allergy safety chain intact** — the 1→7 chain fires on every flagged order (non-negotiable).
- ☐ **Reconciliation clean** — daily new-vs-legacy counts match (or every divergence explained + audited).
- ☐ **Kitchen day-list usable** — the section preps from the new board for every pilot fulfillment day.
- ☐ **Payment path correct** — Finance confirm/reject/refund all exercised, no auto-payment.
- ☐ **No order data loss** — every pilot order traceable end-to-end in audit (WF-16).
- ☐ **No open Critical/High defect** on the slice at exit.
- ☐ **Staff confidence** — pilot personas report they can run a full day unaided (training effective).

(Exact numeric thresholds for intake-time/volume are KPI-sheet-owned `[NC]`; capture them at D0 and judge at D10.)

## 5. Training (per persona — a go-live gate, MG-E4)

| Persona | Hands-on (on staging) | Quick-ref | Sign-in |
|---|---|---|---|
| Agent | create 10 drafts (incl. WhatsApp, allergy, incomplete), submit | 1-page intake card (EN/AR) | ☐ |
| OM | claim/approve/return/reject; cancel; resolve exception; merge | 1-page review card | ☐ |
| Kitchen | board: ticket → in-progress → prepared; shortage escalation | 1-page board card | ☐ |
| Finance | payment confirm/reject; refund request → review | 1-page payment card | ☐ |
| Admin | settings/masters; staff/RBAC; audit query | 1-page admin card | ☐ |

Each: hands-on session on staging + a one-page quick-reference (Arabic where the persona needs it) + a recorded sign-in. Materials drafted by engineering, delivered by OM.

## 6. Exit review (go/no-go for cutover)

- ☐ All §4 success criteria met (or explicitly waived with sponsor sign-off).
- ☐ Defect register: zero open Critical/High on the slice.
- ☐ Reconciliation clean for the back half of the pilot.
- ☐ Staff sign-off: personas confident to run unaided.
- ☐ Rollback rehearsed + documented.
- ☐ Decision recorded: **GO** → `cutover_checklist.md` entry gate; **NO-GO** → fix list + re-pilot scope.

## 7. Risks during pilot (watch)

| Risk (register) | Pilot mitigation |
|---|---|
| R9 shop-floor adoption | 1 agent + 1 section keeps blast radius tiny; daily check-ins; quick-ref cards |
| Double-entry fatigue | bounded daily slice; reduce in week 2 as confidence grows |
| Reconciliation drift | daily ritual with named owner; divergence triaged same day |
| Allergy-safety regression | TS-S allergy chain re-run on staging weekly; pilot watches every flagged order |

**Exit artifact:** the signed exit review + the pilot metric sheet are inputs to the go-live pack (`go_live_checklist.md`).
