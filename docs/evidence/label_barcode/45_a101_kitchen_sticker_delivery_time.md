# A101 — Delivery time on kitchen (WhatsApp) stickers

**Request (owner, 2026-11-06, with a photo of an app label showing "Delivery Time : From 5 AM to 4 PM"):**
when creating a WhatsApp sticker, choose the delivery time: "From 5 AM to 4 PM" or "Day before".

**Before (Verified):** WhatsApp labels printed `Delivery Time : -`. The kitchen-sticker form had no
time field, the WhatsApp feed sends `delivery_time: null`, so Batch Labels' time filter put every
WhatsApp sticker under "No time".

## Change

- Migration `0036_kitchen_sticker_delivery_time.sql`: `kitchen_sticker.delivery_time`, NULL or one of
  `From 5 AM to 4 PM` / `Before 1 day`. These are the app's own slot names (staging DB: 2,768 and 366
  orders), so a sticker lands in the same time-filter group as the app orders of that slot.
- API (m25-label): the sticker service accepts and validates it (anything else → `validation_failed`);
  the label prints `meta.label_delivery_time` of the Fleetbase order first, and the batch time filter
  uses it first.
- Kitchen Stickers page (extension 0.3.32): two buttons under the area's driver line —
  "From 5 AM to 4 PM / من 5 الصبح لـ 4 العصر" and "Day before / اليوم اللي قبله". Buttons, not a
  `<select>`: a raw select renders empty inside the Fleetbase host (A54.4). A new sticker starts on
  5 AM–4 PM; the live preview prints the choice.
- WhatsApp sync: `wa-labels-sync.sh` exports the column, `wa_manual_stickers.py` carries it,
  `nutreeze-wa-orders.php` stores it as `meta.label_delivery_time` (only the two values).
- **Existing stickers (24, 23 live) stay unset** and print "-" as before until someone opens each one
  and taps a time. No value was guessed for them.

## Tests

TS-I kitchen sticker (validation, save/edit, audit `changed_fields = delivery_time`), TS-I label
(A101: chosen time prints and drives the time filter; empty value falls back), TS-U page (buttons,
preview, new sticker default), TS-U extension version 0.3.32. Local: TS-U 235 passed, TS-I 143 passed,
lint, typecheck, cross-module scan clean.

## Release (2026-11-06)

1. `pg_dump` of `kitchen_sticker` → `/root/a101/kitchen_sticker-pre-a101.dump`; migration 0036 applied
   in one transaction (24 rows, 0 with a time).
2. API `nutrezee-api:a101-c869cd3` (rollback tag `nutrezee-api:pre-a101-20261106` = a99), health OK.
3. Scripts in `/opt/fleetbase/integrations/whatsapp-subscribers/` (backup `bak-a101/`), PHP lint OK.
   Sync for 2026-11-07: dry-run 56 rows / 56 with a driver / 0 failures, then apply: 56 updated, all
   carry `label_delivery_time` (null until chosen).
4. Console `0.7.48-a101.1` (extension 0.3.32) — see addendum.

Rollback: `docker tag nutrezee-api:pre-a101-20261106 nutrezee-api:latest` + compose up api; copy the
three scripts back from `bak-a101/`; the column can stay (NULL = old behaviour).
