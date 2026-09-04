-- 0031_label_reprint_reason_optional.sql
-- WP-LBL-A48 — owner decision 2026-09-03: labels may be reprinted any number of times without a
-- stated reason (stickers get damaged/reprinted routinely during packing). The append-only trail
-- (print_kind, barcode_value, printed_by, batch_ref, audit label.reprinted) remains the evidence;
-- `reason` stays as optional free text. Forward-only: only the CHECK is dropped, no data changes.
ALTER TABLE label_print_event DROP CONSTRAINT IF EXISTS label_print_event_check;
COMMENT ON TABLE label_print_event IS
  'WP-LBL-A27 (m25-label). Append-only print/reprint trail. Reprints unlimited, reason optional (A48, 2026-09-03). Stores the barcode printed, proving reprints do not change it.';
