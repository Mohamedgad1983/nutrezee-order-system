# Dry-Run / Validation Results

Date: 2026-06-16

Status: `VALIDATED_AGAINST_STAGING` — integrity clean; completeness gaps are the blockers (see `10_reconciliation_results.md`).

## What was validated

Because the migration already ran into staging, validation was performed **directly against the staging data** (read-only SELECTs) rather than against local normalized JSONL files (which do not exist locally — the normalized data lives on the VPS). The local validator `tools/legacy-full-migration/validate-normalized.mjs` remains available for the file-based path but has no local input to score.

## Integrity checks (legacy rows in staging) — all PASS

| Check | Result | Verdict |
| --- | --- | --- |
| Duplicate `order_number` groups | 0 | ✅ |
| Orders with `end_date < start_date` | 0 | ✅ |
| Orders with null `start_date` | 0 | ✅ |
| Duplicate `phone_normalized` groups | 0 | ✅ |
| Orders → customer orphans | 0 | ✅ |
| Addresses → customer orphans | 0 | ✅ |
| Payments → order orphans | 0 | ✅ |
| Orders with null `package_id` | 1 | ✅ (≈0) |
| Paid payments with zero/null amount | 0 | ✅ |

## Data-quality findings (completeness / business, not corruption)

| Severity | Finding | Count |
| --- | --- | --- |
| P0 | Order line items absent (`order_item`) | 1 (seed only) |
| P0 | Per-order delivery data absent (`site_ref` null on all legacy orders) | 19,465 |
| P1 | Customers short vs extraction (merge-review gate halt) | −772 |
| P1 | Import rows errored / merge_review unresolved | 1,732 / 93 |
| P1 | Delivery methods present vs legacy 4 | 1 |
| P2 | Legacy orders with `total` null or 0 | 1,786 |
| P2 | Legacy orders with no payment_record (mostly historical/expired) | 8,208 |
| P2 | Legacy customers with no phone | 105 |

## Payment status distribution (legacy, staging)

`paid` 9,718 · `unpaid` 1,539 (= cancelled-order count) · total 11,257.

## Import gate

Apply is **OFF** this session (`MIGRATION_APPLY` unset). No P0 *integrity* issue would block a re-apply, but the **completeness P0s** (order details, deliveries) and the 772-customer shortfall mean the migration is **not** import-complete. A corrective re-import (extract order detail pages + resolve merge_review) is required before any 100% claim — to be done in a session with `MIGRATION_APPLY=true` and explicit authorization.
