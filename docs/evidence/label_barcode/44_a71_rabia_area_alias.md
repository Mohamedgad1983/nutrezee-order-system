# 44 — A71: "Rabia" area alias (2026-11-05)

**Report (owner, 2026-11-05):** two kitchen stickers were added on the Kitchen Stickers page, but Batch Labels → WhatsApp → Kitchen stickers for 08-11-2026 printed 10 instead of 12.

## Findings (Verified)

- The two new `kitchen_sticker` rows: BOX 9059 (Sabah Al Salem) and BOX 7070 (entered area "Rabiya"), both `start_date` 2026-11-07.
- Neither was on the print screen until the next WhatsApp sync, which ran at 02:34Z and created both Fleetbase orders for 8 Nov.
- BOX 7070's merged row carries the area **"Rabia"** (ERPNext address). Partner's area for that day is **"Rabiya"**. `areaKey("Rabia")` matched neither the day's Partner areas nor the area memory, so the sync logged `no_driver_areas: ["Rabia"]`.
- A WA order with no driver is written with `scheduled_at = NULL` (`nutreeze-wa-orders.php`), so it is missing from that day's Batch Labels, not shown as "no driver".

## Fix

- `nutreeze-wa-area-aliases.json`: `"rabia": "rabiya"`. Applied on the VPS first (backup `nutreeze-wa-area-aliases.json.bak-20261105`); this commit keeps the repo in sync.
- Re-ran `wa-labels-sync.sh 2026-11-07 apply` and `… 2026-11-08 apply`:
  - 7 Nov: 55 rows, `with_driver` 55, `no_driver_areas` []
  - 8 Nov: 52 rows, `with_driver` 52, `no_driver_areas` []
- Fleetbase check: BOX 7070 is `dispatched` with a driver on 7 and 8 Nov. Kitchen stickers (WA orders carrying a box number): **14** on 7 Nov and **12** on 8 Nov.

## Follow-up note (Inferred)

A missing driver hides the sticker entirely. The night email already lists `no_driver_areas`, and that list is the place to look when a count is short.
