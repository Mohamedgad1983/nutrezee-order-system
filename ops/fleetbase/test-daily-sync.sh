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
for ARG in "$@"; do
  case "$ARG" in
    --delivery-date=*) DATE=${ARG#*=} ;;
    --dry-run) DRY=1 ;;
    --confirm-zero-day=*) ZERO=1 ;;
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
printf '%s\n' "{\"event\":\"complete\",\"delivery_date\":\"$DATE\"}"
MOCK
chmod 0700 "$MOCK_RUNNER"

run_sync() {
  MOCK_CALL_LOG="$CALL_LOG" \
  MOCK_FAIL_DATE="${1:-}" \
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
grep -q '"days_succeeded":1,"days_failed":1' "$ROOT/failure.log"

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
grep -q 'outside guarded 00:45-01:45 Kuwait sync window' "$ROOT/outside-window.log"
[ ! -s "$CALL_LOG" ]

printf '%s\n' 'daily sync tests: 9/9 passed'
