# Rollback Checklist — Cutover & Per-Slice

**Date:** 2026-06-14 · **Status:** Ready; **must be rehearsed once on staging before go-live** (retirement criterion 4, MG-E1-adjacent) · **Owners:** Admin/SA (flags), Migration Operator (data), Ops Manager (process)
**Design source:** `13_Architecture/legacy_transition_architecture.md §7`, `10_Data_Model/migration_execution_plan.md §5`
**Pairs with:** `cutover_checklist.md` (abort triggers point here), `operations_runbook.md` (incident handling)

> **Core principle (R5, ADR-002).** Every cutover is reversible by a flag, and legacy is kept **dormant-functional** for +30 days after each slice cutover. Rollback is *cheap before any post-cutover business write* and gets a manual-review path after. Legacy is never modified by the new system, so reverting to it is always possible. Decide fast: the longer new-system business writes accumulate, the more rollback shifts from "delete created rows" to "manual reconciliation."

---

## 0. Decide: do we roll back? (Ops Manager call, ≤15 min)

| Signal | Severity | Action |
|---|---|---|
| Batch-3 DQ gate red (pre-apply) | — | **No rollback needed** — just don't apply; fix and re-dry-run |
| Batch-3 applied, spot-check shows systemic mapping error | High | Roll back Batch 3 (§2) |
| `cutover_intake` ON, Critical defect in new intake | Critical | Roll back intake flag (§1) immediately |
| Kitchen cannot read new day-list | Critical | Roll back intake flag (§1); kitchen reverts to legacy practice |
| Isolated Med/Low defect, workaround exists | Med/Low | **Do not roll back** — log defect, hotfix forward, continue hypercare |

**Rule:** roll back for Critical/High with no safe forward fix. Don't roll back for cosmetic or single-record issues — that's what hypercare + forward-fix is for.

## 1. Intake-slice rollback (the cutover flag) — fastest path

- ☐ Admin/SA: flip `cutover_intake` **OFF** (M16). New-order creation reverts to legacy `/orders/create` (dormant-functional, kept +30d).
- ☐ Announce to all agents: revert to legacy intake immediately; stop creating orders in the new system.
- ☐ New-system drafts already created are **preserved** (not deleted) — they remain for re-processing after re-cutover.
- ☐ Kitchen: day-lists regenerable from legacy practice (manual) for the affected fulfillment date.
- ☐ OM: run a reconciliation snapshot — list any orders created in the new system during the window so they can be re-keyed in legacy if the fulfillment date falls before re-cutover.
- ☐ Record the rollback as an audited event + a dated note in `20_Decisions/`.

**This step alone restores the pre-cutover operating state.** Data rollback (§2) is only needed if migrated rows are wrong; the flag flip is independent and instant.

## 2. Batch data rollback (M19 `import_batch.state → rolled_back`)

Per batch, **newest first** (Batch 3 before 2 before 1):

- ☐ Confirm no post-import business writes reference the batch's created rows (FK + `updated_at` scan — the runner checks this).
  - **Clean** → set `import_batch.state = rolled_back`: deletes only the **created** rows of that batch. `matched` rows untouched. Merges undone only via the MergeRecord undo window.
  - **Dirty** (business writes exist) → the runner produces a **manual-review list** instead of deleting. OM works the list by hand; do not force-delete.
- ☐ Batch 3 additionally: cancel the generated fulfillment_days (no kitchen impact pre-cutover by definition).
- ☐ Dry-run artifacts are **never** rolled back (they wrote nothing).
- ☐ Verify counts post-rollback: reconciliation report returns to pre-batch baseline.

## 3. Per-slice rollback reference (later phases)

| Slice | Rollback action | Data safety |
|---|---|---|
| **Intake/review (Phase 2 — this cutover)** | flag off → legacy `/orders/create` (dormant +30d) | drafts preserved; day-lists regenerable from legacy (manual) |
| Kitchen routing (Phase 3) | board off → printed M03 day-list (degraded) or manual practice | tickets are derived — no loss |
| Dispatch (Phase 4) | board off → manual assignment | driver app optional during ramp |
| Reports (Phase 5) | keep using legacy reports until parity sign-off | reference-only, no rollback needed |
| Foundation (RBAC/audit) | **no rollback** — additive, no legacy dependency | — |

## 4. Post-rollback (always)

- ☐ Root-cause the trigger; file defect(s) with severity; assign owner.
- ☐ Update `cutover_checklist.md` entry-gate if a gate let a defect through.
- ☐ Re-plan: fix → re-rehearse on staging → re-attempt cutover only after the trigger class is closed.
- ☐ Communicate status to sponsor + all personas; record the decision and timeline in `20_Decisions/`.
- ☐ Keep the rollback evidence (counts, audit refs, manual-review lists) for the go-live pack.

---

## Rehearsal record (do before go-live — proves criterion 4)

| Item | Date | By | Result |
|---|---|---|---|
| Intake flag off→on→off on staging | ☐ | | |
| Batch-3 rollback (clean) on staging | ☐ | | |
| Batch-3 rollback (dirty → manual-review list) on staging | ☐ | | |
| Reconciliation returns to baseline after rollback | ☐ | | |

**Until every row above is recorded, cutover entry-gate "rollback rehearsed" stays unchecked.**
