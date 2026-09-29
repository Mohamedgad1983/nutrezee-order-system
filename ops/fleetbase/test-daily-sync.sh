#!/bin/sh
set -eu

ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "$ROOT"
}
trap cleanup EXIT HUP INT TERM

CALL_LOG="$ROOT/calls.log"
MOCK_RUNNER="$ROOT/mock-runner.sh"
CONFIG_ROOT="$ROOT/config"
mkdir -m 0700 "$CONFIG_ROOT"
: > "$CALL_LOG"
: > "$CONFIG_ROOT/driver-orders-20260813.json"

cat > "$MOCK_RUNNER" <<'MOCK'
#!/bin/sh
set -eu
DATE=''
DRY=0
ZERO=0
CANCEL=0
for ARG in "$@"; do
  case "$ARG" in
    --delivery-date=*) DATE=${ARG#*=} ;;
    --dry-run) DRY=1 ;;
    --confirm-zero-day=*) ZERO=1 ;;
    --cancel-only=*) CANCEL=1 ;;
  esac
done
printf '%s\n' "$*" >> "$MOCK_CALL_LOG"
if [ "$DATE" = "${MOCK_FAIL_DATE:-}" ] && [ "$DRY" -eq 1 ]; then
  printf '%s\n' '{"event":"fatal","error_code":"synthetic_failure"}'
  exit 1
fi
if [ "$DATE" = 2026-08-13 ]; then
  COUNT=2
  DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
else
  COUNT=0
  DIGEST=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
fi
if [ "$DRY" -eq 1 ]; then
  printf '%s\n' "{\"event\":\"daily_source_summary\",\"delivery_date\":\"$DATE\",\"daily_orders\":$COUNT,\"source_digest\":\"$DIGEST\"}"
  exit 0
fi
if [ "$COUNT" -eq 0 ] && [ "$ZERO" -ne 1 ]; then
  exit 9
fi
if [ "$DATE" = "${MOCK_FAIL_ONCE_DATE:-}" ] && [ ! -f "$MOCK_CALL_LOG.once" ]; then
  : > "$MOCK_CALL_LOG.once"
  printf '%s\n' '{"event":"fatal","error_class":"DeadlockException","error_code":"internal_error"}'
  exit 1
fi
if [ "$CANCEL" -eq 1 ]; then
  printf '%s\n' "{\"event\":\"complete\",\"delivery_date\":\"$DATE\",\"mode\":\"cancel_only_v1\"}"
  exit 0
fi
printf '%s\n' "{\"event\":\"complete\",\"delivery_date\":\"$DATE\"}"
MOCK
chmod 0700 "$MOCK_RUNNER"

run_sync() {
  MOCK_CALL_LOG="$CALL_LOG" \
  MOCK_FAIL_DATE="${1:-}" \
  MOCK_FAIL_ONCE_DATE="${2:-}" \
  NUTREEZE_DAILY_RETRY_SECONDS=0 \
  NUTREEZE_DAILY_TEST_MODE=1 \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=60 \
  NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
  NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
  "$(dirname "$0")/nutreeze-daily-sync.sh"
}

run_sync > "$ROOT/success.log"
[ "$(wc -l < "$CALL_LOG" | tr -d ' ')" = 4 ]
grep -q -- '--driver-orders-manifest=/fleetbase/test-config/driver-orders-20260813.json' "$CALL_LOG"
grep -q -- '--confirm-zero-day=2026-08-14' "$CALL_LOG"
grep -q '"days_succeeded":2,"days_failed":0' "$ROOT/success.log"

: > "$CALL_LOG"
if run_sync 2026-08-13 > "$ROOT/failure.log" 2>&1; then
  printf '%s\n' 'expected isolated date failure' >&2
  exit 1
fi
grep -q -- '--confirm-daily-sync=2026-08-14' "$CALL_LOG"
grep -q -- '--confirm-address-call-dispatch=2026-08-14' "$CALL_LOG"
grep -q '"days_succeeded":1,"days_failed":1' "$ROOT/failure.log"
# A70: a persistently failing date is tried 3 times, then reported; the other date still runs.
[ "$(grep -c -- '--delivery-date=2026-08-13 --limit=1000 --dry-run' "$CALL_LOG")" = 3 ]
[ "$(grep -c '"event":"horizon_date_retry"' "$ROOT/failure.log")" = 2 ]

# A70: a one-off write failure (e.g. a deadlock with another sync) is retried and the day completes.
: > "$CALL_LOG"
rm -f "$CALL_LOG.once"
run_sync '' 2026-08-13 > "$ROOT/retry.log" 2>&1
grep -q '"event":"horizon_date_retry","delivery_date":"2026-08-13","attempt":1' "$ROOT/retry.log"
grep -q '"days_succeeded":2,"days_failed":0' "$ROOT/retry.log"
[ "$(grep -c -- '--delivery-date=2026-08-13 --limit=1000 --dry-run' "$CALL_LOG")" = 2 ]
rm -f "$CALL_LOG.once"

