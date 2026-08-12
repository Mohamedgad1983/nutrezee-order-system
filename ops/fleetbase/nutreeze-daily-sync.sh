#!/bin/sh
set -eu
umask 077

RUNNER=/opt/fleetbase/integrations/nutreeze-orders/run.sh
DELIVERY_DATE="$(TZ=Asia/Kuwait date +%F)"
HOUR="$(TZ=Asia/Kuwait date +%H | sed 's/^0//')"
MINUTE="$(TZ=Asia/Kuwait date +%M | sed 's/^0//')"
NOW_MINUTES=$((HOUR * 60 + MINUTE))
MANIFEST_LOG="$(mktemp /var/tmp/nutreeze-partner-manifest.XXXXXX)"
trap 'find /var/tmp -maxdepth 1 -type f -name "$(basename "$MANIFEST_LOG")" -delete' EXIT HUP INT TERM
chmod 600 "$MANIFEST_LOG"

if [ "$NOW_MINUTES" -lt 405 ] || [ "$NOW_MINUTES" -gt 465 ]; then
  printf '%s\n' 'outside guarded 06:45-07:45 Kuwait sync window' >&2
  exit 25
fi

if ! "$RUNNER" \
  "--delivery-date=$DELIVERY_DATE" \
  --limit=1000 \
  --dry-run > "$MANIFEST_LOG"; then
  sed -n '/"event":"fatal"/p' "$MANIFEST_LOG" >&2
  exit 26
fi

SUMMARY="$(sed -n '/"event":"daily_source_summary"/p' "$MANIFEST_LOG" | tail -n 1)"
COUNT="$(printf '%s\n' "$SUMMARY" | jq -er '.daily_orders | numbers')"
DIGEST="$(printf '%s\n' "$SUMMARY" | jq -er '.source_digest | strings | select(test("^[a-f0-9]{64}$"))')"
case "$COUNT" in
  ''|*[!0-9]*)
    printf '%s\n' 'invalid dry-run source count' >&2
    exit 27
    ;;
esac

find /var/tmp -maxdepth 1 -type f -name "$(basename "$MANIFEST_LOG")" -delete

exec "$RUNNER" \
  "--delivery-date=$DELIVERY_DATE" \
  --limit=1000 \
  "--expected-count=$COUNT" \
  "--expected-digest=$DIGEST" \
  --verify \
  "--confirm-daily-sync=$DELIVERY_DATE"
