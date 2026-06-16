# Import Results

Date: 2026-06-16

Status: `NO_IMPORT_THIS_SESSION` — reconciling a **prior** import.

## This session

`MIGRATION_APPLY` is unset (defaults false) and the source/target are read-only via the `nutrezee-vps` MCP. **No rows were imported, updated, or deleted in this session.** All actions were read-only SELECTs against staging.

## The prior import being reconciled

The legacy → staging load was executed on **2026-06-14/15** by on-VPS scripts under `/opt/nutrezee/`:

- `import-orchestrator.mjs`, `import-history.mjs`, `import-plans.mjs`, `address-import.mjs`
- These authenticate to the staging API as the staging admin and POST to the **governed M19 endpoint** `POST /imports/active_plans/{dry-run|apply}` — i.e. they used the application's import path (idempotent upsert, audit, single-write-path), not raw SQL. One follow-up data-cleanup (`/opt/nutrezee/reconcile.sql`) relinked legacy orders to catalog packages by normalized name and set Arabic names / area English names (a bounded, reviewed UPDATE in one transaction).

### Recorded import outcome (`import_row_result`, all batches)

| action | rows |
| --- | ---: |
| created | 97,784 |
| matched | 4,343 |
| error | **1,732** |
| merge_review | **93** |

### Per-entity landed in staging (origin='legacy')

| Entity | Rows |
| --- | ---: |
| customer | 19,379 |
| customer_order | 19,465 |
| customer_phone | 19,287 (total) |
| address | 9,506 |
| payment_record | 11,257 |
| order_item | 1 (seed only — **legacy line items not imported**) |
| package | 7 legacy (+2 seed) |
| delivery_method | 1 |
| product | 2 |
| area | 127 |

### Known import incidents

1. **Customer apply halted on the merge-review gate.** `…/2026-06-14T13-29-40-368Z/import-log-apply.jsonl` ends with `{"type":"customer","chunk":40,"STOP":"merge_review>gate", ...}`. The merge-review safety gate (correctly) stopped the apply rather than auto-merging ambiguous duplicates. Result: **772 customers short** of the 20,151 extracted, pending manual merge resolution.
2. **1,732 error rows + 93 merge_review rows** were excluded and never re-applied.
3. **Order line items and per-order delivery data were never imported** because the source detail pages were not extracted (source-coverage gap, not an import failure).
4. **`import_batch` state machine** recorded only catalog batches as `applied`; the bulk entity loads went through `/imports/active_plans/apply` directly and `reconciliation_run` is empty (0 rows) — so there is no governed, registered reconciliation record on the target side. This reconciliation (in `10_reconciliation_results.md`) is the first formal one.

## Decision

Do not re-run or "fix forward" the import in this session (apply is gated off). The shortfalls above are reported, not patched. See `12_final_migration_report.md` for the disposition.
