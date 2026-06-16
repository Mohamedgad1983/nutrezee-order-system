# Reconciliation Results

Date: 2026-06-16
Reconciled by: read-only queries against the **staging** Postgres (`nutrezee-postgres-1`, DB `nutrezee`) via the `nutrezee-vps` MCP, compared with the legacy extraction profile on the VPS (`/opt/nutrezee/analysis-results.json`, `…/migration-output/2026-06-14T13-29-40-368Z/summary.jsonl`).

Status: `NOT_VERIFIED_WITH_MISMATCHES`

## Context (important)

The legacy → staging migration was **already performed by prior on-VPS scripts** (`/opt/nutrezee/import-orchestrator.mjs`, `import-history.mjs`, `address-import.mjs`) on 2026-06-14/15, driving the governed M19 import endpoint `POST /imports/active_plans/{dry-run|apply}` authenticated as the staging admin. **No import was performed in this session** (`MIGRATION_APPLY` unset → dry-run/reconcile only). This document reconciles what is already in staging against the legacy extraction.

Legacy-side authoritative figures come from the 2026-06-14 extraction of the live `nutreeze.com` admin (read-only GET pulls). All staging figures are live `count(*)` reads taken 2026-06-16.

## Result Table

| Entity | Legacy (authoritative) | New (staging, origin='legacy') | Count Match? | FK Check | Status |
| ------ | -----------: | --------: | ------------ | -------- | ------ |
| customers | 20,151 | 19,379 created | ⚠️ **−772 (mostly dedup)** | ✅ 0 orphans | RECONCILE-NEEDED |
| customer_addresses | not separately counted at source¹ | 9,506 | ⚠️ unprovable | ✅ 0 orphans | UNPROVABLE |
| orders — active | 1,044 | 1,054 | ❌ **+10** | ✅ 0 orphan customer | MISMATCH |
| orders — full history | no authoritative source total² | 19,465 | ⚠️ unprovable | ✅ 0 orphan customer | UNPROVABLE |
| order_details (order_item) | present in legacy (per-order)³ | **1** (a seed order, not legacy) | ❌ **~0 migrated** | n/a | **P0 MISSING** |
| payments | 929 success / 1,044 active (active only)⁴ | 11,257 | ⚠️ unprovable | ✅ 0 orphan order | UNPROVABLE |
| deliveries | order-detail only, not extracted³ | 0 per-order delivery rows (site_ref null on all) | ❌ | n/a | **P0 MISSING** |
| packages | 7 | 7 legacy (+2 seed = 9 total) | ✅ | ✅ | MATCH |
| delivery_methods | 4 | 1 | ❌ **−3** | n/a | MISMATCH |
| products | (legacy catalog) | 2 | ⚠️ likely partial | ✅ | PARTIAL |
| areas | (legacy areas) | 127 | ⚠️ unprovable | ✅ | LOADED |

¹ Addresses were extracted as part of `customer_details` / a later `address-import.mjs` pass; the legacy admin does not expose a single authoritative address count. 9,506 of 19,379 staged customers (≈49%) have an address.
² Only the **active** orders list (1,044) was profiled at source. The full history (19,465) was pulled via `raw/orders_history.json` and imported, but there is no source-side total to prove it is complete.
³ The legacy active-order list page carries no line items or delivery rows ("delivery method/area/slot not present on order list — order-detail only", per `analysis-results.json`). Per-order detail pages were **not** extracted, so order line items and deliveries could not be imported.
⁴ Payment success/missing (929/115) was profiled for the 1,044 active orders only; no full-history payment total exists at source.

## Staging-side import accounting (`import_row_result`)

| action | rows |
| --- | ---: |
| created | 97,784 |
| matched | 4,343 |
| **error** | **1,732** |
| **merge_review** | **93** |

**Corrected by adversarial verification** (the earlier "merge-review halt → 772 lost" story was wrong):

- **Customer import completed cleanly** — the 40 applied customer batches recorded `created=19,379, matched=592, merge_review=29, error=0`. The 20,151→19,379 delta decomposes as **592 phone-matched** (deduped into an existing row — intentional), **29 held** for merge_review, and **~151 source rows not processed** (20,000 of 20,151 fed to the applied batches). This is dedup + a small unprocessed tail, **not** 772 lost customers.
  - **Open risk:** legacy phone groups mapped up to 43 customers to one number (family members). Phone-based dedup may have wrongly collapsed *distinct people*. The 592 matched + 29 held + 151 unprocessed each need row-level categorization before any 100% claim.
- **All 1,732 `error` rows are in the `active_plans` (order) import** — failed order rows, never re-applied (~8% of attempted orders). The 93 `merge_review` rows are customer rows (mostly from dry-run batches), unresolved.
- At extraction, 7,746 of 20,151 customers were flagged `NEEDS_MANUAL_REVIEW`.

## Foreign-key integrity (clean)

- `customer_order` → `customer`: 0 orphans
- `address` → `customer`: 0 orphans
- `payment_record` → `customer_order`: 0 orphans
- `customer_order.package_id` null: 1 (reconcile.sql relinked the rest by normalized package name)

**Interpretation:** the data that was imported is referentially sound. The failure mode is **incompleteness**, not corruption.

## Sync mapping (`sync_record`, M18 bridge — authoritative legacy↔new map)

| object_type | mapped rows |
| --- | ---: |
| customer | 19,379 |
| order | 19,465 |
| payment | 11,257 |
| master | 12 |
| package | 9 |
| product | 2 |

## 100% Decision

`NOT_VERIFIED_WITH_MISMATCHES` — do **not** claim 100%. Mismatch details and affected-ID summary in `mismatches.jsonl`.