: > "$CALL_LOG"
if MOCK_CALL_LOG="$CALL_LOG" \
  NUTREEZE_DAILY_TEST_MODE=1 \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=420 \
  NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/outside-window.log" 2>&1; then
  printf '%s\n' 'expected 07:00 Kuwait to be rejected' >&2
  exit 1
fi
grep -q 'outside guarded 00:20-01:45 Kuwait sync window' "$ROOT/outside-window.log"
[ ! -s "$CALL_LOG" ]

# A68: the rolling window opens at 00:20 Kuwait (00:25 run) and still rejects 00:15.
for NOW in 15 25; do
  : > "$CALL_LOG"
  if MOCK_CALL_LOG="$CALL_LOG" \
    NUTREEZE_DAILY_TEST_MODE=1 \
    NUTREEZE_DAILY_TEST_NOW_MINUTES="$NOW" \
    NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' \
    NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
    NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
    NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
    "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/rolling-$NOW.log" 2>&1; then
    [ "$NOW" = 25 ] || { printf '%s\n' 'expected 00:15 Kuwait to be rejected' >&2; exit 1; }
    [ "$(wc -l < "$CALL_LOG" | tr -d ' ')" = 4 ]
  else
    [ "$NOW" = 15 ] || { printf '%s\n' 'expected 00:25 Kuwait to run' >&2; exit 1; }
    grep -q 'outside guarded 00:20-01:45 Kuwait sync window' "$ROOT/rolling-$NOW.log"
    [ ! -s "$CALL_LOG" ]
  fi
done

# sameday mode (A46): 02:00 Kuwait window, targets today and +1 day.
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" \
  NUTREEZE_DAILY_TEST_MODE=1 \
  NUTREEZE_DAILY_MODE=sameday \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=120 \
  NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
  NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/sameday.log"
[ "$(wc -l < "$CALL_LOG" | tr -d ' ')" = 4 ]
grep -q '"days_succeeded":2,"days_failed":0' "$ROOT/sameday.log"

: > "$CALL_LOG"
if MOCK_CALL_LOG="$CALL_LOG" \
  NUTREEZE_DAILY_TEST_MODE=1 \
  NUTREEZE_DAILY_MODE=sameday \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=60 \
  NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/sameday-outside.log" 2>&1; then
  printf '%s\n' 'expected 01:00 Kuwait to be rejected in sameday mode' >&2
  exit 1
fi
grep -q 'outside guarded 01:45-02:45 Kuwait sync window' "$ROOT/sameday-outside.log"
[ ! -s "$CALL_LOG" ]

# default date computation without an override: sameday = today and +1, rolling = +1 and +2
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=sameday \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=120 NUTREEZE_DAILY_TODAY=2026-09-05 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > /dev/null
grep -q -- '--delivery-date=2026-09-05' "$CALL_LOG"
grep -q -- '--delivery-date=2026-09-06' "$CALL_LOG"
if grep -q -- '--delivery-date=2026-09-07' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi

# evening mode (A50): 21:00 Kuwait → full sync of tomorrow only; 01:00 Kuwait → today only; 12:00 rejected.
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=evening \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=1260 NUTREEZE_DAILY_TODAY=2026-08-12 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/evening.log"
[ "$(wc -l < "$CALL_LOG" | tr -d ' ')" = 2 ]
grep -q -- '--delivery-date=2026-08-13' "$CALL_LOG"
if grep -q -- '--delivery-date=2026-08-12' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
grep -q -- '--confirm-daily-sync=2026-08-13' "$CALL_LOG"
grep -q -- '--confirm-address-call-dispatch=2026-08-13' "$CALL_LOG"
if grep -q -- '--cancel-only=' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
grep -q '"days_succeeded":1,"days_failed":0' "$ROOT/evening.log"

: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=evening \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=60 NUTREEZE_DAILY_TODAY=2026-08-13 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > /dev/null
grep -q -- '--delivery-date=2026-08-13' "$CALL_LOG"
if grep -q -- '--delivery-date=2026-08-14' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi

: > "$CALL_LOG"
if MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=evening \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=720 NUTREEZE_DAILY_TODAY=2026-08-12 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/evening-outside.log" 2>&1; then
  printf '%s\n' 'expected 12:00 Kuwait to be rejected in evening mode' >&2
  exit 1
