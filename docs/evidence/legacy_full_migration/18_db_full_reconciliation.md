# First-Migration Scope — Full DB Reconciliation (Option B applied)

Date: 2026-06-16 · Target: **staging** Postgres `nutrezee` (never production). Live DB reads.

## Option B applied (per-order delivery now stored)

- Migration `0014_order_delivery_frozen.sql` applied to staging: 3 **nullable** frozen columns on `customer_order` (`delivery_method_frozen`, `delivery_time_frozen`, `delivery_area_frozen`). Additive, backward-compatible, recorded in `schema_migrations`.
- Governed importer updated (committed `8b920a6`, TS-M tested): `active_plans` stores delivery on create and backfills matched orders idempotently (M03 owns `customer_order`).
- Existing 19,465 orders backfilled via idempotent COALESCE data step (dry-run → apply): **19,464 updated, 0 failed**.

## Per-entity reconciliation

| Entity | Legacy source | DB stored | Count match | Missing | FK | Stored? |
| --- | ---: | ---: | --- | ---: | --- | --- |
| customers | 20,151 | 19,379 | ❌ | 772¹ | 0 orphan | partial |
| addresses | (no source total²) | 9,506 | ⚠️ | n/a | 0 orphan | stored |
| orders | 20,637 | 19,465 | ❌ | 1,172¹ | 0 orphan | partial |
| packages | 7 | 7 (+2 demo) | ✅ | 0 | clean | ✅ |
| payments | (no source total²) | 11,257 | ⚠️ | n/a | 0 orphan→order | stored |
| **delivery method** | 4 methods / per-order | **18,772 orders** + 4 methods³ | ✅ stored | 0⁴ | n/a | **✅** |
| **delivery time** | per-order | **18,723 orders**³ | ✅ stored | 0⁴ | n/a | **✅** |
| status | 4 | active 1,054 / expired 11,162 / cancelled 1,539 / rejected 5,710 | ✅ mapped | 0 null | n/a | ✅ |
| products catalog | 1,296 | 1,298 (1,296 legacy + 2) | ✅ | 0 | 0 orphan | ✅ |

¹ **Explained exclusions** (data-quality), not recoverable net-new — see corrective dry-run below.
² Addresses & payments have no per-page authoritative source count; a count re-extract is needed to reconcile exactly.
³ Delivery `area` stored on 19,454 orders. ~693 orders have no method because the legacy order genuinely had none (faithful).
⁴ 1,149 extracted delivery rows have no matching staging order — they belong to the 1,172 missing orders, not a delivery loss.

## Corrective dry-run (would_create / update / skip / fail)

From the recorded import accounting (`import_row_result`, applied batches) + the fresh delivery dry-run. Importers are idempotent, so a re-run matches already-stored rows.

| Entity | would_create | would_update | would_skip/match | would_fail | apply safe? |
| --- | ---: | ---: | ---: | ---: | --- |
| customers | ~0 net-new | 0 | 19,379 + 592 dedup | 29 merge_review + ~151 unprocessed | safe (idempotent) — won't recover the gap |
| orders | ~0 net-new | 0 | 19,465 | ~1,172 excluded (bad data / missing customer / placeholder phone) | safe — won't recover the gap |
| packages | 0 | 0 | 7 | 0 | safe |
| payments | 0 | 0 | 11,257 | 0 | safe |
| products | 0 | 0 | 1,296 | 0 | safe |
| **delivery method/time** | 0 | **19,464 (applied)** | 1,149 no-match | **0** | **applied clean** |
| status | 0 | 0 | 19,465 mapped | 0 | safe |

**Exact blockers to 100%:** the 772 customers and 1,172 orders are **excluded at source for data quality** (import-time phone dedup, placeholder-phone blacklist, invalid dates, merge_review holds) — recorded, not lost. They are not recoverable by re-import without source data fixes / manual merge resolution. Addresses & payments lack an authoritative source count to prove an exact match.

## FK integrity & checksums

- FK: **0 orphans** across orders→customer, payments→order, addresses→customer.
- No per-record checksums were captured at the original extraction; reconciliation is count + FK + import-accounting based.

## WhatsApp segments (recomputed post-import)

EXPIRES_TODAY 33 · ACTIVE_RENEWAL_3D 46 · ACTIVE_RENEWAL_7D 128 · EXPIRED_1_7 124 · EXPIRED_8_30 384 · EXPIRED_31_90 640 · EXPIRED_90_PLUS 4,005 · PENDING_PAYMENT 1,125 · CANCELLED 558 · ACTIVE_FUTURE 670. (Date drift vs the earlier run; no WhatsApp messages sent; cron not enabled.)

## Verdict

> ## `NOT_VERIFIED_WITH_MISMATCHES`

**Option B is complete** — per-order delivery method/time/area are now stored and reconciled (the gap this phase set out to close). Products, packages, status, and delivery are fully stored. **But the overall first-migration scope is not 100%:** customers (−772) and orders (−1,172) have `missing > 0` (explained data-quality exclusions), and addresses/payments lack authoritative source baselines. Per the rule (every entity count matches, missing = 0), 100% is **not** claimed.

To reach `VERIFIED_DB_STORED_100_PERCENT`: resolve the 29 merge_review customers + re-extract/repair the ~151 unprocessed customers and the ~1,172 excluded orders (or formally accept them as data-quality exclusions), and capture source-side address/payment counts.
