-- 0036_kitchen_sticker_delivery_time.sql
-- WP-LBL-A101 — the delivery time a kitchen sticker prints, chosen on the Fleet-Ops "Kitchen Stickers"
-- form (owner 2026-11-06). The two values are the app's own slot names, so Batch Labels' time filter
-- groups WhatsApp stickers with the app orders of the same slot. Stickers saved before this stay NULL
-- (the label prints "-" as before) until someone picks a time.

ALTER TABLE kitchen_sticker
  ADD COLUMN delivery_time text
    CHECK (delivery_time IS NULL OR delivery_time IN ('From 5 AM to 4 PM', 'Before 1 day'));

COMMENT ON COLUMN kitchen_sticker.delivery_time IS
  'A101 Delivery Time printed on the sticker: From 5 AM to 4 PM, or Before 1 day (delivered the day before). NULL = not chosen yet.';
