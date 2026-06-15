# Full Staging Import Report

**Date:** 2026-06-15 · **Status:** ✅ Imported to **staging** (real legacy data) · **Scope:** staging only — legacy untouched (read-only), production untouched
**Environment:** `https://13-140-159-201.sslip.io` · DB `nutrezee` on `nutrezee-postgres-1` · imported via the M19 `dry-run → apply` pipeline (`/imports/{catalog|customer|active_plans}`)
**Companions:** `Legacy_To_New_Count_Reconciliation.md`, `Post_Import_Data_Quality_Report.md`, `Manual_Review_Summary.md`, `Cutover_Blockers_After_Import.md`, `Deep_Order_Analysis.md`

> **Honest summary.** A first import attempt was **rolled back** after dry-run/apply revealed the extracted `customers.json` was corrupt (see §2). The extraction was corrected (single consistent snapshot; key on **phone**, since the legacy "Unique ID" column is **not unique**), re-validated, and **re-applied successfully with 0 errors**. Staging now contains real legacy customers + active plans + catalog. The M19 pipeline itself worked correctly throughout (validated, gated, idempotent).

## 1. What was imported (final, in staging)

| Entity | Imported | Notes |
|---|--:|---|
| Catalog — packages | 7 | name-keyed (no price on the legacy list) |
| Catalog — package-for-type masters | 7 | incl. Friday-off / new-customer flags |
| **Customers (legacy)** | **19,379 created** | + 592 matched (phone dedup) + 29 merge_review queued |
| **Active plans (orders)** | **1,043 created** | 0 errors; status=active |
| Payment records | 928 | all mapped `paid`; 115 orders had blank legacy payment status → no record (finance review) |
| Fulfillment days | 35,344 | generated SCHEDULED from start→end per plan |

All imported rows carry `origin='legacy'` and an `import_batch_id`. Audit `bridge.import_run` (HIGH) written per applied batch.

## 2. The first attempt + rollback (full transparency)

1. **Pre-import backup taken** (`/opt/nutrezee/backups/pre-import-20260615T022302.sql.gz`, gzip-verified).
2. Catalog + 40 of 41 customer chunks applied → DB showed **20,000 processed → 7,299 created, 12,696 "matched"**. That collapse was wrong.
3. **Root cause (extraction, not import):** the extracted `customers.json` had only **7,475 distinct values in the legacy "Unique ID" column across 20,151 rows** — because (a) server-side DataTables `start/length` paging over an unstable sort duplicated/missed rows, and (b) the legacy **"Unique ID" column is not unique** (e.g. id `443` = 17 different people). The importer keyed idempotency on that id → collapsed distinct people.
4. **Rolled back** by restoring the pre-import backup → staging returned to the exact baseline (customer=9, order=1). Verified health 200 + login 200.
5. **Fix:** re-extract customers as one consistent snapshot; key the import on **phone** (19,452 distinct; the de-facto unique key) with a synthetic key for no-phone rows; blacklist 3 placeholder phones (43/41/10 customers) from auto-merge. Re-validated (0 errors) → re-applied.

## 3. Process compliance

- ✅ Legacy READ-ONLY (extraction via the safety-guarded toolkit; no legacy writes).
- ✅ Production untouched.
- ✅ Staging backup before import; rollback exercised and proven.
- ✅ `dry-run` before every `apply`; gates enforced (customer merge_review ≤10%, active_plans error=0).
- ✅ `import_batch` per chunk; `origin='legacy'`; audit/import logs written.
- ✅ No PII committed to git (raw data stays in `migration-output/` on the VPS, gitignored).

## 4. Deviations from the literal task (and why)

- **Multiple `import_batch` ids, not one.** The API body limit (~100 KB, NestExpress default) caps each request, so 20k customers were chunked into ~40 batches (catalog 1, customers 40, active_plans 5). Each is a real `import_batch` with `origin='legacy'`.
- **163-customer tail deferred** — the last chunk had 20.9% merge_review (a no-phone cluster) and tripped the 10% gate; deferred rather than forced. ~99.6% of distinct customers imported.
- **Delivery method / area / slot not imported** — they are not on the legacy order list (order-detail pages only). Imported plans are address/slot-less (fill at first contact, WF-01).
- **Coupons not loaded this pass** (517 source orders carry coupons) — out of the minimal active-plan field set used here; a follow-up field can add `coupon_code_frozen`.
- **Money:** KWD amounts converted to fils (×1000) for the bigint minor-unit column — precision assumption to confirm.
- **products** entity not extracted (legacy `/products` page times out) — packages imported instead.

## 5. Rollback still available

- **Pre-import backup** `/opt/nutrezee/backups/pre-import-20260615T022302.sql.gz` (restores staging to the clean pre-import baseline).
- **M19 per-batch rollback** (`POST /imports/:batchId/rollback`) for each applied batch (deletes created rows while nothing references them).

**Next action:** review `Post_Import_Data_Quality_Report.md` (esp. the 545 unresolved-package orders) and `Cutover_Blockers_After_Import.md`; decide the package-name normalization + Arabic-name policy before treating this as a migration rehearsal. This import is a **staging load for analysis**, not the production cutover.
