# 08 — Sample Gated Apply (NOT RUN)

> Not run — depends on a successful import dry-run (doc 07), which is blocked by the absence of a dish
> source (doc 01/06). Migration `0020` is **not applied to staging** this session (no data to import;
> staging stays at `0019`).

## When run, the gated apply will (design)
- require: `SYNC_TARGET=staging` + explicit `DISH_IMPORT_APPLY_CONFIRM` token + `DISH_IMPORT_SOURCE_VPS=1`
  + staging DB version ≥ `0020` (m23 tables present); take a pre-apply backup.
- write **only**: `legacy_dish_detail_raw`, `customer_dish_day`, `customer_dish_day_item`,
  `dish_detail_import_run`, `dish_detail_exception`. **Never** touch order/customer core (read-only FK lookup).
- be idempotent (`UNIQUE(raw_sha)`, no-dup-day, no-dup-item).
- emit: `import_run_id · raw_inserted · dish_day_inserted · dish_item_inserted · exception_inserted ·
  duplicate_skipped · unknown_fields_preserved · ok`.

Deferred until a confirmed dish source exists.
</content>
