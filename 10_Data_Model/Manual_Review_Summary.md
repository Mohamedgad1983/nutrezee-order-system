# Manual Review Summary (Post-Import)

**Date:** 2026-06-15 · **Companion:** `Post_Import_Data_Quality_Report.md`
What a human (Ops / Finance / data owner) must review after the staging load. None of these block the *load*; they shape a real migration.

## Customer merge-review queue

| Item | Count | Owner | Action |
|---|--:|---|---|
| merge_review (applied, no-phone fuzzy) | 29 | Ops | review fuzzy candidates; create or merge |
| deferred tail (last chunk, gate) | ~163 | Ops/eng | re-run diluted or review; ~34 of these are merge_review, ~129 createable |
| placeholder-phone customers (3 numbers) | 94 | Ops | imported phone-less; reconcile identities if needed |

## Order / finance review queue

| Item | Count | Owner | Action |
|---|--:|---|---|
| Orders with blank payment status (no record) | 115 | Finance | confirm paid/unpaid (mostly coupon-covered) |
| Orders unresolved package_id (frozen name only) | 545 | Eng/Ops | normalize package names → re-link (Q1) |
| Overlapping duplicate active plans (same customer) | 8 of 11 | Ops | dup-plan vs household decision |
| Orders missing delivery method/area/slot | 1,043 | Ops | enrich from order-detail or first contact |

## Data-owner decisions

| Decision | Why | Impact |
|---|---|---|
| Arabic-name policy | ~7.4k customers have Arabic-only `full_name_en` | clean vs review for a large block |
| KWD minor-unit factor | amounts loaded ×1000 (fils) | money correctness |
| Coupon import | 517 orders carry a coupon (not loaded) | reporting / loyalty parity |
| Package-name canonicalization | catalog vs order names differ | 545 orders re-link |

## Counts at a glance

- **Customers needing review:** 29 (queued) + ~163 (deferred) + 94 (placeholder) ≈ **286** of 19,379 (~1.5%).
- **Orders needing review:** 545 (package) + 115 (payment) + 8 (dup-plan) — overlapping sets.

**Exit:** work the customer merge-review queue + the 545 package re-links + the 115 finance items, and take the Arabic-name + KWD-factor decisions, before treating staging as a migration rehearsal.
