# 26 — A70: nothing stops the night print — Partner rows repaired, failed days retried, every ready label printable

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

## A70.2 — owner: "كل حاجه ممكن توقف الطباعه حلها مفيش حجاه اسمها ان الطباعه تقف" (same day)

### What stopped days in the last month — Verified (journal 2026-08-25..09-29)
| Failure | Count | Effect before | Now |
|---|---|---|---|
| `contract_daily_delivery_duplicate_ambiguous` (one order, several rows) | 78 | whole day not written | newest row used (parallel rows summed), order logged |
| `contract_routing_area` (one order with no area) | 62 | whole day not written | row repaired (`Unknown area`), order logged |
| `DeadlockException` at ~01:06 Kuwait (evening run vs rolling run) | 16 | day not written | date retried (3 attempts, 90 s apart) |
| `integration_lock_busy` at ~02:05 Kuwait (evening vs same-day) | 20 | day skipped | date retried |
| `vendor_daily_window` / `source_read_failed` | 30 | day skipped | date retried (the window refusal itself is by design for dates Partner does not serve) |

### Sync (`nutreeze-orders.php`)
- `repairDailyDeliveryRow`: a row failing the strict contract is repaired field by field with neutral,
  **deterministic** values (dry-run and write keep the same digest) and validated again. Logged as
  `daily_contract_issues` with order number, field names and error code only — no customer data.
  Only a row without `order_id`/`order_number` is excluded (it cannot be matched to anything).
- Any duplicate shape (identity conflict, stale meal row, ambiguous) → newest instance, reported.
- Shared order number and future timestamps → reported, no longer fatal.
- Kept fail-closed on purpose: incomplete Partner page set (`vendor_daily_distinct_order_mismatch`,
  completeness mismatch) — writing a partial set would withdraw real orders. A failed run leaves the
  last good Fleetbase set in place (evening runs refresh tomorrow hourly until midnight).
- Self-test 43/43, including a field-by-field fuzz (17 broken fields, each still yields the order with a
  stable digest). Real-data dry-runs 09-30 (865) and 10-01 (844): identical counts and digests to the
  previous file.

### Scheduler (`daily-sync.sh`, units)
- Each date: up to 3 attempts, 90 s apart (`horizon_date_retry` event). Tests 38/38 on the VPS
  (new: persistent failure = 3 attempts then reported; one-off write failure = retried, day completes).
- `TimeoutStartSec`: rolling + same-day 45 → 100 min, evening 45 → 60 min (room for retries).

### Batch Labels (Nutrezee API `m25-label`) — owner rule replaces the earlier fail-closed rule
- Unmapped Fleetbase orders no longer block: `ready` = day has orders and at least one mapped label;
  the page summary still shows *Fleetbase orders that day* vs *Labels fully mapped*.
- An assigned driver with no phone / plate / colour prints with that field empty instead of failing the
  whole page (`fleetbase_driver_label_identity_incomplete` removed).
- Partner meal source unavailable / no rows / incomplete nutrition → label prints with the existing
  "No dish detail recorded for this date" table (`no_dish_source`); it no longer blocks render or the
  batch confirmation.
- Tests: 95/95 label-related (TS-U + TS-I) locally on PG16; typecheck, lint, both scans pass.

### Installed — Verified 2026-09-29 ~07:35 Kuwait
- `nutreeze-orders.php` SHA-256 `d45d9ec7…61704`, `daily-sync.sh` `a95e7839…a46a5` (= repo), mode 700 root.
- API image `nutrezee-api:a70-3ebcd62` (`ce5956847c79`), recreated with `--env-file /opt/nutrezee/.env`;
  container env fingerprint identical before/after; `/health` 200, `/nz/health` 200, restarts 0.
- Rollback: `/root/a70/bak-*/` (PHP, daily-sync.sh, 3 units) and image `nutrezee-api:pre-a70-20260929`
  (= a56-6dbf641): `docker tag nutrezee-api:pre-a70-20260929 nutrezee-api:latest` then the same
  `compose --env-file … up -d --no-deps api`.
- Not changed: Console extension (the page text "Batch printing is blocked" can no longer appear because
  `ready` is true whenever labels exist). [NC] owner to open Batch Labels → Tomorrow and confirm.

