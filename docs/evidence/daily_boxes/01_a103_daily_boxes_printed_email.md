# A103 — Daily 09:00 email: boxes printed last night (2026-11-09)

**Request (owner):** every day at 9 AM email Ahmad Ibrahim (ahmad@nutreeze.com) and a.mahran@nutreeze.com an Excel sheet with the number of boxes actually printed.

**What "printed" means (Verified):** labels are printed at 01:00 Kuwait for the NEXT delivery day (A70 print check). At 09:00 on day X the printed set is delivery day X+1 = the Fleet-Ops orders of that day that are not cancelled (`NUTREEZE-PARTNER-DAY-<day>` app orders + `NUTREEZE-WA-DAY-<day>` WhatsApp subscribers). This is the set Batch Labels offered and the print check matched to the legacy screen (2026-11-10: Batch Labels 1008 = legacy screen 1008 + WhatsApp 57).

**Owner correction (same day):** no area or driver breakdown — only boxes (subscriptions = app, and WhatsApp) and the number of salad and fruit dishes.

**Dishes (Verified 2026-11-10):** Partner `order-items?delivery_date=` (same key as the labels) — 4,476 items for exactly the 1,008 printed app orders. Salads = kitchen section `salad` + any dish named "… salad" except fruit salad → 669 (Chicken Caesar 252, Fatoush 96, Asian 83, Chef 71, Date 56, Haloumi Tabbouleh 49, Edamame 33, Veggie crudités 29). Fruits = fruit dishes by name, excluding desserts/drinks that only carry a fruit name (blueberry cheesecake, juices) → 352 (Pineapple 112, Mango 77, Banana 44, Pomegranate 41, Fruit salad 40, Grapes 26, Green apple 12). WhatsApp boxes have no dish list in Partner, so their dishes are not counted.

**Owner (same day): only what is really delivered.** Operations report labels printed for customers whose subscription had ended, pulled by hand after printing. Checked (Verified):
- Tomorrow's 1,008 printed app orders against Partner `subscriptions`: all 1,008 active and covering 2026-11-10 (0 ended, 0 deleted, 0 not started).
- Orders cancelled AFTER the 01:00 print, 1–10 Nov: 0–8 app + 0–2 WhatsApp per day, all `source_row_missing` (the delivery row disappeared upstream after printing: pause/freeze/stop in the app, or the ERPNext WhatsApp subscription ended — e.g. WA-96695474 on 9 Nov).
- The email therefore counts only orders still active at 09:00, and adds a **Pull these labels** sheet + line: orders printed at 01:00 and cancelled afterwards (cancel time ≥ print time). 2026-11-10: 2 (32450, 31008); 2026-11-09: 4.
- Limit: cancellations after 09:00 cannot be in that morning's email.

**Script:** `ops/daily-boxes/daily-boxes-email.py` → VPS `/opt/nutrezee/daily-boxes/`. Read-only (Fleetbase MySQL). Sheet: Summary (app boxes, WhatsApp boxes, total to deliver, printed-then-cancelled, salad dishes, fruit dishes), Salads, Fruits, Pull these labels (order number, source, driver, cancel time). Mail via the Fleetbase Laravel mailer (hello@nutreeze.com), same path as the renewal reports. No email when the day has 0 boxes (Friday). A run by hand never emails without `--send`.

**Timer:** `nutreeze-daily-boxes.timer` — `OnCalendar=*-*-* 09:00:00 Asia/Kuwait`, enabled 2026-11-09; log `/var/log/nutrezee/daily-boxes/run.log`, sheets kept in the same folder.

**Verified:** dry runs 2026-11-10 → app 1008 + WhatsApp 57 (13 kitchen) = 1065; 2026-11-08 → 985 + 54 = 1039; 2026-11-13 (Friday) → 0, skipped. Test sends to it@nutreeze.com: `sent` (final version 13:48 Kuwait). File opened with openpyxl: 3 sheets.

**Known limits:** Thursday double boxes (A98) are counted as one order each (the sheet counts orders/labels, not the second BOX 2 OF 2 sticker).

**Rollback:** `systemctl disable --now nutreeze-daily-boxes.timer`.