fi
grep -q 'outside guarded 20:00-02:45 Kuwait sync window' "$ROOT/evening-outside.log"
[ ! -s "$CALL_LOG" ]

# daytime mode (A50): 12:00 Kuwait → cancel-only for today; never confirm-daily-sync; zero day skipped; 02:00 rejected.
: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=daytime \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=720 NUTREEZE_DAILY_TODAY=2026-08-13 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/daytime.log"
[ "$(wc -l < "$CALL_LOG" | tr -d ' ')" = 2 ]
grep -q -- '--cancel-only=2026-08-13' "$CALL_LOG"
grep -q -- '--expected-digest=aaaaaaaa' "$CALL_LOG"
grep -q -- '--driver-orders-manifest=/fleetbase/test-config/driver-orders-20260813.json' "$CALL_LOG"
if grep -q -- '--confirm-daily-sync=' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
if grep -q -- '--confirm-address-call-dispatch=' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
if grep -q -- '--verify' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
grep -q '"days_succeeded":1,"days_failed":0' "$ROOT/daytime.log"

: > "$CALL_LOG"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=daytime \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=720 NUTREEZE_DAILY_TODAY=2026-08-14 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/daytime-zero.log"
[ "$(wc -l < "$CALL_LOG" | tr -d ' ')" = 1 ]
if grep -q -- '--confirm-zero-day=' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
grep -q '"event":"daytime_zero_day_skipped"' "$ROOT/daytime-zero.log"
grep -q '"days_succeeded":1,"days_failed":0' "$ROOT/daytime-zero.log"

: > "$CALL_LOG"
if MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_MODE=daytime \
  NUTREEZE_DAILY_TEST_NOW_MINUTES=120 NUTREEZE_DAILY_TODAY=2026-08-13 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/daytime-outside.log" 2>&1; then
  printf '%s\n' 'expected 02:00 Kuwait to be rejected in daytime mode' >&2
  exit 1
fi
grep -q 'outside guarded 03:00-19:59 Kuwait sync window' "$ROOT/daytime-outside.log"
[ ! -s "$CALL_LOG" ]

# A70.3: a fresh legacy-screen manifest replaces the driver-orders manifest on full syncs, the
# capture runs for the print day before rolling runs, and a stale file is ignored.
: > "$CALL_LOG"
CAPTURE_LOG="$ROOT/capture.log"
cat > "$ROOT/capture.sh" <<CAPTURE
#!/bin/sh
printf '%s\\n' "\$1" >> "$CAPTURE_LOG"
: > "$CONFIG_ROOT/legacy-screen-\$(printf '%s' "\$1" | tr -d '-').json"
CAPTURE
chmod 0700 "$ROOT/capture.sh"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_TEST_NOW_MINUTES=60 \
  NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' NUTREEZE_PRINT_DAY=2026-08-13 \
  NUTREEZE_LEGACY_SCREEN_CAPTURE="$ROOT/capture.sh" NUTREEZE_DAILY_RETRY_SECONDS=0 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/screen.log" 2>&1
[ "$(cat "$CAPTURE_LOG")" = 2026-08-13 ]
[ "$(grep -c -- '--legacy-screen-manifest=/fleetbase/test-config/legacy-screen-20260813.json' "$CALL_LOG")" = 2 ]
if grep -q -- '--driver-orders-manifest' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
if grep -q -- '--legacy-screen-manifest=/fleetbase/test-config/legacy-screen-20260814.json' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
: > "$CALL_LOG"
touch -d '7 hours ago' "$CONFIG_ROOT/legacy-screen-20260813.json"
MOCK_CALL_LOG="$CALL_LOG" NUTREEZE_DAILY_TEST_MODE=1 NUTREEZE_DAILY_TEST_NOW_MINUTES=60 \
  NUTREEZE_DAILY_TARGET_DATES='2026-08-13 2026-08-14' NUTREEZE_DAILY_RETRY_SECONDS=0 \
  NUTREEZE_DAILY_RUNNER="$MOCK_RUNNER" NUTREEZE_DAILY_CONFIG_ROOT="$CONFIG_ROOT" \
  NUTREEZE_DAILY_CONTAINER_CONFIG_ROOT=/fleetbase/test-config \
  "$(dirname "$0")/nutreeze-daily-sync.sh" > "$ROOT/screen-stale.log" 2>&1
if grep -q -- '--legacy-screen-manifest' "$CALL_LOG"; then printf '%s\n' 'unexpected match' >&2; exit 1; fi
grep -q -- '--driver-orders-manifest=/fleetbase/test-config/driver-orders-20260813.json' "$CALL_LOG"
rm -f "$CONFIG_ROOT/legacy-screen-20260813.json"

printf '%s\n' 'daily sync tests: 45/45 passed'