## A70.3 — the legacy admin screen is the reference (owner, same day)
Owner: "ليه ما تخليش legacy app هو المرجع … بقالهم ٣ سنوات شغالين ومفيش مشاكل" → approved "أيوه اعمله دلوقتي قبل الليلة",
short status email to it@nutreeze.com only.

### Flow (Kuwait time)
1. **00:25** rolling run (and 02:00 same-day run): `legacy-screen-manifest.py` reads *Orders Driver Wise* for the print day
   (tomorrow) with the owner-installed Playwright runner (read-only, ~70 s) and writes the root-only
   `config/legacy-screen-YYYYMMDD.json`: order numbers + the legacy driver id shown per order (verified: the screen's driver
   option values are the Partner `driver.id` values, e.g. 122…19033). Written only from a complete, error-free reading;
   otherwise the old file is removed and the sync uses Partner alone.
2. The full sync for that day runs with `--legacy-screen-manifest` (file ≤ 6 h old; never in daytime cancel-only runs):
   - screen order → the screen's driver; on hold / cancelled in Partner but on the screen → delivered;
   - Partner order not on the screen → held by the existing source-missing path (never deleted);
   - screen order Partner does not return at all → reported (cannot be created from the screen).
   Logged as `legacy_screen_applied` (order numbers only).
3. **00:52** `nutreeze-print-status.timer` → short email to it@nutreeze.com: Fleetbase vs screen, drivers, label DB,
   what changed tonight.
- Disabled: `nutreeze-legacy-screen-check.timer` (00:45, fed the cancelled A69 email). `nutreeze-print-readiness.timer` stays disabled.

### Verification — Verified 2026-09-29
- PHP self-test 43/43 incl. new legacy-screen test (driver override, hold release, Partner-only held, screen-only
  reported, digest guard). Scheduler tests **45/45** (new: capture runs for the print day before a rolling run, fresh
  screen file replaces the driver-orders manifest, stale file ignored). Pre-existing `! grep` assertions were no-ops under
  `set -e`; converted to real checks — all pass.
- Dry-run 2026-09-30 with the screen (read-only; today's file removed afterwards): **28798** (on hold in Partner, on the
  screen under Nicholas) → delivered; **26262** (Partner only) → held; result 864 = screen 864.
- **2026-10-01 loaded now** (it had never been written: the 00:25/01:00 runs failed on 29977 before A70):
  screen read 07:03 CEST = 844 orders, 726 with driver; **121 orders had the driver on the screen but not yet in the
  Partner snapshot** → written with the screen's driver. Result: 844 in Fleetbase, 726 dispatched, 118 waiting for a
  driver (as on the screen), `daily_verification.passed=true`, 10 min.
- First status email sent to it@nutreeze.com (manual note). 20 orders not yet in the label DB: the label feed covers
  today/tomorrow only; 10-01 is fed from 00:20 tonight.

### Installed
`/opt/fleetbase/integrations/nutreeze-orders/{legacy-screen-manifest.py, print-status.py, run.sh (new option allowed),
daily-sync.sh}`, `nutreeze-orders.php`, `/etc/systemd/system/nutreeze-print-status.{service,timer}` (enabled). Screen runner
script updated to record the driver id. Rollback: `/root/a70/bak-20260929T050201Z/`; disable `nutreeze-print-status.timer`;
delete `config/legacy-screen-*.json` (the sync then follows Partner alone).

## A70.4 — an order never stays "without a driver" without asking the legacy admin (owner, same day)
Owner: "مفيش حاجه اسمها اورد بدون سواق لما تلاقي كده حدث الاورد مباشره من legacy web".
- Verified on the legacy screen: the table's "Driver" column holds only row links (Meals / Delivery Sticker / Meal
  Sticker), no driver name; the driver appears only through the driver filter. The **Delivery Sticker** of an order prints
  `Driver ID <code>` (e.g. `A7` = Arsad Ali; the A-codes are already in the partner-driver map).
- The screen runner now keeps each order's Delivery Sticker link and, for every order under no driver filter, opens its
  sticker (same read-only session) and records the code (`sticker_drivers`). The manifest uses that code as the order's
  driver; only an order whose own legacy sticker shows `Driver ID -` stays without one (`no_driver_in_legacy`).
- 2026-10-01 at 08:21 Kuwait: screen 844, 843 with driver. The one left, **29384**, is customer "Testing do not deliver"
  in the legacy admin: no driver on its order page ("Select Driver") and `Driver ID -` on its sticker → a legacy test order,
  nothing to take. The status email names such orders as "no driver in the legacy admin itself".
