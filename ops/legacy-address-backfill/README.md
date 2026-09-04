# Legacy structured-address backfill (ops)

One-off, idempotent backfill that recovers the structured legacy address (`House no / Building /
Street / Area / Contact no`) the original `address-import.mjs` dropped. Reads the already-scraped
`customer_details.jsonl` — **no legacy login**. Applied to staging 2026-06-26.

- **Schema:** `app/db/migrations/0022_address_structured_fields.sql` (adds nullable
  `house_no, building, block_floor_raw, street`; applied + recorded in `schema_migrations`).
- **Scripts (production copies on the VPS under `/opt/nutrezee/legacy-address-backfill/`):**
  - `analyze_addr_template.py` — read-only parse-quality analysis (99.8% hit).
  - `addr_backfill_dryrun.py` — read-only dry-run preview → `/root/address_backfill_dryrun.md`.
  - `apply_addr_backfill.py [dry-run|apply]` — governed backfill; UPDATE guarded `WHERE house_no IS NULL`.
- **Evidence:** `docs/evidence/legacy_address_backfill/01_structured_address_backfill.md`.
- **Result/probe:** `/root/address_backfill_result.md` (200/200 correctness probe, 0 mismatches).
- **Snapshot:** `/opt/nutrezee/backups/pre-address-backfill-20260626T065926Z.dump`.
- **Provenance/rollback handle:** `created_by`/`updated_by = 'address-structured-backfill'`.

Open: `block_floor_raw` numeric pair has lost labels (block/floor?) and `building` stays NULL until a
labelled re-scrape (gated); `location_pin` still NULL → geocoding is the separate next step.
