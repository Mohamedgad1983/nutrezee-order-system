# 27 — A71: WhatsApp-system subscribers on Batch Labels (driver + barcode)

Date: 2026-10-06 (Kuwait) · Owner directive: "محتاج اضيف عناوين مشتركين الواتساب… بس اللي شغالين معانا علشان اطبع ليهم label"
— and, asked which label, the owner chose the same Batch Labels sticker with driver and barcode.

## What was wrong (Verified)
- The subscribers sold through the WhatsApp payment methods live only in ERPNext (`NTZ POS Subscription`, report
  *Subscriptions → Customer details and addresses*, source "WhatsApp"). They are not in the legacy admin / Partner feed.
- 38 such customers have a running subscription; 36 have an address in ERPNext, 2 do not (Abduwahab, Khaled Alharoun).
- None of the 38 had a delivery day in the label database for 2026-10-04 … 10-08 (matched by phone), so none could
  appear on Batch Labels: that page lists Fleetbase orders of the day that match a local `customer_order`.

## Rule for the driver (Verified on the day's data)
In the legacy assignment every area has exactly one driver per day: 99 of 99 areas on 2026-10-07. A WhatsApp subscriber
therefore gets the driver that serves their area on that day. Area names are matched after normalising, with an alias
list for the spellings used in ERPNext (`andlous`→`andalous`, `ghornata`/`granada`→`gharnada`, `hatten`→`hateen`,
`qairwan`→`qairawan`, `siddeq`→`siddiq`, and "X" ↔ "Al X"). An area not served that day falls back to the last driver
seen for it (`nutreeze-wa-area-memory.json`); with no driver the order is held and gets no label, and the status email
says so. Delivery days [Assumed, told to the owner]: every day inside the subscription except Friday and freeze periods.

## What was added (`ops/fleetbase/whatsapp-subscribers/`)
- `wa_subscribers_export.py` — read-only ERPNext export of the day's active subscribers (same customer set as the
  report). Refuses an empty list on a delivery day.
- `nutreeze-wa-orders.php` — a second, independent Fleetbase writer. Own prefix `NUTREEZE-WA-DAY-YYYYMMDD` and owner
  marker `nutreeze_whatsapp_subscribers`; own contacts, places, payloads and pickup place. Reads Partner orders only to
  learn the area's driver and centre. Orders are dispatched to the driver like Partner orders, pin = area centre with
  the standing "call customer" instruction. A subscriber no longer active for the day is cancelled, not deleted.
- `wa-label-feed.mjs` — label database rows through the governed M19 import (`/imports/partner_daily/dry-run` → `apply`),
  order number `WA-<phone>`, own temporary admin account.
- `wa-labels-sync.sh <day> [apply]` — runs the three steps; dry-run by default; customer list kept in a root-only file.
- `legacy-screen/nutreeze-print-status.py` — runs the WhatsApp step for the print day and counts `WA-` labels
  separately, so they are never a difference against the legacy screen. Subject: `… + WhatsApp N` or `… + WhatsApp CHECK`.

No API or console code changed; nothing deployed except these scripts. Nothing is written to ERPNext, Partner or legacy.

## Verification on staging, delivery day 2026-10-07
| Check | Result |
|---|---|
| Dry-run | 36 active subscribers, 34 with a driver, 2 without address |
| Apply | 36 Fleetbase orders created (34 dispatched across 8 drivers, 2 held), 36 label rows created |
| Second apply | no new rows; label feed "unchanged" |
| Nightly Partner sync for the day with the WhatsApp orders present | `source_orders 944, assigned 944, verified true` in 79 s |
| WhatsApp orders after that sync | untouched (34 dispatched, 2 held) |
| Label render (`POST /labels/render`) for all 36 | 36 × HTTP 200 with a customer barcode |
| Night check, full path, no email | `[OK] Labels 2026-10-07: Batch Labels 944 = legacy screen 944 + WhatsApp 34` in 2 min |

## Known limits [told to the owner]
- WhatsApp labels carry no meal list (`meal_source = no_dish_source`): ERPNext holds the plan, not the dishes.
- Block/street on a label come from the customer's stored address in the label database. 23 new customers print the
  area only (same as legacy labels); 13 returning customers print their stored address, and for one (Yousif) the stored
  block differs from ERPNext. Using the ERPNext address on the label needs an API change (not done here).
- The two subscribers without an address get no label until their address is entered in ERPNext.
- Server copy of the scripts: `/opt/fleetbase/integrations/whatsapp-subscribers/`; work files and log `/root/a71/`;
  previous night-check script kept as `print-status.py.bak-a70-11`.

## A71.2 — ERPNext address, plan and days left on the label; 30-minute sync (2026-10-06)
Owner: "كمل تعديل العنوان الكامل … واعمل sync للعملاء دول باستمرار علشان الطباعة تكون updated".

- **Label (`m25-label/label.service.ts`)**: a Fleetbase order may carry `meta.label_address` (area, block, street,
  building, flat, direction), `meta.label_package` and `meta.label_days_remaining`. When present they are printed
  instead of the stored address / package / computed days. Values are cleaned (control characters, 120 chars). Partner
  orders carry none of these keys, so their labels are unchanged (asserted in TS-I `ts-i-label-barcode`, 24/24).
- **Writer**: `nutreeze-wa-orders.php` sets those keys on every run from the ERPNext export (block, street, house,
  extra details, plan, service days left excluding Fridays), so an address edited in ERPNext reaches the next print.
- **Timer**: `nutreeze-wa-labels.timer` (every 30 minutes, `wa-labels-sync.sh auto apply`) keeps Kuwait tomorrow and
  the day after current; installed and enabled at the owner's request. The night check still runs the step itself for
  the print day and waits up to 5 minutes for a run in progress.
- First timer run: 2026-10-07 → 36 rows (34 with driver); 2026-10-08 → 34 rows (32 with driver); exit 0.

Still not on a WhatsApp label, because ERPNext does not hold it: the dish list with nutrition, delivery time slot,
delivery method, and an exact location pin.
