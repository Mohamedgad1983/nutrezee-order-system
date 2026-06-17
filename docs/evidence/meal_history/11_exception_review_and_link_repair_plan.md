# 11 — Exception Review & Link-Repair Plan (m22)

> 28 exceptions from the last-30-days apply, **100% `missing_order_link`**, across **24 distinct legacy
> orders**. Root cause is fully deterministic: the orders aren't in `sync_record` yet. **Not** a
> meal-history defect; **not** forced into clean tables. Deterministic repair only — no name/phone
> mapping, no fabricated links, no bridge.

## Exception summary
| reason | rows | distinct orders | PII in detail |
|---|---|---|---|
| missing_order_link | 28 | 24 | none (ids only: `{"order_number": "..."}`) |
| missing_customer_link | 0 | — | — |
| invalid_date | 0 | — | — |
| duplicate_hash / parse_error / duplicate_meal_day | 0 | — | — |

All 28 reconcile across dry-run / apply / DB / idempotent-rerun. Detail holds **order ids only** — no
customer name, phone, or address.

## Per-group analysis (the required fields)
For every missing-link order: `internal_id` present (grid filename) · `order_number` present
(resolved via `orders_index`) · `sync_record` **absent** (0/24) · `customer_order` **absent** (no
order to link). The split is by the order-sync **watermark (24630 = highest synced order)**:

| Group | Criterion | Distinct orders | Suspected reason | Recommended repair path |
|---|---|---|---|---|
| **A — not yet synced** | order_number **> 24630** (24631–24674) | **23** | New orders placed/extracted *after* the last order-sync watermark; `sync_record` legitimately has no row yet. | **Self-healing.** Advance order-sync (incremental-sync) past these numbers, then run the meal-history **relink** pass (below). No meal-history action needed first. |
| **B — order-migration gap** | order_number **≤ 24630** (24629) | **1** | Below the watermark yet absent — the original order migration **skipped** it. **Confirmed:** order 24629 is present in `migration_exception_review` (a known upstream order exception). | Repair the **order** exception first (M19 `repair-runner` / `migration_exception_review` workflow). Once it enters `sync_record`, the relink pass promotes its meal-days. |

> Confirmation query result: Group A = 23, Group B = 1; the single Group-B order (24629) **is** in
> `migration_exception_review` — proving the gap is an upstream order-migration exception, not a
> meal-history error.

## Why re-running the import alone cannot repair these
The apply is order-idempotent on `raw_sha` and **skips the whole order before link evaluation**
(`meal-history-import.mjs`: `if (existingRawSha.has(sha)) { would_skip_duplicate++; continue; }`).
The idempotency rerun already showed `would_skip_duplicate=60, inserts=0`. So once an order is
archived as an exception, a re-run short-circuits at the hash check and **never re-attempts linking**,
even after `sync_record` later gains the order. Repair therefore needs a **separate reprocessing pass
that works off the already-stored raw archive**, not the file scan.

## Deterministic repair: a `meal-history-relink.mjs` pass (NEXT phase — designed here, not built)
Mirrors the existing two-phase `repair-runner.mjs` (staging-only, dry-run→apply, own run record).
Never re-reads files or the legacy system; re-resolves links from rows **already in PostgreSQL**:
1. Select open order-link exceptions (`reason='missing_order_link'`) + their `customer_meal_history`
   parents (`import_status='exception'`, `order_id IS NULL`). Dates/types are in the lossless
   `legacy_meal_history_raw.payload` — no re-extraction.
2. Re-resolve **the identical deterministic chain** against the *current* `sync_record`:
   `legacy_order_number → sync_record.legacy_key(object_type='order') → customer_order.id, customer_id`.
3. For each order that now fully resolves, in **one transaction per order**: `UPDATE
   customer_meal_history SET order_id, customer_id, import_status='imported'`; reclassify the parent's
   window dates via the same `classifyItem`; `INSERT … ON CONFLICT DO NOTHING` each now-clean day into
   `customer_meal_history_items` (the no-dup-meal-day index makes it exactly-once); mark the matching
   exception resolved; same-transaction audit row.
4. Leave unresolved orders as exceptions; the pass is idempotent and safe to re-run after each
   order-sync. Writes **only m22 tables** (never creates an order / `sync_record` row).

### Suggested additive migration `0019` (resolution trail — NEXT phase)
```sql
ALTER TABLE customer_meal_history_exceptions
  ADD COLUMN resolved_at      timestamptz,
  ADD COLUMN resolved_by      text,
  ADD COLUMN resolved_run_id  text REFERENCES customer_meal_history_import_runs(id);
```
Then "open exceptions" = `WHERE resolved_at IS NULL`; the relink pass stamps these instead of deleting,
preserving the audit trail.

## Deterministic key chain (no fabrication, no PII matching)
```
meals_<internal_id>.html.gz
  └─ internal_id ─[orders_index.jsonl, exact]→ order_number
       └─ order_number ─[sync_record.legacy_key, object_type='order', exact]→ new_ref
            └─ new_ref = customer_order.id ─[FK]→ order_id, customer_id
```
A link is promoted **only** when the full chain yields non-null `(order_id, customer_id)`; any broken
hop leaves the order an exception. No mapping by customer name; phone mapping is **not** used.

## Does this block widening to last-90-days?
**No, but widen *after* an order-sync/relink pass, not before.** The exceptions are an order-link
timing gap (missing_customer_link 0, invalid_date 0, dup 0). Widening adds **older** meal-days whose
orders are *more* likely already in `sync_record` (below the watermark, part of the original
migration) → link rate should *rise*. Recommended order: (a) order incremental-sync/repair so the
watermark passes 24631–24674 and order 24629's exception is repaired; (b) run `meal-history-relink`
(dry-run → apply), confirm the 24 promote; (c) **then** widen meal-history to last-90 (dry-run first).
