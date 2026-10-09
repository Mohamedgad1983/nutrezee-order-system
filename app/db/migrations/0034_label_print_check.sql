-- 0034_label_print_check.sql
-- WP-OPS-A85 — the result of every "Batch Labels vs legacy screen" check, so the print page itself
-- shows whether the labels match the legacy admin right now, and an operator can ask for a fresh
-- check before printing. Order numbers only; no customer data.

CREATE TABLE label_print_check (
  id               text PRIMARY KEY,
  delivery_date    date NOT NULL,
  status           text NOT NULL CHECK (status IN ('requested', 'ok', 'differences', 'failed')),
  requested_by     text,                     -- operator who pressed "check now"; NULL for scheduled checks
  requested_at     timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  screen_orders    integer CHECK (screen_orders IS NULL OR screen_orders >= 0),
  labels           integer CHECK (labels IS NULL OR labels >= 0),
  differences      integer CHECK (differences IS NULL OR differences >= 0),
  without_driver   integer CHECK (without_driver IS NULL OR without_driver >= 0),
  whatsapp_labels  integer CHECK (whatsapp_labels IS NULL OR whatsapp_labels >= 0),
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((status = 'requested') = (finished_at IS NULL))
);

CREATE INDEX label_print_check_day_idx ON label_print_check (delivery_date, finished_at DESC);
CREATE INDEX label_print_check_open_idx ON label_print_check (requested_at) WHERE status = 'requested';

COMMENT ON TABLE label_print_check IS
  'A85 print guard results. Requests are written by m25-label; results by the owner-run host check (print-status.py), which is the only reader of the legacy screen.';
