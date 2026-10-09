# 34 — WP-OPS-A85: the print page checks itself against the legacy admin

**Date:** 2026-10-09 · **API:** `nutrezee-api:a85-f5353da` (rollback `pre-a85-20261009`) · **Console:** `fleetbase-console:a85-1`, extension 0.3.24 (rollback `pre-a85-20261009`) · migration `0034_label_print_check.sql` (backup `/opt/nutrezee/backups/pre-a85-20261009-*.sql.gz`)

## Trigger

Owner, after seeing a driver with 36 labels on Batch Labels while legacy showed 48 (the page was 6 hours behind): the result must be guaranteed, and the person printing must not have to check or press anything.

## What exists now

1. **Every check stores its result** (`label_print_check`: day, ok / differences / failed, counts, order numbers of the differences). Written by the owner-run host check `print-status.py`, the only reader of the legacy screen.
2. **The page asks by itself.** Opening Batch Labels for a day calls `POST /fleet-ops/labels/print-check`; when the latest result is older than 10 minutes a request is recorded. `nutreeze-print-check-requests.timer` looks every minute and runs the normal check for that day (read screen → repair → compare). While the page stays open it repeats this whenever the result goes stale.
3. **One status line, no button.** Green only for a check under 10 minutes old with zero differences (`773 = 773, checked 2 min ago`); amber while a check runs; red when the last fresh check found differences or could not read legacy, with the standing rule in words: print from the legacy admin until the line turns green.
4. **The labels reload by themselves** when a newer result lands, keeping the chosen driver / area / time; never while a print is waiting for confirmation.
5. Scheduled checks stay: every 15 min 18:00–02:45 Kuwait, every 5 min 00:30–01:30, main email 00:45.

## Verification

- Integration `ts-i-print-check` 3/3 (request once, audited; only fresh + zero differences is verified; unserved request expires), unit `ts-u-batch-label-filters` 17/17 (3 new: tones, reload keeps the selection and never interrupts a print, first read never reloads), all TS-U, typecheck, lint, both scans.
- Server: a request row inserted at 08:35:30 Kuwait was served by the runner and closed at 08:39:03 with `ok 773 / 773 / 0 differences / 33 WhatsApp`; the scheduled check recorded its own row. Endpoint without a token → 401. Release gate 13/13; candidate booted in a real browser before the swap; live console loads.

## Not verified

- The page itself with an operator account (the assistant has none): the status line and the automatic reload have been exercised in unit tests and on the server side only.
- A real night.

## Partner API as the source (measurement started)

At 08:24 Kuwait Partner's live `daily-deliveries` for 2026-10-10 equalled the fresh legacy screen: 773 / 773 orders and the same driver on each (plus test order 29384), in 1.7 s. On 2026-09-29 it lagged the screen by 121 driver assignments, which is why the screen became the reference. Every check now appends one line to `/root/a85/api-vs-screen.log` comparing the two at the same moment; after a night of driver changes this shows whether the API can replace the 3-minute screen read.
