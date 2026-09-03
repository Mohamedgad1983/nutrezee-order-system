#!/bin/sh
set -eu
umask 077

RUNNER="${NUTREEZE_DAILY_RUNNER:-/opt/fleetbase/integrations/nutreeze-orders/run.sh}"
CONFIG_ROOT="${NUTREEZE_DAILY_CONFIG_ROOT:-/opt/fleetbase/api/storage/app/integrations/config}"
CONTAINER_CONFIG_ROOT="${NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT:-/fleetbase/api/storage/app/integrations/config}"
TODAY="${NUTREEZE_DAILY_TODAY:-$(TZ=Asia/Kuwait date +%F)}"
# rolling (default): 01:00 Kuwait, refresh +1/+2 days.
# sameday (A46):     02:00 Kuwait, refresh today (drivers collect ~03:00) and +1 day,
#                    so Partner driver assignments made after midnight still reach Navigator.
MODE="${NUTREEZE_DAILY_MODE:-rolling}"
case "$MODE" in
  rolling) WINDOW_START=45;  WINDOW_END=105; WINDOW_LABEL='00:45-01:45' ;;
  sameday) WINDOW_START=105; WINDOW_END=165; WINDOW_LABEL='01:45-02:45' ;;
  *)
    printf '%s\n' 'unsupported NUTREEZE_DAILY_MODE' >&2
    exit 26
    ;;
esac
if [ "${NUTREEZE_DAILY_TEST_MODE:-0}" = 1 ]; then
  NOW_MINUTES="${NUTREEZE_DAILY_TEST_NOW_MINUTES:-60}"
  TARGET_DATES="${NUTREEZE_DAILY_TARGET_DATES:-}"
else
  HOUR="$(TZ=Asia/Kuwait date +%H | sed 's/^0//')"
  MINUTE="$(TZ=Asia/Kuwait date +%M | sed 's/^0//')"
  NOW_MINUTES=$((HOUR * 60 + MINUTE))
  TARGET_DATES=''
fi
MANIFEST_LOG="$(mktemp /var/tmp/nutreeze-partner-manifest.XXXXXX)"
trap 'find /var/tmp -maxdepth 1 -type f -name "$(basename "$MANIFEST_LOG")" -delete' EXIT HUP INT TERM
chmod 600 "$MANIFEST_LOG"

if [ "$NOW_MINUTES" -lt "$WINDOW_START" ] || [ "$NOW_MINUTES" -gt "$WINDOW_END" ]; then
  printf '%s\n' "outside guarded $WINDOW_LABEL Kuwait sync window" >&2
  exit 25
fi

if [ -z "$TARGET_DATES" ]; then
  if [ "$MODE" = sameday ]; then
    TARGET_DATES="$TODAY $(TZ=Asia/Kuwait date -d "$TODAY +1 day" +%F)"
  else
    TARGET_DATES="$(TZ=Asia/Kuwait date -d "$TODAY +1 day" +%F) $(TZ=Asia/Kuwait date -d "$TODAY +2 days" +%F)"
  fi
fi

set -- $TARGET_DATES
if [ "$#" -ne 2 ] || [ "$1" = "$2" ]; then
  printf '%s\n' 'invalid 48-hour target dates' >&2
  exit 28
fi

FAILURES=0
SUCCESSES=0
for DELIVERY_DATE in "$@"; do
  case "$DELIVERY_DATE" in
    ????-??-??) ;;
    *)
      printf '%s\n' 'invalid horizon delivery date' >&2
      exit 29
      ;;
  esac
  COMPACT_DATE="$(printf '%s' "$DELIVERY_DATE" | tr -d '-')"
  HOST_MEMBERSHIP="$CONFIG_ROOT/driver-orders-$COMPACT_DATE.json"
  CONTAINER_MEMBERSHIP="$CONTAINER_CONFIG_ROOT/driver-orders-$COMPACT_DATE.json"
  set -- "--delivery-date=$DELIVERY_DATE" --limit=1000 --dry-run
  if [ -f "$HOST_MEMBERSHIP" ] && [ ! -L "$HOST_MEMBERSHIP" ]; then
    set -- "$@" "--driver-orders-manifest=$CONTAINER_MEMBERSHIP"
  fi
  if ! "$RUNNER" "$@" > "$MANIFEST_LOG"; then
    sed -n '/"event":"fatal"/p' "$MANIFEST_LOG" >&2
    printf '%s\n' "{\"event\":\"horizon_date_failed\",\"delivery_date\":\"$DELIVERY_DATE\",\"stage\":\"dry_run\"}" >&2
    FAILURES=$((FAILURES + 1))
    continue
  fi

  SUMMARY="$(sed -n '/"event":"daily_source_summary"/p' "$MANIFEST_LOG" | tail -n 1)"
  COUNT="$(printf '%s\n' "$SUMMARY" | jq -er --arg date "$DELIVERY_DATE" 'select(.delivery_date == $date) | .daily_orders | numbers')"
  DIGEST="$(printf '%s\n' "$SUMMARY" | jq -er '.source_digest | strings | select(test("^[a-f0-9]{64}$"))')"
  case "$COUNT" in
    ''|*[!0-9]*)
      printf '%s\n' "{\"event\":\"horizon_date_failed\",\"delivery_date\":\"$DELIVERY_DATE\",\"stage\":\"manifest\"}" >&2
      FAILURES=$((FAILURES + 1))
      continue
      ;;
  esac

  set -- \
    "--delivery-date=$DELIVERY_DATE" \
    --limit=1000 \
    "--expected-count=$COUNT" \
    "--expected-digest=$DIGEST" \
    --verify \
    "--confirm-daily-sync=$DELIVERY_DATE"
  if [ -f "$HOST_MEMBERSHIP" ] && [ ! -L "$HOST_MEMBERSHIP" ]; then
    set -- "$@" "--driver-orders-manifest=$CONTAINER_MEMBERSHIP"
  fi
  if [ "$COUNT" -eq 0 ]; then
    set -- "$@" "--confirm-zero-day=$DELIVERY_DATE"
  fi
  if "$RUNNER" "$@"; then
    SUCCESSES=$((SUCCESSES + 1))
  else
    printf '%s\n' "{\"event\":\"horizon_date_failed\",\"delivery_date\":\"$DELIVERY_DATE\",\"stage\":\"write\"}" >&2
    FAILURES=$((FAILURES + 1))
  fi
done

find /var/tmp -maxdepth 1 -type f -name "$(basename "$MANIFEST_LOG")" -delete
printf '%s\n' "{\"event\":\"horizon_complete\",\"days_succeeded\":$SUCCESSES,\"days_failed\":$FAILURES}"
[ "$FAILURES" -eq 0 ]
