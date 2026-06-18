# 07 — Sample Import Dry-Run (NOT RUN — no dish source)

> The importer `dish-detail-import.mjs` is **designed, not built/run** this session: there is **no dish
> content to import** (doc 01/06). Building+running an importer that yields 0 dishes and all-`no_dish`
> exceptions would not advance the goal and would require archiving very large HTML for no content value.

## Importer design (ready to implement once a dish source is confirmed)
Reads VPS raw (catalog/assignment responses) or the m22 grids; archives full response into
`legacy_dish_detail_raw` (dedup `raw_sha`); parses via `dish-detail-lib.mjs`; writes the clean model;
records exceptions; idempotent. Guards mirror the proven m22 importer:
- refuse production (`SYNC_TARGET=staging` only)
- refuse apply without an explicit per-scope token (e.g. `DISH_IMPORT_APPLY_CONFIRM=APPLY_DISH_SAMPLE_STAGING`)
- refuse non-VPS source (`DISH_IMPORT_SOURCE_VPS=1`)
- refuse unknown scope; refuse if the m23 tables are absent (DB version ≥ 0020)
- write **only** m23 tables; read `customer_order`/`customer` for FK lookup only
- dry-run default; **no silent drops** (every parsed slot → clean dish-day or exception)

## Dry-run summary schema (to be emitted when run)
`records_seen · would_archive · would_create_dish_days · would_create_dish_items · would_exception ·
missing_order_link · missing_customer_link · missing_required_params · parse_failed · unknown_fields_count
· duplicate_hash · duplicate_dish_item · applied=false · ok`.

## Why not run now
- **No dish content** in the accessible source (the deciding gate, doc 06).
- m22 last-year scrape active → no live catalog scrape to feed an import.
- → import dry-run/apply/reconciliation (docs 07–09) are deferred until a confirmed dish source exists.
</content>
