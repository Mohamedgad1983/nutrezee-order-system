# Migration Execution Runbook (operational)

**Date:** 2026-06-14 · **Status:** Ready to execute on MG-A1 (legacy access) · **Owner:** Migration Operator + Ops Manager
**Design source (do not duplicate, follow):** `migration_execution_plan.md` (batch design, gates, rollback), `migration_mapping.md` (field-level mapping), `13_Architecture/legacy_transition_architecture.md` (strangler model)
**This file = the runnable layer:** the exact command-by-command sequence from "legacy access granted" to "real plans reconciled," tying the read-only extraction toolkit (`tools/legacy-migration/`) to the new system's M19 import flow.

> **Two-tool boundary (never violate).** The **extraction toolkit** is read-only and stops at import-ready files — it never writes to legacy or new. The **M19 import flow** is the *only* path that writes to the new system, and only via `dry-run → human review → apply` with data-quality gates. Calibration playbook: `migration_entity_calibration_playbook.md`. Gaps: `migration_gap_register.md`.

---

## Phase 0 — Pre-conditions (gate before any extraction)

| Check | Source | Must be |
|---|---|---|
| Legacy access granted (MG-A1) | sponsor env vars | ✅ present |
| Bridge pattern chosen (MG-A2: P1/P2/P3) | ADR-008 addendum | ✅ recorded |
| Staging DB backed up (restore drill proven) | `operations_runbook.md §Backup` | ✅ (drill done 2026-06-14) |
| New-system compare account (MG-A4) | operator | ✅ read-scoped login |
| Toolkit unit tests green | `cd tools/legacy-migration && npm test` | ✅ 23/23 |
| Entities calibrated | calibration playbook §4 tracker | ✅ Batch-1+2 entities min |

If any row is ❌ → stop, record the blocker in `migration_gap_register.md`, do not improvise.

## Phase 1 — Extract (read-only, repeatable)

```bash
cd tools/legacy-migration
export LEGACY_BASE_URL=… LEGACY_ADMIN_EMAIL=… LEGACY_ADMIN_PASSWORD=…
export NEW_STAGING_URL=https://13-140-159-201.sslip.io NEW_ADMIN_EMAIL=… NEW_ADMIN_PASSWORD=…
npm run legacy:migration:dry-run          # extract → normalize → compare → report (read-only)
```
- Output lands in `migration-output/<timestamp>/` (gitignored — extracted PII is never committed).
- Login runs in auth-only mode, then switches to strict read-only; uncalibrated entities are skipped.
- **Evidence to keep:** `run-manifest.json` + the three reports (copy the reports — not the raw data — into the migration ticket for the Ops review).

## Phase 2 — Review the dry-run reports (human, with Ops)

Read in this order (`tools/legacy-migration/README.md §6`):
1. **extraction-summary.md** — row counts per entity match the legacy screens? Any `NEEDS_MANUAL_REVIEW` bucket? Resolve/triage each before import — they are **never** auto-imported.
2. **legacy-vs-new-coverage.md** — `only-in-legacy` = import candidates; `only-in-new` = drift to explain; "new requires (legacy lacks)" = fields to fill manually or accept-as-degraded (MG-C3..C5).
3. **migration-readiness-report.md** — overall verdict. Proceed to import only at 🟢 (access + calibration + zero unresolved review rows).

**Decision gate:** Ops Manager signs the dry-run review (counts acceptable, review rows triaged) before any M19 apply. No sign → no apply.

## Phase 3 — Feed import-ready files into M19 (dry-run first, always)

The toolkit's `normalized/<entity>.json` are the import inputs. The M19 flow:
```
POST /imports/<batch>/dry-run     # creates import_batch (state=dry_run); per-row import_row_result
   → review the JSON report       # counts: created/matched/merge_review/skipped/error
POST /imports/<id>/apply          # requires: reviewed dry-run + --apply + SA role + DQ gates green
```
Run **in batch order** (each batch depends on the prior):

