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
# evening (A50):     hourly 20:00-02:45 Kuwait, full refresh of the next collection day
#                    (tomorrow before midnight, today after it) so evening driver assignments
#                    and label colours reach Fleet-Ops within the hour.
# daytime (A50):     every 30 min 03:00-19:59 Kuwait, CANCEL-ONLY for today: Partner
#                    cancellations and on-hold deliveries are withdrawn from drivers; nothing
#                    else (driver, address, pin, new/missing rows) is touched.
MODE="${NUTREEZE_DAILY_MODE:-rolling}"
case "$MODE" in
  rolling) WINDOW_START=45;   WINDOW_END=105;  WINDOW_LABEL='00:45-01:45' ;;
  sameday) WINDOW_START=105;  WINDOW_END=165;  WINDOW_LABEL='01:45-02:45' ;;
  evening) WINDOW_START=1200; WINDOW_END=165;  WINDOW_LABEL='20:00-02:45' ;;
  daytime) WINDOW_START=180;  WINDOW_END=1199; WINDOW_LABEL='03:00-19:59' ;;
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

if [ "$MODE" = evening ]; then
  # window wraps midnight: 20:00-23:59 or 00:00-02:45
  if [ "$NOW_MINUTES" -lt "$WINDOW_START" ] && [ "$NOW_MINUTES" -gt "$WINDOW_END" ]; then
    printf '%s\n' "outside guarded $WINDOW_LABEL Kuwait sync window" >&2
    exit 25
  fi
elif [ "$NOW_MINUTES" -lt "$WINDOW_START" ] || [ "$NOW_MINUTES" -gt "$WINDOW_END" ]; then
  printf '%s\n' "outside guarded $WINDOW_LABEL Kuwait sync window" >&2
  exit 25
fi

if [ -z "$TARGET_DATES" ]; then
  case "$MODE" in
    sameday) TARGET_DATES="$TODAY $(TZ=Asia/Kuwait date -d "$TODAY +1 day" +%F)" ;;
    evening)
      if [ "$NOW_MINUTES" -ge "$WINDOW_START" ]; then
        TARGET_DATES="$(TZ=Asia/Kuwait date -d "$TODAY +1 day" +%F)"
      else
        TARGET_DATES="$TODAY"
      fi
      ;;
    daytime) TARGET_DATES="$TODAY" ;;
    *) TARGET_DATES="$(TZ=Asia/Kuwait date -d "$TODAY +1 day" +%F) $(TZ=Asia/Kuwait date -d "$TODAY +2 days" +%F)" ;;
  esac
fi

set -- $TARGET_DATES
case "$MODE" in
  evening|daytime)
    if [ "$#" -ne 1 ]; then
      printf '%s\n' 'invalid single target date' >&2
      exit 28
    fi
    ;;
  *)
    if [ "$#" -ne 2 ] || [ "$1" = "$2" ]; then
      printf '%s\n' 'invalid 48-hour target dates' >&2
      exit 28
    fi
    ;;
esac

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

  if [ "$MODE" = daytime ]; then
    if [ "$COUNT" -eq 0 ]; then
      # Nothing can be withdrawn from an empty day; never confirm-zero-day (that would
      # demand that no Fleetbase orders exist).
      printf '%s\n' "{\"event\":\"daytime_zero_day_skipped\",\"delivery_date\":\"$DELIVERY_DATE\"}"
      SUCCESSES=$((SUCCESSES + 1))
      continue
    fi
    set -- \
      "--delivery-date=$DELIVERY_DATE" \
      --limit=1000 \
      "--expected-count=$COUNT" \
      "--expected-digest=$DIGEST" \
      "--cancel-only=$DELIVERY_DATE"
    if [ -f "$HOST_MEMBERSHIP" ] && [ ! -L "$HOST_MEMBERSHIP" ]; then
      set -- "$@" "--driver-orders-manifest=$CONTAINER_MEMBERSHIP"
    fi
  else
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
