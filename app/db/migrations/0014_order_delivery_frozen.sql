-- Nullable frozen legacy delivery fields on customer_order (M03 owns this table).
-- Stores legacy per-order delivery method / time / area as an auditable migration
-- snapshot. Additive + nullable + backward compatible: existing rows stay NULL,
-- no behavior change, no operational delivery model (that remains the kitchen phase).
-- Forward-only (DEC-011). Safe for staging; never destructive.
ALTER TABLE customer_order
  ADD COLUMN delivery_method_frozen text,
  ADD COLUMN delivery_time_frozen   text,
  ADD COLUMN delivery_area_frozen   text;

COMMENT ON COLUMN customer_order.delivery_method_frozen IS
  'Frozen legacy delivery method (migration snapshot; not the operational delivery model)';
COMMENT ON COLUMN customer_order.delivery_time_frozen IS
  'Frozen legacy delivery time/slot label (migration snapshot)';
COMMENT ON COLUMN customer_order.delivery_area_frozen IS
  'Frozen legacy delivery area name (migration snapshot; also captured per-day in fulfillment_day.address_frozen)';
