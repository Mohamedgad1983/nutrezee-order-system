#!/usr/bin/env bash
# WP-OPS-A75 — future delivery days of every Partner order into the label database.
# The 30-minute feed mirrors only today and tomorrow, so every label printed "Days Remaining 1"
# (last known day − today). Partner's daily-deliveries feed lists the scheduled deliveries of the
# next ~4 weeks; importing those days through the same governed M19 path makes the existing
# definition (last scheduled day − today) true. Same runner, own temporary admin, own log.
#   run-partner-window-feed.sh            apply for Kuwait today+2 … today+30 (Partner lists about 29 days ahead; a day past its window is simply empty)
#   FEED_MODE=dry-run run-partner-window-feed.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FROM="${WINDOW_FROM_DAYS:-2}"; TO="${WINDOW_TO_DAYS:-30}"
exec 9>/run/lock/nutrezee-partner-window-feed.lock; flock -n 9 || { echo 'window feed already running' >&2; exit 0; }
DATES=""
for offset in $(seq "$FROM" "$TO"); do
  day="$(TZ=Asia/Kuwait date -d "+${offset} day" +%F)"
  [[ "$(TZ=Asia/Kuwait date -d "+${offset} day" +%u)" == 5 ]] && continue   # Friday: no deliveries
  DATES+="${day} "
done
FEED_MODE="${FEED_MODE:-apply}" ALLOW_APPLY="${ALLOW_APPLY:-yes}" FEED_DATES="${DATES% }" \
  FEED_TEMP_EMAIL="window-sync-temp@nutrezee.local" FEED_SCRIPT_NAME="partner-window-feed" FEED_LOG_NAME="partner-window-feed" \
  "${HERE}/run-partner-daily-feed.sh"