### Batch 1 — Catalog (first; everything depends on it)
- Masters (meal types, diet status, tags, package-for, ingredients, allergens) → name-keyed match-or-create.
- Products (names EN/AR, price→minor units; **no macros** — content later). Packages (parent_package_ref; cycle-check). Slots/methods → M16.
- Mode: catalog stays **mirror/refresh** until `cutover_catalog` flips. Weekly re-run = refresh (snapshot_hash drift → reconciliation WARN).

### Batch 2 — Customers (depends: diet-status master)
- Phone-normalize → exact match = `matched`; novel = `created`; no/unparseable phone → `merge_review` (queued to Ops via M04 merge-review UI — **never auto-merged**).
- **DQ gates (block apply when red):** merge_review ≤10%, error ≤2%. Red → stop, sample-review with Ops, tune normalization, re-dry-run.

### Batch 3 — Active plans (depends: 1+2 applied; runs at cutover weekend)
- Scope filter: legacy status ∈ {active, pause} only. Pending → re-key via new intake; expired/cancelled/closed → not migrated (history stays legacy).
- Resolve customer (via Batch-2 sync_record) — unresolved ⇒ **row error, plan held back** (hard gate: 0 unresolved). Resolve package by name — miss ⇒ error (≤1% gate).
- Create customer_order (order_number verbatim; status active→ACTIVE / pause→PAUSED; amounts→minor units; `off_days_unverified=true` MG-C3). Freeze order_items from package composition (or single frozen line + `item_detail_unverified` MG-C4). Generate fulfillment_days import_date→end_date as SCHEDULED (PAUSED→SKIPPED); **no past days fabricated**. payment_record per vocab map (MG-C2); unmapped → unpaid + finance-review queue item.

## Phase 4 — Apply (only after green dry-run + Ops sign + DQ gates)

- Apply each batch only when its dry-run is reviewed and its DQ gates are green.
- Every created row: `origin=legacy`, `import_batch_id`, audit `bridge.import_run` (HIGH severity on apply).
- Idempotent: re-running an applied batch is a no-op (sync_record by legacy_key).
- **Rollback if needed:** `import_batch.state → rolled_back` deletes only *created* rows of that batch (matched untouched; merges undone via MergeRecord undo window) — valid only while no post-import business writes reference them (FK + updated_at scan); else produces a manual-review list. Batch-3 rollback also cancels generated fulfillment_days (no kitchen impact pre-cutover). See `cutover_checklist.md` and `rollback_checklist.md`.

## Phase 5 — Reconcile (the 30-day clock)

- P1 reconciliation ritual: daily new-vs-legacy active-plan counts + stray-order check (legacy `/orders/create` retired-by-policy at cutover — any order appearing only in legacy → Ops follow-up, audited).
- Catalog refresh divergence → reconciliation WARN (reviewed, not blocking).
- Retirement criteria (legacy_transition §8): all 5 hold for 30 consecutive days → legacy order-ops retirement DEC in `20_Decisions/`.

---

## Command quick-reference

```bash
# read-only extraction toolkit (tools/legacy-migration)
npm test                              # 23/23 — proves normalizers/comparators/safety
npm run legacy:migration:dry-run      # full read-only pipeline (default)
npm run legacy:migration:extract      # extraction only
npm run legacy:migration:compare      # comparison only
npm run typecheck

# new-system import (M19, the only write path)
POST /imports/catalog/dry-run     → review → POST /imports/<id>/apply
POST /imports/customers/dry-run   → review → POST /imports/<id>/apply
POST /imports/active-plans/dry-run→ review → POST /imports/<id>/apply   # cutover weekend
```

## What still blocks a real run (live map)

| Blocker | Gap id | Owner |
|---|---|---|
| Legacy credentials + bridge pattern | MG-A1, MG-A2 | sponsor |
| Entity calibration (needs the above) | MG-B1..B12 | operator (after S1) |
| Payment-status vocabulary, off_days, item-level, currency | MG-C2..C4, C8 | sponsor/first-export |
| Cutover day choice | MG-D7 | workshop |

Everything else — the toolkit, the M19 flow, the gates, the rollback, the reconciliation ritual — is **built and tested**. The runbook waits on inputs, not on engineering. Consolidated ask: `22_Meeting_Notes/SPONSOR_DECISION_PACK.md`.
