#!/bin/sh
# WP-OPS-A86 — keep the next three delivery days in step with the legacy admin during the day, so any
# day an operator opens on Batch Labels is already synced (2026-10-09: Sunday was opened on Friday
# morning and still showed a two-day-old set). Friday has no deliveries. Same check and repair as the
# night run; silent (no email before a day's own 00:45 email).
set -u
CHECK=/opt/fleetbase/integrations/nutreeze-orders/print-status.py
found=0
offset=1
while [ "$found" -lt 3 ] && [ "$offset" -le 6 ]; do
  day=$(TZ=Asia/Kuwait date -d "+$offset day" +%F)
  weekday=$(TZ=Asia/Kuwait date -d "+$offset day" +%u)
  offset=$((offset + 1))
  [ "$weekday" = 5 ] && continue
  found=$((found + 1))
  "$CHECK" "$day" --follow-up 2>&1 | grep -E '^\[|^page status|another check' | head -3 | sed "s/^/$day | /"
done
exit 0
