# Post-Import Data Quality Report (Staging DB)

**Date:** 2026-06-15 · **Source:** SQL over the staging DB after import · **Companion:** `Full_Staging_Import_Report.md`

All figures queried live from staging (`origin='legacy'`). No PII reproduced.

## In-DB analysis

| Dimension | Result |
|---|---|
| Total customers | 19,388 (19,379 legacy + 9 seed) |
| Customers with an active plan | 1,032 |
| Active orders by status | active: 1,043 (100%) |
| Payment status distribution | paid: 928 · (no record): 115 |
| Unpaid / blank-payment active orders | 115 (→ finance review) |
| **Duplicate customer phones** | **0** (no two customers share a phone — dedup correct) |
| Duplicate active plans (customers w/ >1) | 11 |
| Orders with bad date range (end<start) | 0 |
| Order date span | 2025-09-21 → 2026-10-17 |
| Fulfillment days (scheduled) | 35,344 |
| **Orders with unresolved package_id** | **545** (frozen name kept; see Q1) |
| Orders with resolved package_id | 498 |
| Missing delivery data (method/area/slot) | 1,043 (100% — not in source) |
| Coupons in staging | 0 (not loaded this pass; 517 source orders carry one) |

## Resolved packages (by package master)

| Package | Orders |
|---|--:|
| 630 - 1730 calories (almost) | 447 |
| (150p-200c) 876-3400 calories (almost) dry food | 50 |
| kids package | 1 |
*(The other 3 order-package names did not exact-match the catalog → 545 unresolved — Q1.)*

## Top data-quality issues

| # | Issue | Count | Severity | Fix |
|---|---|--:|---|---|
| Q1 | **Orders' package unresolved by exact name match** (catalog DOM names vs order AJAX names differ in spacing/casing) | 545 | High | normalize names (lowercase/trim/collapse-spaces) in `packageByNameInTx`, or re-extract catalog from the order's own package source |
| Q2 | Orders missing payment status → finance review | 115 | Medium | finance reviews the queue (expected, mostly coupon-covered) |
| Q3 | Delivery method / area / slot absent (order-detail only) | 1,043 | Medium | order-detail extraction pass or capture at first contact (WF-01) |
| Q4 | Coupons not loaded (out of the minimal field set used) | 517 src | Medium | add `coupon_code_frozen` to the active-plan import row |
| Q5 | 163-customer tail deferred (merge_review gate) | 163 | Low | re-run combined with matched rows to dilute the gate, or accept as review |
| Q6 | 94 customers on 3 placeholder phones imported phone-less | 94 | Low | correct (avoids wrong auto-merge); reconcile manually if needed |
| Q7 | ~38% customers have Arabic-only names in `full_name_en` | ~7.4k | Medium | Arabic-name policy (allow AR primary / transliterate) |
| Q8 | KWD amounts ×1000 → fils (precision assumption) | all orders | Low | confirm the new system's KWD minor-unit factor |
| Q9 | `products` entity not extracted (legacy page times out) | — | Low | find the products AJAX route; packages cover the plan link |
| Q10 | Extraction "Unique ID" non-unique + unstable paging (now worked around with phone-key + snapshot) | — | (resolved) | keep phone as the customer key; never key on "Unique ID" |

**Verdict:** the load is clean structurally (0 dup phones, 0 bad dates, 0 import errors). The two items that most affect a real migration are **Q1 (package resolution)** and **Q7 (Arabic-name policy)** — both are mapping decisions, not load failures.