- Oct 1 re-synced from the 08:21 screen (Partner had caught up: 0 driver changes needed).

## A70.5 — test orders removed from printing (owner: "شيل طلبات التجربة من الطباعة")
- The screen runner flags orders whose legacy customer name matches `do not deliver` / `test` / `testing` / `تجرب`
  (only order numbers leave the browser). The manifest drops them from the day (`test_orders_excluded`); the sync then holds
  them like any order not on the screen (unassigned, not dispatched), and Batch Labels already skips held orders.
- 2026-10-01: **29384** ("Testing do not deliver") removed. The status email lists removed test orders.

## A70.6 — zero-difference print guard (owner: "انت اللي تتأكد … نسبة الخطأ تكون zero")
- **00:45 Kuwait** `nutreeze-print-status.timer` (moved from 00:52) waits until no Partner sync is writing, then computes
  what the Batch Labels page will offer for tomorrow **with the page's own compiled code** (`LabelService.batchCandidates`
  inside `nutrezee-api`, `batch-labels-count.js`), fed the same Fleetbase rows the page reads (DB instead of the operator's
  API token; the day/held/cancelled filters are the page's `fleetbaseOrderDate`/`isHeldOrCancelled`).
- Compares order by order with the legacy screen: on screen without label, label not on screen, driver ≠ screen driver.
- Any difference → automatic repair (up to 2 rounds): read the screen again + re-sync the day to it; run the Partner label
  feed for the day (fills orders missing from the label database). Then check again and email it@ only:
  `[OK] Labels <day>: Batch Labels N = legacy screen N` or `[CHECK] … <k> difference(s)` with the order numbers.
- 2026-10-01: before → page 843 orders / **810 labels** (33 orders not yet in the label DB, fed only from midnight); label
  feed applied for 10-01 now (created 33, error 0) → **Batch Labels 843 = legacy screen 843, difference 0**. Full guard run
  (with repair enabled, nothing to repair) sent the email to it@.
- Not verified yet: a repair round on a real difference (runs the same commands used manually today). The literal browser
  page needs a Fleetbase operator login; this guard uses its code without one.

## A70.7 — first real night (2026-09-29 → 09-30): three defects found and fixed
Guard email at **01:20** Kuwait: `[OK] Labels 2026-10-01: Batch Labels 836 = legacy screen 836` — correct, but only through
the guard's own repair and 20 min after the 01:00 print. Journal:
1. **Screen reading failed inside the sync** (`legacy_screen_manifest_skipped … no_fresh_reading`, runner exit 1 at 00:26,
   01:00 and 02:00): `run-legacy-check.sh` ran `chmod` on the credential file, and the sync units have `ProtectHome=read-only`.
   Fix: check the mode instead of changing it. Verified with `systemd-run` using the units' sandbox: success in 1 min 18 s.
2. **Partner fallback then stopped 10-01** (`daily_operational_state_guard`, all 3 attempts at 00:26, 01:00, 02:00): the orders
   held the day before because they were not on the screen (source-missing tombstones, e.g. 29384 and 9 others) were back
   in the Partner-only source, and a `canceled` tombstone could never become active again. Fix
   `isReactivatableMissingTombstone`: a `canceled` order with `hold_reason=source_row_missing`, never dispatched or started,
   may be dispatched again (pre-check + writer). Self-test 43/43 (+ reactivation unit check).
3. **Guard timing / false "FAILED"**: with no screen file the guard re-read and re-synced twice (00:45 → 01:20). The label
   feed prints `partner_daily_applied` only when it adds something, so "complete, nothing to add" was reported as FAILED.
   Fix: success = `partner_daily_complete` with 0 failures; the guard now always completes the label database first.
   A failed screen reading now keeps the last good file (used only while < 6 h old) instead of deleting it.
- **Rehearsal 2026-09-30 10:50–11:09 Kuwait** (`systemd-run` with the sync units' exact sandbox, rolling targets 10-01/10-02):
  screen read inside the sync (836 orders, all with driver, test order 29384 removed) → 10-01 synced to the screen
  (836 = 836, verified, no retry) → 10-02 zero-day OK → `horizon_complete 2/0`, 18 min. Guard afterwards: **14 s**,
  label database already complete, `[OK] Labels 2026-10-01: Batch Labels 836 = legacy screen 836`, email to it@.
