# Cutover-Weekend Checklist (Order Intake Slice)

**Date:** 2026-06-14 · **Status:** Ready; execution date `[NC MG-D7 — workshop picks lowest-volume day]` · **Owners:** Migration Operator (data), Ops Manager (process), Admin/SA (flags), Finance (payments)
**Design source:** `10_Data_Model/migration_execution_plan.md §6`, `13_Architecture/legacy_transition_architecture.md §5/§9`, `10_Data_Model/migration_execution_runbook.md`
**Pairs with:** `rollback_checklist.md` (if any gate fails), `pilot_plan.md` (pilot precedes this), `go_live_checklist.md` (sign-off gate before this runs)

> **The cutover unit is the FulfillmentDay date** — no single delivery day may be half-in-each-system. Cutover happens on the lowest-volume day so the kitchen never reads two day-lists. Legacy `/orders/create` is retired **by policy** (and set read-only if the owner can); the new intake becomes the only path that generates kitchen day-lists, making bypass self-defeating.

---

## Entry gate (ALL must hold before T-7d — do not start otherwise)

- ☐ Go-live signed (`go_live_checklist.md` → DEC-013) — sponsor approval is a hard stop.
- ☐ Pilot exit-review passed (`pilot_plan.md §Exit`): ≥1 agent + 1 kitchen section ran in parallel, success criteria met.
- ☐ UAT PASS recorded (`15_Testing/uat_execution_log.md`); TS-S 7/7 green on staging; **zero open Critical/High** on the slice.
- ☐ Batch 1 (catalog) + Batch 2 (customers) **applied** on the target (production) environment; reconciliation P1 daily counts running clean.
- ☐ Legacy access (MG-A1) granted; calibration done; latest extraction dry-run 🟢.
- ☐ Production environment provisioned + restore drill proven there (MG-E6, `operations_runbook.md §Backup`).
- ☐ Staff trained per persona; P1 reconciliation owner named.
- ☐ Rollback rehearsed once on staging (retirement criterion 4); `rollback_checklist.md` printed and at hand.

## T-7d — Pre-stage

- ☐ Batch 1+2 applied; daily reconciliation counts clean for 7 consecutive days.
- ☐ Pilot agent live on staging/prod-like; manual KPI sheet (ENH-QW-06) doubling as cross-check.
- ☐ Confirm cutover date + time window with sponsor; notify all personas in writing.
- ☐ Freeze catalog content changes in legacy (or schedule a final refresh at T-1d).
- ☐ Dry-run Batch 3 on a snapshot → confirm DQ gates green (unresolved customers = 0 hard; package miss ≤1%).

## T-1d (Fri eve `[NC]`) — Freeze & delta

- ☐ Announce legacy order-entry freeze by policy notice (effective cutover time).
- ☐ Final Batch-2 customer **delta**: dry-run → review → apply (catch customers added since last batch).
- ☐ Catalog final refresh (if content changed): re-run mirror import; divergence reviewed.
- ☐ Verify production backup taken **immediately before** cutover (named, timestamped, restore-tested).
- ☐ Confirm cutover flags are currently OFF (`cutover_intake=false`); confirm `cutover_catalog` posture per plan.
- ☐ On-call roster confirmed for the window (operator, OM, Finance, an engineer).

## T-0 (cutover day `[NC]`) — Batch 3 + flip

Run **in order**, gate between each:
1. ☐ Batch 3 (active plans) **dry-run** → review report with OM (counts, held-back plans, finance-review count, days generated).
2. ☐ DQ gates green? unresolved customers **0** · package misses ≤1% · merge-review reviewed. **Red → STOP, go to rollback.**
3. ☐ Batch 3 **apply** (SA role + reviewed dry-run + `--apply`). Every created row: `origin=legacy`, `import_batch_id`, audit `bridge.import_run` HIGH.
4. ☐ **Spot-check N migrated plans** vs legacy screens (OM picks N≈10 across statuses/packages): order_number verbatim, status mapped (active→ACTIVE / pause→PAUSED), amounts, fulfillment days generated, off_days flagged unverified.
5. ☐ Finance reviews the migrated payment queue (unmapped payment-status rows → manual finance review, by design).
6. ☐ Pending legacy orders (not migrated) handed to agents to re-key via new intake as drafts.

### T-0 +2h — Intake cutover

- ☐ Flip `cutover_intake` **ON** (M16 cutover flag; Admin/SA). All new orders now created in the new system only.
- ☐ Legacy `/orders/create` retired-by-policy (read-only if owner can; else policy + reconciliation catches strays).
- ☐ First live new-system order created end-to-end (intake→review→approve→fulfillment day) as a smoke check.
- ☐ Kitchen reads the **new** system day-list for the next fulfillment date (single source confirmed).
- ☐ Announce cutover complete to all personas; hypercare begins (`support_hypercare_plan.md`).

## T+1 … T+30d — Reconciliation clock

- ☐ Daily P1 reconciliation: new-vs-legacy active-plan counts + stray-order check. Any order only-in-legacy after cutover → OM follow-up, audited.
- ☐ Daily: open Critical/High defect check on the slice (any → assess rollback).
- ☐ Weekly: hypercare review (`support_hypercare_plan.md`); divergence trend.
- ☐ Catalog refresh divergence → reconciliation WARN (reviewed, not blocking).

## T+30d — Retirement decision

- ☐ Retirement criteria (legacy_transition §8) — ALL hold for 30 consecutive days: 100% volume through new system (reconciliation clean) · phase success criteria met (intake time ≤ baseline; zero queue-bypass) · no open Critical/High · rollback rehearsed + documented · sign-off.
- ☐ Record legacy order-create retirement DEC in `20_Decisions/` (one DEC per retirement; satisfies BO-5 no-regression vs the 50-screen checklist).

---

## Cutover flags (M16) — quick reference

| Flag | Cutover step | Off → On effect |
|---|---|---|
| `cutover_catalog` | (pre-cutover, optional) | catalog write-path opens; until then catalog is import-only mirror |
| `cutover_intake` | T-0 +2h | new system becomes sole order-creation path; legacy create retired-by-policy |
| `cutover_kitchen` | Phase 3 (later) | board is system-generated day-list source |

## Abort / rollback triggers (any → `rollback_checklist.md`)

- Batch-3 DQ gate red (unresolved customers > 0, package miss > 1%).
- Spot-check reveals systemic mapping error (wrong status/amounts on multiple plans).
- New intake fails the smoke check or a Critical defect surfaces in the window.
- Kitchen cannot read the new day-list for the next fulfillment date.

**Rollback is cheap pre-business-write:** flag `cutover_intake` OFF → agents revert to legacy `/orders/create` (kept dormant-functional +30d); Batch-3 created rows deletable while no post-import business writes reference them; generated fulfillment days cancelled (no kitchen impact pre-cutover). Full procedure: `rollback_checklist.md`.
