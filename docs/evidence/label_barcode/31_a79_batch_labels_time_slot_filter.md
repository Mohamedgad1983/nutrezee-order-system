# 31 — WP-OPS-A78.3 / A79: the day's time slot on the label and as a Batch Labels filter

**Date:** 2026-10-08 · **API:** `nutrezee-api:a79-45d2c05` (rollback `pre-a79-20261008`) · **Console:** `fleetbase-console:a79-1`, extension 0.3.22 (rollback `pre-a79-20261008`)

## Trigger

Owner's video of the legacy *Driver Orders* screen for Saturday 2026-10-10: the Time Slots filter gives 617 orders "From 5 AM to 4 PM" and 157 "Before 1 day"; stickers are printed per slot.

## A78.3 — wrong time on the label (Verified)

Partner `daily-deliveries` for the day matches the screen exactly (617 / 157, plus 1 without a slot). The label printed `customer_order.delivery_time_frozen`, written once on the order's first imported day. Compared per order with the day's Partner row:

| Day | labels with the wrong time | wrong delivery method |
|---|---|---|
| 2026-10-08 | 128 | 7 |
| 2026-10-10 | 85 | 7 |

All of them printed "From 5 AM to 4 PM" where legacy says "Before 1 day". Fix: time slot and delivery method come from the day's Partner row (PR #105, merged), stored value as fallback.

## A79 — filter

- API: batch candidates carry `timeKey` / `timeLabel` (the same value the label prints); options return `time_slots` and `orders[].time_id`; preview/printed accept `filter_type: "time"`.
- Console (Batch Labels): "Filter by" gains **Delivery time** (one whole slot across the day, printed grouped by driver then area), and inside Driver or Area a **Delivery time** dropdown (All times / one slot) that stays selected while moving from driver to driver.

## Verification

- Unit `ts-u-batch-label-filters` 11/11 (3 new), integration `ts-i-label-barcode` 27/27 (1 new), typecheck, lint, scans; release gate 13/13; candidate console booted in a real browser before the swap.
- Deployed service, real Fleetbase rows 2026-10-08: 693 "From 5 AM to 4 PM", 213 "Before 1 day", 32 without a time (WhatsApp subscribers), 1 with an older slot text (order not in Partner's day list). Selecting "Before 1 day" returns 213 labels and every one prints "Before 1 day".
- Saturday 2026-10-10 after the screen check run at 16:47 Kuwait: legacy screen 774 orders, 187 of them without a driver in legacy → Batch Labels 587 = screen 587, plus 33 WhatsApp.

## Open

- Not yet used on paper by the print team.
- The night check covers "tomorrow" only. If Saturday's stickers are printed on Thursday, the check and sync for Saturday must also run on Thursday — to confirm with the owner.
- "First Day" filter of the legacy screen is not built (owner asked for the time filter only).
