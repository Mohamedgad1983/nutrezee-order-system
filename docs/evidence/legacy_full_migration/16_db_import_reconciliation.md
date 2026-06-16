# First-Migration DB Import & Reconciliation

Date: 2026-06-16 · Target: **staging** Postgres `nutrezee` (never production). All counts are live DB reads.

## What was applied this session

- **Products catalog imported** via the governed M19 path (`POST /imports/catalog/apply`) using a **temporary dedicated super-admin** (`import-temp@nutrezee.local`), bootstrapped with an in-process-generated password (never printed/committed) and **deleted immediately after** (audit: `staff.created` → `staff.deleted`). Dry-run was clean (1,296 created / 0 error) before apply.
- No other entity was applied. Customer/order/payment/etc. remain at their prior reconciled levels (not re-imported this session).

## Per-entity reconciliation

| Entity | Legacy source | Normalized | DB inserted / matched / failed (this session) | Final DB count | Missing | Extra | FK / checksum |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| **products** ✅ | 1,296 | 1,296 | **1,296 / 0 / 0** | **1,298** (1,296 legacy + 2 pre-existing) | **0** | 2 (pre-existing) | FK clean (0 orphan meal_type); sync_record=1,298 |
| customers | 20,151 | — | not re-imported | 19,379 | ~772¹ | — | 0 orphans; 0 dup phone |
| addresses | (no source baseline²) | — | not re-imported | 9,506 | unprovable | — | 0 orphans |
| orders | 20,637 | — | not re-imported | 19,465 | ~1,172¹ | — | 0 orphans; 0 dup order# |
| packages | 7 | — | not re-imported | 9³ | 0 | 2 (demo) | match on all 7 |
| payments | (no source baseline²) | — | not re-imported | 11,257 | unprovable | — | 0 orphan→order |
| delivery method | 4 | — | master only | 1 master | 3 masters + per-order⁴ | — | n/a |
| delivery time | per-order | — | master only | 1 slot master | per-order⁴ | — | n/a |
| status | 4 (Active/Expire/cancel/pending) | — | mapped | active 1,054 / expired 11,162 / cancelled 1,539 / rejected 5,710 | — | — | 0 null status |

¹ Largely **intentional exclusions** (import-time phone dedup + placeholder-phone blacklist + bad-date rows + merge_review holds), not recoverable data — re-importing reproduces the same exclusions. See `mismatches.jsonl` MM-03/MM-06.
² Addresses & payments had no per-page authoritative count at source; a count re-extract is needed to reconcile.
³ 7 genuine legacy packages + 2 demo plans mis-tagged `origin='legacy'`.
⁴ **Per-order delivery method/time are NOT stored** — the schema has no column for them (`customer_order` only has `site_ref`; `address` has `area_id`+`delivery_notes` but no method/time). See the schema proposal (`17_delivery_schema_proposal.md`). Delivery data IS fully extracted (20,637 orders, all 4 methods) and ready to load if the extension is accepted.

## Verdict

`NOT_VERIFIED_DB_STORED_100_PERCENT` — **products** is now fully DB-stored and reconciled, but:
- delivery method/time have **no per-order storage** (schema limitation; proposal attached, not yet applied),
- customers (−772) and orders (−1,172) retain explained-exclusion gaps,
- addresses/payments lack source baselines.

100% is **not** claimed. The next gated step is a corrective-import **dry-run** for customers/orders/packages/payments/status (prepared) and a decision on the delivery schema proposal — both stop before any risky apply pending your go-ahead.
