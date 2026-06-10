# Phase 4D — Migration Execution Plan

**Date:** 2026-06-11 · **Status:** Proposed — executable design for M19 tooling; **no import has been run**. Field mappings inherit `migration_mapping.md` (screen-evidenced [V] only; legacy internals TBD-pending-access). Scope locked: **catalog → customers → active plans** (ADR-010, DEC-012 [NC detail]).

## 1. Batch runner behavior (M19 BatchRunner)

1. Every run creates `import_batch` (state=dry_run by default). **Apply requires:** a reviewed dry-run of the same source snapshot + explicit `--apply` + SA role + data-quality gates green (§4).
2. Idempotency: each source row resolves through `sync_record(object_type, legacy_key)` — existing mapping ⇒ action=matched (no-op or refresh per type); re-running an applied batch is a no-op.
3. Every row → `import_row_result` (created / matched / merge_review / skipped / error + messages). Nothing silently dropped (migration_mapping rule 3).
4. All created rows: origin=legacy, import_batch_id; audit bridge.import_run (HIGH on apply).
5. Source formats: CSV/export files at bridge pattern P1/P2; direct read at P3 [NC access]. Parser per type isolated so source format changes don't touch mapping logic.

## 2. Batch step lists

### Batch 1 — Catalog (first; everything depends on it)
1. Parse masters: meal types, diet status, tags, package-for, ingredients, allergens → name-keyed match-or-create.
2. Products: names EN/AR, price → bigint minor units; link ingredients/allergens where evidenced [NC depth]; **no macros imported** (GAP-DQ-02 — content work later).
3. Packages: parent_package_ref from "sub-package" evidence (C7 [I]); cycle check enforced.
4. Slots/methods → M16 tables.
5. Refresh mode (weekly until catalog cutover): snapshot_hash compare → changed rows re-mirrored; divergence count → reconciliation WARN.

### Batch 2 — Customers (depends: diet status master)
1. Normalize phone → §1.2 idempotency check → exact-phone match → `matched`.
2. New: create customer (+A1 email, dob, names) + customer_phone(is_primary) + import_notes for unmapped fields.
3. No phone / unparseable → name+dob fuzzy → `merge_review` (queued to Ops via M04 merge-review UI; **never auto-merged**).
4. In-batch duplicates (same phone twice): first wins, rest merge_review.
5. Addresses: only if exported data includes them [NC] — else customers import address-less; intake fills on first contact (acceptable: WF-01 step 1 loads profile and adds address).

### Batch 3 — Active plans (depends: 1+2 applied; runs at cutover weekend)
1. Filter: legacy status ∈ {active, pause} only (mapping table in migration_mapping §3). Pending → manual re-key via new intake; expired/cancelled/closed → not migrated (history stays legacy read-only).
2. Resolve customer (via batch-2 sync_record) — unresolved ⇒ row error, plan held back, listed for manual fix.
3. Resolve package by name — miss ⇒ error.
4. Create customer_order: order_number preserved verbatim; status mapped (active→ACTIVE, pause→PAUSED); off_days=∅ + **off_days_unverified=true (A2)**; amounts → minor units.
5. Freeze order_items from package composition as-known [NC item-level legacy data — if absent, single package-line item with name_frozen, flagged `item_detail_unverified`].
6. Generate fulfillment_days: import_date→end_date as SCHEDULED (PAUSED plans: SKIPPED until resume); **no past days fabricated**.
7. payment_record: status per placeholder vocab map [NC]; unmapped values → status=unpaid + evidence_note=legacy value + finance review queue item (finance absorbs ambiguity — by design).

## 3. Validation reports (per batch, from import_row_result)

Counts by action · error list with row context · merge-review queue size + sample · field-coverage stats (how many rows had dob/email/phone) · for batch 3: plans held back + finance-review count + days generated. Reports retained as files + bridge.import_run audit refs; reviewed with Ops before apply.

## 4. Data-quality gates (block apply when red)

| Gate | Threshold [Proposed] | On red |
|---|---|---|
| Customer merge_review rate | ≤ 10% of rows | Stop; sample-review with Ops; adjust normalization; re-dry-run |
| Customer error rate | ≤ 2% | Stop; parser/mapping fix |
| Batch-3 unresolved customers | 0 (hard) | Fix batch 2 first |
| Batch-3 package misses | ≤ 1% | Manual mapping table addition |
| Catalog refresh divergence post-cutover-prep | reviewed, not blocking | Reconciliation WARN |

## 5. Rollback

- `import_batch.state → rolled_back`: deletes **created** rows of that batch (matched rows untouched; merges undone only via MergeRecord undo window) — valid only while no post-import business writes reference them (checked via FK + updated_at scan); otherwise produces a manual-review list instead of deleting.
- Batch 3 rollback additionally cancels generated fulfillment_days (no kitchen impact pre-cutover by definition).
- Dry-run artifacts are never rolled back (no writes).

## 6. Cutover-weekend runbook skeleton (ties legacy_transition §5/§9)

| Step | When [NC — lowest-volume day, workshop] | Action |
|---|---|---|
| T-7d | — | Batch 1+2 applied; reconciliation P1 daily counts running; staff trained; pilot agent live on staging |
| T-1d | Fri eve [NC] | Freeze legacy order entry by policy notice; final batch-2 delta dry-run+apply |
| T-0 | Sat [NC] | Batch 3 dry-run → gates → apply; spot-check N plans vs legacy screens; finance reviews payment queue |
| T-0 +2h | | Cutover flag `intake` ON; agents create all new orders in new system; legacy `/orders/create` retired-by-policy |
| T+1…30d | Daily | P1 reconciliation: new-vs-legacy active-plan counts + stray-order check; divergence ⇒ Ops follow-up (audited) |
| T+30d | | Retirement criteria check (legacy_transition §8) → retirement DEC for legacy order-create |

## 7. NC register for this plan

Legacy payment-status vocabulary · off_days source · address/item-level data availability · export format (pattern P1/P2/P3 by access) · cutover day choice · merge-review threshold sign-off · currency code default. Each blocks **apply**, none blocks **building** the tooling (WP-06).
