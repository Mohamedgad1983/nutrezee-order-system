# 26 — A70: one order with parallel Partner delivery rows no longer blocks a whole day's Fleetbase sync

**Date:** 2026-09-29. **Owner:** "انا عايز استخدم fleetbase print من غير اي خطا" / "انا عايزهم يشتغلوا".
The A69 nightly email was cancelled by the owner the same morning ("الغي الايميل … لانك لم تحل المشكله"):
`nutreeze-print-readiness.timer` disabled on the VPS (unit files kept; `nutreeze-legacy-screen-check.timer` still enabled, writes a file only).

## Problem — Verified
- Rolling sync 2026-09-29 00:25 Kuwait: 09-30 completed (865 → 863 assigned, 2 held), then **2026-10-01 failed**
  at `daily_contract_validation` with `contract_daily_delivery_duplicate_ambiguous` → the whole day was not
  written. 10-01 is the day whose labels print at 01:00 on 09-30.
- Cause (read-only Partner API probe, personal fields masked): order **29977** (`order_id` 29025) has **three**
  delivery rows for 10-01 (`delivery_id` 403219/403220/403221) — same customer, address, driver, slot, status
  `ordered`, identical `updated_at` 2026-09-28T11:46:28+03:00, meal counts **8 / 4 / 4**. The fail-closed
  collapse rule only accepted identical counts or one positive row superseding zero-meal rows.
- The other 12 duplicate groups on 10-01 already collapsed correctly (identical counts, newest wins).

## Change — `ops/fleetbase/nutreeze-orders.php` `buildDailyDeliveryRows`
New branch, checked before the existing ones: when every row of a group has the same identity (already
enforced), **one** meal status, **one** `updated_at`, and every row has meals > 0, the rows are parallel
instances of the same drop → one Fleetbase job, `meal_item_count` = sum (16 for 29977), all
`source_delivery_ids` kept. Every other case (different timestamps, zero-meal mixes, identity conflicts)
still fails closed exactly as before. New self-test for the 8/4/4 case.

## Verification — Verified on the VPS
- `--self-test`: 43/43 passed (candidate and installed file).
- Dry-run 2026-10-01: `complete`, **844** orders (858 rows); dry-run 2026-09-30 unchanged (865).
- Label feed dry-run 2026-10-01 (`partner-daily-feed.mjs`, no writes): 844 distinct, created 33 / matched 811, 0 errors
  (it already handled the rows). 239 orders had no Partner driver yet at 07:17 Kuwait (normal before the manager assigns).
- Installed SHA-256 `101f501058672210cb4a09ef750715e5eba3dae90e31545142c3e320b5cc95dd` (= repo copy); mode 700 root kept.
- [NC] Confirm after tonight's 00:25 run that 10-01 completes in the journal.

## Rollback
`cat /root/a70/nutreeze-orders.php.bak-20260929T041629Z > /opt/fleetbase/api/storage/app/integrations/nutreeze-orders.php`
(previous SHA `49b0cf6c…c54a`).
