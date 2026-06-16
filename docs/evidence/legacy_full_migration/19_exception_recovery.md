# Exception Recovery — Missing Customers & Orders

Date: 2026-06-16 · Target: **staging** only. No cron, no WhatsApp, no production.

A forensic diagnostic classified every legacy customer/order **not** stored in staging, by exact reason + repairability + action. All **safe** records were repaired (dry-run → apply); the rest are documented data-quality exceptions.

## Method

`tools/legacy-full-migration/exception-report.mjs` (read-only) replicates the importer's keying/exclusion logic and diffs source (`customers_v2.json` 20,164 · `orders_history.json` 20,569) against `sync_record`. Full per-record report (legacy id, reason, repairability, action) written to the VPS only — **PII, never committed**.

## Customers — missing classification (pre-repair: 890)

| Reason | Count | Repairable | Recommended action |
| --- | ---: | --- | --- |
| `not_imported` (unique valid phone, not stored) | 89 | **YES** | **re-imported → 84 created** |
| `duplicate_phone_deduped` (same phone as a stored customer) | 616→621 | REVIEW | folded into the same-phone customer; import as distinct only if a different person (family-shared phone) |
| `placeholder_phone_blacklisted` (≥10 customers share the phone) | 93 | REVIEW | junk/shared phone; needs manual identity verification |
| `invalid_or_missing_phone` | 91 | PARTIAL | importable only with a synthetic key + unverified flag (no reliable dedup key) |
| `no_name` | 1 | NO | no name in source |

## Orders — missing classification (pre-repair: 1,104)

| Reason | Count | Repairable | Recommended action |
| --- | ---: | --- | --- |
| `unprocessed_recoverable` (customer exists, valid dates+package) | 667 | **YES** | **re-imported → 638 created** (incl. 20 unlocked by the new customers) |
| `placeholder_phone` (≥10 share the phone) | 395 | REVIEW | resolve customer manually |
| `customer_not_found` (garbage `name[phone]` or unknown phone) | 42→22 | DEPENDS | import the customer first (20 recovered); 22 remain (garbage phone) |
| constraint issues (negative legacy amount / `end_date < start_date`) | 49 | REVIEW | legacy data errors — needs a human decision (clamp/swap would invent data) |

## Repair applied (safe records only)

Dry-run was iterated until **clean (0 errors)** — it surfaced and excluded garbage phones, **negative amounts** (violate `customer_order_package_amount_check`), and **reversed dates** (violate `start_date <= end_date`) before any write. Then applied via the governed M19 endpoints (temporary super-admin, in-process password, deleted after):

| Entity | Created | Errors |
| --- | ---: | ---: |
| customers | **84** | 0 |
| orders | **638** | 0 |
| payments (from those orders) | +281 | 0 |
| delivery backfilled onto new orders | +620 | 0 |

## Post-repair reconciliation

| Entity | Before | After repair | Source | Remaining gap |
| --- | ---: | ---: | ---: | ---: |
| customers | 19,379 | **19,463** | 20,151 | 688 (621 dedup-folded + 91 invalid + 93 placeholder + 1 no-name) |
| orders | 19,465 | **20,103** | 20,569 | 466 (395 placeholder + 22 garbage-phone + 49 constraint) |
| payments | 11,257 | **11,538** | — | — |
| delivery method (per order) | 18,772 | **19,392** | — | — |

FK integrity: **0 orphans** (orders→customer, payments→order). 0 import errors.

## Remaining exceptions are NOT safely repairable

Every remaining missing record falls into a documented data-quality bucket:
- **Customer dedup (621):** the customer *is* represented — folded into the row sharing its phone. Splitting requires confirming they are distinct people (family/shared-phone), a manual call.
- **Placeholder/blacklisted phones (93 cust + 395 ord):** one phone shared by ≥10 customers (call-centre/default numbers) — auto-importing would create false identities/merges.
- **Invalid/garbage phones (91 cust + 22 ord):** no reliable key.
- **Constraint violations (49 ord):** negative amounts / reversed dates — repairing would invent/alter legacy values (violates "keep legacy frozen").

## Verdict

> ## `STORED_WITH_ACCEPTED_EXCEPTIONS`

All **safely repairable** records are now stored (84 customers + 638 orders + 281 payments, 0 errors, FK clean). The migration is **not 100% count-matched** — 688 customers and 466 orders remain — but every remaining record is an **enumerated, justified data-quality exception** (dedup, placeholder/garbage phones, negative amounts, reversed dates), not a pipeline failure. Recovering them requires manual data decisions, not automation. Recommend **accepting these as documented exceptions** (or running a sponsor-reviewed manual pass for the dedup/placeholder cases).
