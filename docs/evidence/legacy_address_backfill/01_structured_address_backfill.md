# 01 — Structured-address backfill from legacy customer_details (2026-06-26)

**Status:** APPLIED to staging · **Mode:** read-only source (no legacy login) → governed staging write
**Evidence label:** Verified (correctness-probed)

## Why
DB discovery (2026-06-26) found two Driver-App blockers: `address.location_pin` 100% NULL and 51% of
customers with no usable address. Investigation ([legacy_scraper_report] on the VPS) showed the legacy
"Address Details" block **does** contain structured fields (`House no / Building / Street / Area /
Contact no`) and was **already scraped** into
`…/legacy-migration/migration-output/2026-06-14…/raw/customer_details.jsonl`, but the original
`address-import.mjs` stored **only the area name** and dropped the rest.

## What was done
1. **Migration `0022_address_structured_fields.sql`** — added nullable `address.house_no, building,
   block_floor_raw, street` (this file; applied + recorded in `schema_migrations` on staging).
2. **Backfill** (`ops/legacy-address-backfill/apply_addr_backfill.py`) — parsed the templated address
   (regex hit 99.8%), matched customers by 8-digit phone, filled the structured columns + `area_id`,
   routed delivery instructions / differing contact numbers to `delivery_notes`, recomposed
   `address_text`. Idempotent (UPDATE guarded `WHERE house_no IS NULL`).

## Numbers (Verified)
- address rows 9,511 → 9,542 (+31 created, 0 lost); 9,492 enriched in place.
- house_no 9,408 · street 9,506 · block_floor_raw 9,381 · delivery_notes 274 · location_pin 0 (unchanged).
- Skipped: no-phone 20, no DB match 33, parse-fail 16.
- Pre-write snapshot: `/opt/nutrezee/backups/pre-address-backfill-20260626T065926Z.dump`.
- Correctness probe: 200/200 sampled `house_no` == source, 0 mismatches.

## Caveats / open
- `block_floor_raw` = legacy `Building Name : <a, b>` numeric pair, labels lost (likely block/floor);
  `building` reserved (NULL) until a labelled re-scrape (gated — decision B).
- ~2% of source addresses were 120-char truncated by `extract-details.ts`.
- **No geo pins in legacy** → `location_pin` still NULL; geocoding (decision C — "both": geocode now +
  collect pins forward) is the next step and involves external egress of addresses (own go/no-go).

## Provenance / rollback
`created_by`/`updated_by = 'address-structured-backfill'`. Rollback: delete created rows + null the
four columns on updated rows, or `pg_restore` the snapshot. (No `import_batch` row — its `type` CHECK
allows only `customer|catalog|active_plans`.)
