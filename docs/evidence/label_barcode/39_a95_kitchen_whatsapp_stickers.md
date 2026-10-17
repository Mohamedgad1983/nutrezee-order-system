# A95 — the kitchen's WhatsApp stickers print from Batch Labels (2026-10-17)

**Owner (2026-10-17):** sent `nutreeze stickers 19 Oct.pub` — the Publisher file the kitchen prints for WhatsApp subscribers — and asked to print them from the system with our label design, driver assigned by area.

**The file (Verified):** 16 stickers + 1 empty template. Each has name, mobile, address, start/end date, meal plan (meals + snacks, breakfast), protein/carb grams, AREA number, BOX number and long diet notes (41–467 characters). Every sticker also carries the kitchen's own three numbers and one staff name (not customer data).

**ERPNext (Verified, read-only):** only 2 of the 16 are on ERPNext's WhatsApp list for 2026-10-19 (90903039, 98000802 — the latter without an area, so it had no driver); the others have no active subscription there or no record at all. So the file itself is the list.

**Change:**
- `ops/fleetbase/whatsapp-subscribers/wa_manual_stickers.py` — `import` reads the Publisher text into a root-only list `/root/a71/manual-stickers.json` with a first day; `merge` adds it to the day's ERPNext export (no Fridays, from the first day on). A subscriber already on the export (same phone) keeps ERPNext's row and gets the sticker's notes, grams and box; a missing ERPNext address is taken from the sticker.
- `wa-labels-sync.sh` runs the merge after the export; `nutreeze-wa-orders.php` carries `label_notes`, `label_user_id` (BOX), `label_meals_per_day`, `label_snacks_per_day` in the order meta; the plan line is `<plan> · Protein Xg / Carb Yg · Breakfast N`.
- `m25-label/label.service.ts` prints them (notes up to 900 characters; the notes box shrinks its font to fit). Partner orders carry none of these keys — unchanged (2026-10-18 built with old and new image: identical, 949 labels).
- area spelling `alsiddeq` → `siddiq`.

**Verified on 2026-10-19:** WhatsApp labels 34 → 48 (14 added, 2 enriched); 47 with a driver from the area's driver that day; the one without is an existing ERPNext subscriber in Al Qusor (unchanged). Each of the 16 labels shows its BOX as User ID, meals/snacks, protein/carb and the notes. Stored text checked byte by byte (UTF-8).

**Deployed:** API `nutrezee-api:a95-5b1cf6a` (rollback `nutrezee-api:pre-a95-20261017`); scripts in `/opt/fleetbase/integrations/whatsapp-subscribers/` (backup `bak-a95/`); the 30-minute WhatsApp timer applies the list to the next two days from now on.

**[NC] for the owner:**
- the list keeps applying to every delivery day from 19 Oct until a newer file replaces it;
- days remaining comes from the sticker's end date; four stickers have an empty or past end date (8658, 8841, 8754, 6887), so their figure is not reliable;
- box 8658 (mobile 97118359) also has a regular legacy order on 19 Oct — two labels for one customer unless one is dropped;
- not shown on our label: the AREA number of the sticker.

---

# A96 — WhatsApp tab on Batch Labels (2026-10-17)

**Owner:** "a separate WhatsApp tab inside Batch Labels; print the 16 from it."

**Change:** the page has two tabs above the filters — *Delivery orders / طلبات التوصيل* (the legacy batches: driver, area, time, order) and *WhatsApp / واتساب*. The WhatsApp tab's only choice is the group: *Kitchen stickers / ستيكرات المطبخ* (WhatsApp labels carrying the kitchen BOX number, i.e. the A95 list) — opened first — or *All WhatsApp subscribers*. API: `filter_value = whatsapp_kitchen` selects them; options give `whatsapp_kitchen_total`, `orders[].kitchen`.

**Tests:** `ts-u-batch-label-filters` (A96 tab flow), `ts-u-kitchen-sticker-filter` (API group). Console `0.7.48-a96.1`, extension `0.3.27`.

**A96.1 (same night):** owner — 90908830 printed as "Muhammad", should be Mosaed. The label database keeps the first name it saw for a phone (ERPNext placeholders: "Muhammad - 64", "Subscription", "Hhh", the phone number). Now the kitchen sticker's name wins in the merge, the writer carries `label_full_name`, and the label prints it. Monday 2026-10-19 after the change: all 16 kitchen stickers print the name on the sticker (9 were wrong before). Other WhatsApp labels print ERPNext's current name. API `nutrezee-api:a961-b42a988` (rollback `pre-a961-20261017`).
