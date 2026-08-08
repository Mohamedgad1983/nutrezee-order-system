# 14 — Deterministic Meal-History Relink Job

> `tools/legacy-full-migration/meal-history-relink.mjs` — promotes `missing_order_link` exceptions
> into clean meal-history once their orders become available, **without re-scraping, without deleting
> exceptions, without name/phone/guess linking**. Migration `0019` adds the resolution trail.

## What it does
1. Reads **only** m22 rows: open `missing_order_link` exceptions + their raw-archive `raw_sha`.
2. Re-resolves the **single deterministic chain** against the *current* DB:
   `legacy_order_number → sync_record.legacy_key(object_type='order') → customer_order.id, customer_id`.
   A link promotes **only** when both `order_id` and `customer_id` resolve. (Pure planner `planRelink`
   in `meal-history-lib.mjs`, unit-tested.)
3. Never scrapes legacy. Never uses customer name. Does **not** use phone (the chain is order-number
   keyed). Never fabricates a link.
4. **Dry-run by default.** Writes **only** m22 tables.

## Guards (refuse before any DB load unless apply preconditions hold)
| guard | behavior |
|---|---|
| production | apply refused unless `SYNC_TARGET=staging` |
| explicit confirm | apply refused unless `RELINK_APPLY_CONFIRM=APPLY_RELINK_STAGING` |
| reason | fixed to `missing_order_link` |
| migration | apply refused unless resolution columns (0019) present on target |
| scope | apply writes a `customer_meal_history_import_runs` row with `scope='relink'` |

## On apply (per resolvable order, own transaction)
- `INSERT customer_meal_history_items … ON CONFLICT DO NOTHING` (no-dup-meal-day index → exactly-once)
  → `promoted_items` / `duplicate_clean_items`.
- `UPDATE customer_meal_history SET order_id, customer_id, import_status='imported'` (only if still unlinked).
- `UPDATE customer_meal_history_exceptions SET resolution_status='resolved', resolved_at,
  resolved_by_run_id, resolution_note` — **never DELETE** (audit trail survives).
- Orders with no raw provenance → `invalid_raw_payload`, not promoted. Unresolved orders stay `open`.

## Migration 0019 (additive, non-destructive)
`ALTER TABLE customer_meal_history_exceptions ADD COLUMN resolution_status ('open'|'resolved'|
'superseded'|'unresolvable', default 'open') , resolved_at, resolved_by_run_id (FK→import_runs),
resolution_note` + index. Widens `import_runs.scope` vocabulary to include `'relink'` (strict superset
— every existing row still valid). Applies clean **0001→0019** locally.

## Summary fields (every run)
`exceptions_seen · resolvable · unresolved · would_promote_items · promoted_items · would_mark_resolved
· marked_resolved · still_missing_order_link · duplicate_clean_items · invalid_raw_payload ·
duration_ms · applied · ok`.

## Tests
- **Unit** (`ts-u-meal-history`): `planRelink` resolves only orders in the sync map; empty map →
  resolves nothing; multi-day grouping; null order_number → unresolved.
- **Integration** (`ts-i-relink`): promote-then-link-then-mark; **idempotent** (2nd run promotes 0,
  re-marks 0, one clean meal-day); resolved exception **not deleted**; unresolvable exception stays
  `open` and promotes nothing.
