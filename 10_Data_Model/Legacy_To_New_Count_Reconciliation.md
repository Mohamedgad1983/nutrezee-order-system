# Legacy → New Count Reconciliation

**Date:** 2026-06-15 · **Scope:** staging load · **Companion:** `Full_Staging_Import_Report.md`

Three-way reconciliation: legacy extracted → normalized (import input) → staging imported.

## Customers

| Stage | Count | Note |
|---|--:|---|
| Legacy recordsTotal (DataTables) | 20,151 | server-reported total |
| Extracted rows (single snapshot) | 20,164 | live total shifted slightly during pull |
| Distinct by legacy "Unique ID" | 7,475 | ⚠ **column is NOT unique** — unusable as key |
| **Distinct by phone (real key)** | **19,452** | the de-facto unique customer key |
| Normalized import input (named rows) | 20,163 | 1 dropped (no name) |
| **Staging — created** | **19,379** | distinct customers |
| Staging — matched (phone dedup) | 592 | same-phone duplicates linked |
| Staging — merge_review (queued) | 29 | no-phone fuzzy → Ops review |
| Deferred (last chunk, gate) | ~163 | 20.9% merge_review tail |
| **Reconciliation** | created 19,379 + matched 592 + review 29 = **20,000 processed** (of 20,163; 163 deferred) | ✅ accounts for all but the deferred tail |

**Customer coverage: 19,379 distinct of ~19,452 (99.6%).**

## Active plans (orders)

| Stage | Count | Note |
|---|--:|---|
| Legacy recordsTotal | 1,043–1,044 | |
| Extracted | 1,044 | single request (no pagination issue) |
| Excluded (placeholder phone) | 1 | customer imported phone-less → unresolvable |
| Normalized import input | 1,043 | |
| **Staging — created** | **1,043** | **0 errors, 0 matched, 0 review** |
| **Reconciliation** | 1,043 created = 1,043 input | ✅ 100% of attempted |

## Payments

| Stage | Count |
|---|--:|
| Orders with legacy payment_status | 928 |
| Orders with blank payment_status | 115 |
| **Payment records created** | **928** (all mapped `paid`) |
| Orders → finance review (no record) | 115 |

## Catalog

| Entity | Legacy | Imported |
|---|--:|--:|
| Packages | 7 | 7 |
| Package-for-type masters | 7 | 7 |
| Delivery methods | 4 | **0** (not the M19 catalog importer's scope; M16 ops-master path) |
| Products | — | 0 (legacy page times out) |

## Derived

| Entity | Count |
|---|--:|
| Fulfillment days generated | 35,344 (SCHEDULED) |
| Customers with ≥1 active plan | 1,032 |

**Net:** staging holds 19,379 customers + 1,043 active plans + 928 payments + 35,344 fulfillment-days, all `origin='legacy'`. Unreconciled items are the **163-customer deferred tail** and the **1 placeholder-phone order** — both documented, neither lost (still in the extract on the VPS).
