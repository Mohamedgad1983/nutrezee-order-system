# 47 — A107: two label issues reported by the owner (2026-11-23 → 25)

## 1. "Naseer shows 48 but only 47 print" — not a system loss (Verified)

- Group = driver **Naseerahmed Muhammad Tufail**, delivery time **From 5 AM to 4 PM**: 48 orders on both
  2026-11-24 and 2026-11-25 (plus 5 "Before 1 day" and 3 WhatsApp, printed separately).
- Batch Labels options and preview for 2026-11-24 both return 48. No duplicate order, customer or barcode; every label
  has a barcode. The day check that night: 848 labels = 848 legacy orders, 0 differences.
- Print layout simulated in the live page (print-mode rules on a clone of `.nz-batch-panel .nz-batch-labels`): 48
  `article.nz-batch-label`, each exactly 100 mm tall at the 150 × 100 mm sheet, none overflowing, tops at 0/100/200 mm.
  The page hands the printer 48 pages.
- Conclusion: the missing sticker is lost at the printer (last label left inside, first label wasted, or gap sensor).
  Asked the owner which label was missing. A trailing blank feed page was offered, not built.

## 2. Three labels with the same name and barcode (fixed in data)

**Symptom (owner photos, Thursday 2026-11-26, driver Amandeep):** orders 32785, 32786 and 32787 all printed
"leena ." and barcode `NZC-T3MB-0CW6-E4`, while User ID (6284 / 6285 / 6281) and phone differed.

**Cause (Verified):** the three orders were imported on 2026-11-16 in one batch under phone 96963120 and name
"leena .", so the importer (customers keyed by normalized phone) created one customer for all three. Between
2026-11-21 and 2026-11-23 Partner gave each order its own customer:

| order | Partner code | Partner name | Partner phone |
|---|---|---|---|
| 32785 | 6284 | Lina Al Khabbaz . | 90027828 |
| 32786 | 6285 | faris . | 66766200 |
| 32787 | 6281 | tala shlash | 96963120 |

The importer never re-links an existing order to a new customer. The label takes User ID and phone from Partner, but
the name and the permanent barcode (`customer_barcode`, one per customer) from the local customer, so all three
shared them.

**Scope (Verified):** 2026-11-26 (724 orders) and 2026-11-28 (641) compared with Partner: this family is the only
local customer carrying orders of more than one Partner customer. Other phone mismatches (6 orders) keep the right
name; their printed phone comes from Partner.

**Fix (owner approved 2026-11-25):**
- Snapshot `/opt/nutrezee/backups/pre-a107-split-20261125-180321.sql.gz` (840 MB).
- `/root/a107/split-32785-32786.sql`, one transaction with guards: 2 new customers + primary phones + `sync_record`
  customer rows in the importer's key form (`+966…`), orders 32785/32786 re-linked, the original customer renamed
  "tala shlash" (her phone, order 32787 and barcode kept), 3 `audit_event` rows `customer.split_correction` in the
  same transaction. The orders had no print, packing, route or meal-history rows to move.
- Fleetbase carries no `label_full_name` for these orders, so the label uses the corrected local name.

**After (Verified 2026-11-25):**

| order | label name | phone | barcode |
|---|---|---|---|
| 32785 | Lina Al Khabbaz . | +96690027828 | NZC-H5YG-4CK4-DP |
| 32786 | faris . | +96666766200 | NZC-WPYB-ZYD8-NR |
| 32787 | tala shlash | +96696963120 | NZC-T3MB-0CW6-E4 |

**Not seen:** the corrected labels were not checked on paper after the fix.

## 3. Importer follows the split from now on (owner approved 2026-11-25)

Partner already gave the three orders different customer ids (`customer_ref` 27136 / 27137 / …, stamped on every
mirrored day); only the phone was shared on 2026-11-16. The Partner daily importer now checks every EXISTING order:

- the row's phone (normalized) belongs to a customer other than the order's current one, **and**
- the current customer carries days of another Partner `customer_ref`

→ the order moves to the customer of its own phone (found, else created with the Partner name and a `sync_record`
customer key), through `OrderService.relinkImportedCustomerInTx` (m03 owns `customer_order`), with an
`order.customer_relinked` audit row (warn) in the same transaction. The row message is `customer_relinked:created` or
`customer_relinked:existing`, so the dry-run shows it before apply.

Left alone on purpose: one Partner customer who only changed phone (same `customer_ref`, e.g. order 31581), a family
still sharing one phone in Partner, and any unreadable phone (A99 placeholder).

Tests: TS-I `ts-i-partner-daily-import` new last case (own dates 2099-09-25/26): shared phone → created customer,
→ existing phone owner, the phone-keeper stays, a phone-only change stays, three distinct barcodes, two audit rows,
nothing in the dry-run trail, re-run moves nothing. Local run (PostgreSQL 16): 87 files / 515 tests green.

## 4. Deploy (2026-11-26)

- PR #137 merged `8720219` (CI 30/30). API image `nutrezee-api:a107-8720219` built from `/opt/nutrezee/a107-src-8720219`,
  tagged `latest`, `up -d --no-build api`; running image verified, 0 restarts, `/health` and `/nz/health` 200, built
  `importers.js` contains `customer_relinked`. Rollback `nutrezee-api:pre-a107-20261126` (= the previous running image).
- Found while deploying: the feed runner (`ops/sync/partner-daily-feed.mjs`) applies a day only when the dry-run shows
  new orders or day changes, so a re-link alone would never be applied. A107.2: the dry-run summary lists
  `customer_relinked` rows and a day with any of them is applied.
- Dry-run with the A107.2 runner on real data (2026-11-26/28/29/30): matched 722/637/590/539, 1 created, 0 errors,
  **0 re-links** (the only shared family was already split by hand).
