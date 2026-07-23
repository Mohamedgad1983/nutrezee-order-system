#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/nutreeze-daily-snapshot.sh"
TIMER="$SCRIPT_DIR/nutreeze-partner-snapshot.timer"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nutreeze-snapshot-test.XXXXXX")"
MOCK_RUNNER="$TEST_ROOT/mock-runner.sh"
SNAPSHOT_DIR="$TEST_ROOT/snapshots"
CALL_FILE="$TEST_ROOT/calls"

cleanup() {
  find "$TEST_ROOT" -depth -delete
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -q '^OnCalendar=\*-\*-\* 22:00:00 UTC$' "$TIMER" \
  || fail 'timer must run at 01:00 Kuwait (22:00 UTC)'

cat > "$MOCK_RUNNER" <<'EOF'
#!/bin/sh
set -eu

CALLS=0
if [ -f "$MOCK_CALL_FILE" ]; then
  CALLS="$(cat "$MOCK_CALL_FILE")"
fi
CALLS=$((CALLS + 1))
printf '%s\n' "$CALLS" > "$MOCK_CALL_FILE"

DIGEST="$MOCK_DIGEST"
RECONCILED=true
if [ $((CALLS % 2)) -eq 0 ] && [ -n "${MOCK_SECOND_DIGEST:-}" ]; then
  DIGEST="$MOCK_SECOND_DIGEST"
  RECONCILED=false
fi

jq -cn \
  --arg delivery_date "$NUTREEZE_SNAPSHOT_DATE" \
  --arg source_digest "$DIGEST" \
  --arg customer_phone "SECRET_PHONE_MUST_NOT_PERSIST" \
  --argjson daily_orders "$MOCK_COUNT" \
  --argjson reconciled "$RECONCILED" \
  '{
    event: "daily_source_summary",
    delivery_date: $delivery_date,
    meal_pages: 2,
    meal_response_rows: 30,
    daily_meal_rows: 30,
    order_pages: 2,
    order_response_rows: 20,
    daily_orders: $daily_orders,
    orders_with_real_pin: 10,
    orders_dispatchable: 10,
    orders_dispatchable_real_pin: 10,
    orders_dispatchable_address_call: 0,
    source_orders_missing_pin: 2,
    source_orders_invalid_pin: 0,
    orders_location_area_fallback: 2,
    orders_location_country_fallback_held: 0,
    orders_held_missing_pin: 2,
    orders_held_invalid_pin: 0,
    orders_held_unapproved_meal_status: 0,
    orders_held_unapproved_order_status: 0,
    orders_held_source_canceled: 0,
    source_digest: $source_digest,
    expected_digest: $source_digest,
    manifest_checked: true,
    reconciled: $reconciled,
    customer_phone: $customer_phone
  }'
jq -cn --arg delivery_date "$NUTREEZE_SNAPSHOT_DATE" \
  '{event: "complete", dry_run: true, delivery_date: $delivery_date, fleetbase_written: false}'
EOF
chmod 0700 "$MOCK_RUNNER"

DIGEST_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DIGEST_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

run_snapshot() {
  NUTREEZE_SNAPSHOT_RUNNER="$MOCK_RUNNER" \
  NUTREEZE_SNAPSHOT_DIR="$SNAPSHOT_DIR" \
  NUTREEZE_SNAPSHOT_DATE="$1" \
  NUTREEZE_SNAPSHOT_CAPTURED_AT=2026-07-23T04:00:00Z \
  NUTREEZE_SNAPSHOT_RETENTION_DAYS=30 \
  MOCK_CALL_FILE="$CALL_FILE" \
  MOCK_COUNT="$2" \
  MOCK_DIGEST="$3" \
  MOCK_SECOND_DIGEST="${4:-}" \
  "$SCRIPT"
}

run_snapshot 2026-07-23 12 "$DIGEST_A" > "$TEST_ROOT/first.out"
[ "$(cat "$CALL_FILE")" -eq 2 ] || fail 'snapshot must read the source twice'
SNAPSHOT_FILE="$SNAPSHOT_DIR/2026-07-23.json"
[ -f "$SNAPSHOT_FILE" ] || fail 'snapshot file was not created'
jq -e '
  .schema_version == 1
  and .delivery_date == "2026-07-23"
  and .stable_two_pass == true
  and .authoritative_expected_total == false
  and .fleetbase_written == false
  and .completeness_status == "stable_two_pass_not_authoritative"
  and .summary.daily_orders == 12
  and .summary.source_digest == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
' "$SNAPSHOT_FILE" >/dev/null || fail 'snapshot contract is invalid'
if grep -q 'SECRET_PHONE' "$SNAPSHOT_FILE"; then
  fail 'non-allowlisted source fields leaked into the snapshot'
fi

run_snapshot 2026-07-23 12 "$DIGEST_A" > "$TEST_ROOT/second.out"
grep -q 'snapshot_unchanged' "$TEST_ROOT/second.out" || fail 'identical rerun was not idempotent'
[ "$(cat "$CALL_FILE")" -eq 4 ] || fail 'idempotent rerun must still verify two source passes'

if run_snapshot 2026-07-23 13 "$DIGEST_B" > "$TEST_ROOT/conflict.out" 2>&1; then
  fail 'changed same-day source overwrote the first snapshot'
fi
jq -e '.summary.daily_orders == 12' "$SNAPSHOT_FILE" >/dev/null \
  || fail 'same-day conflict did not preserve the first snapshot'

printf '0\n' > "$CALL_FILE"
if run_snapshot 2026-07-24 12 "$DIGEST_A" "$DIGEST_B" > "$TEST_ROOT/unstable.out" 2>&1; then
  fail 'unstable two-pass source was accepted'
fi
[ ! -e "$SNAPSHOT_DIR/2026-07-24.json" ] || fail 'unstable source created a snapshot'

printf '%s\n' '{}' > "$SNAPSHOT_DIR/2020-01-01.json"
touch -t 202001010000 "$SNAPSHOT_DIR/2020-01-01.json"
printf '0\n' > "$CALL_FILE"
run_snapshot 2026-07-25 0 "$DIGEST_A" > "$TEST_ROOT/zero.out"
jq -e '.completeness_status == "empty_two_pass_not_authoritative"' \
  "$SNAPSHOT_DIR/2026-07-25.json" >/dev/null || fail 'stable zero snapshot was not flagged'
[ ! -e "$SNAPSHOT_DIR/2020-01-01.json" ] || fail 'retention did not remove the old snapshot'

printf '%s\n' 'daily snapshot tests: 6/6 passed'
