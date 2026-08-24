#!/bin/sh
set -eu
umask 077

RUNNER="${NUTREEZE_SNAPSHOT_RUNNER:-/opt/fleetbase/integrations/nutreeze-orders/run.sh}"
SNAPSHOT_DIR="${NUTREEZE_SNAPSHOT_DIR:-/var/lib/nutreeze-partner-snapshots}"
DELIVERY_DATE="${NUTREEZE_SNAPSHOT_DATE:-$(TZ=Asia/Kuwait date +%F)}"
CAPTURED_AT="${NUTREEZE_SNAPSHOT_CAPTURED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
RETENTION_DAYS="${NUTREEZE_SNAPSHOT_RETENTION_DAYS:-30}"
FIRST_LOG=
SECOND_LOG=
TEMP_SNAPSHOT=

cleanup() {
  [ -z "$FIRST_LOG" ] || rm -f -- "$FIRST_LOG"
  [ -z "$SECOND_LOG" ] || rm -f -- "$SECOND_LOG"
  [ -z "$TEMP_SNAPSHOT" ] || rm -f -- "$TEMP_SNAPSHOT"
}
trap cleanup EXIT HUP INT TERM

log_event() {
  EVENT="$1"
  shift
  jq -cn --arg event "$EVENT" "$@" '{event: $event} + $ARGS.named'
}

relay_runner_fatal() {
  LOG_FILE="$1"
  jq -c '
    select(.event == "fatal")
    | {
        event: "snapshot_source_error",
        stage: (.stage // "unknown"),
        error_code: (.error_code // "unknown")
      }
  ' "$LOG_FILE" 2>/dev/null | tail -n 1 >&2 || true
}

case "$DELIVERY_DATE" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *)
    log_event fatal --arg stage snapshot_input --arg error_code invalid_delivery_date >&2
    exit 30
    ;;
esac

case "$RETENTION_DAYS" in
  ''|*[!0-9]*)
    log_event fatal --arg stage snapshot_input --arg error_code invalid_retention_days >&2
    exit 31
    ;;
esac

if [ -L "$SNAPSHOT_DIR" ]; then
  log_event fatal --arg stage snapshot_storage --arg error_code snapshot_directory_symlink >&2
  exit 32
fi
install -d -m 0700 "$SNAPSHOT_DIR"
chmod 0700 "$SNAPSHOT_DIR"

FIRST_LOG="$(mktemp /var/tmp/nutreeze-partner-snapshot-first.XXXXXX)"
SECOND_LOG="$(mktemp /var/tmp/nutreeze-partner-snapshot-second.XXXXXX)"
chmod 0600 "$FIRST_LOG" "$SECOND_LOG"

if ! "$RUNNER" \
  "--delivery-date=$DELIVERY_DATE" \
  --limit=1000 \
  --dry-run > "$FIRST_LOG"; then
  relay_runner_fatal "$FIRST_LOG"
  log_event fatal --arg stage first_source_pass --arg error_code source_read_failed >&2
  exit 33
fi

FIRST_SUMMARY="$(sed -n '/"event":"daily_source_summary"/p' "$FIRST_LOG" | tail -n 1)"
COUNT="$(printf '%s\n' "$FIRST_SUMMARY" | jq -er \
  'select(.event == "daily_source_summary") | .daily_orders | numbers')"
DIGEST="$(printf '%s\n' "$FIRST_SUMMARY" | jq -er \
  'select(.event == "daily_source_summary") | .source_digest | strings | select(test("^[a-f0-9]{64}$"))')"
FIRST_DATE="$(printf '%s\n' "$FIRST_SUMMARY" | jq -er '.delivery_date | strings')"

case "$COUNT" in
  ''|*[!0-9]*)
    log_event fatal --arg stage first_source_pass --arg error_code invalid_source_count >&2
    exit 34
    ;;
esac

if [ "$FIRST_DATE" != "$DELIVERY_DATE" ]; then
  log_event fatal --arg stage first_source_pass --arg error_code source_date_mismatch >&2
  exit 35
fi

if ! "$RUNNER" \
  "--delivery-date=$DELIVERY_DATE" \
  --limit=1000 \
  "--expected-count=$COUNT" \
  "--expected-digest=$DIGEST" \
  --dry-run > "$SECOND_LOG"; then
  relay_runner_fatal "$SECOND_LOG"
  log_event fatal --arg stage second_source_pass --arg error_code unstable_or_failed_source_read >&2
  exit 36
fi

SECOND_SUMMARY="$(sed -n '/"event":"daily_source_summary"/p' "$SECOND_LOG" | tail -n 1)"
SAFE_SUMMARY="$(printf '%s\n' "$SECOND_SUMMARY" | jq -ceS '
  select(
    .event == "daily_source_summary"
    and (.delivery_date | type == "string")
    and .source_selector == "partner_daily_deliveries_v1"
    and .source_endpoint == "/integration/daily-deliveries"
    and (.daily_orders | type == "number")
    and (.source_digest | type == "string" and test("^[a-f0-9]{64}$"))
    and .manifest_checked == true
    and .reconciled == true
  )
  | {
      delivery_date,
      source_selector,
      source_endpoint,
      delivery_pages,
      delivery_response_rows,
      source_declared_deliveries,
      source_declared_distinct_orders,
      source_declared_scheduled,
      source_declared_on_hold,
      source_declared_cancelled,
      duplicate_delivery_rows_collapsed,
      daily_orders,
      orders_with_real_pin,
      orders_dispatchable,
      orders_dispatchable_real_pin,
      orders_dispatchable_address_call,
      source_orders_missing_pin,
      source_orders_invalid_pin,
      orders_location_area_fallback,
      orders_location_country_fallback_held,
      orders_held_missing_pin,
      orders_held_invalid_pin,
      orders_held_unapproved_meal_status,
      orders_held_unapproved_order_status,
      orders_held_source_canceled,
      source_digest
    }
')"
SECOND_DATE="$(printf '%s\n' "$SAFE_SUMMARY" | jq -er '.delivery_date')"
SECOND_COUNT="$(printf '%s\n' "$SAFE_SUMMARY" | jq -er '.daily_orders | numbers')"
SECOND_DIGEST="$(printf '%s\n' "$SAFE_SUMMARY" | jq -er '.source_digest')"

if [ "$SECOND_DATE" != "$DELIVERY_DATE" ] \
  || [ "$SECOND_COUNT" != "$COUNT" ] \
  || [ "$SECOND_DIGEST" != "$DIGEST" ]; then
  log_event fatal --arg stage second_source_pass --arg error_code unstable_source_snapshot >&2
  exit 37
fi

COMPLETENESS_STATUS=stable_two_pass_not_authoritative
if [ "$COUNT" -eq 0 ]; then
  COMPLETENESS_STATUS=empty_two_pass_not_authoritative
fi

SNAPSHOT_FILE="$SNAPSHOT_DIR/$DELIVERY_DATE.json"
TEMP_SNAPSHOT="$(mktemp "$SNAPSHOT_DIR/.$DELIVERY_DATE.XXXXXX")"
jq -cnS \
  --arg captured_at_utc "$CAPTURED_AT" \
  --arg delivery_date "$DELIVERY_DATE" \
  --arg completeness_status "$COMPLETENESS_STATUS" \
  --argjson summary "$SAFE_SUMMARY" \
  '{
    schema_version: 2,
    event: "daily_readonly_snapshot",
    source: "partner_api",
    captured_at_utc: $captured_at_utc,
    delivery_date: $delivery_date,
    source_selector: "partner_daily_deliveries_v1",
    stable_two_pass: true,
    authoritative_expected_total: false,
    completeness_status: $completeness_status,
    fleetbase_written: false,
    summary: $summary
  }' > "$TEMP_SNAPSHOT"
chmod 0600 "$TEMP_SNAPSHOT"

if [ -e "$SNAPSHOT_FILE" ]; then
  EXISTING_COUNT="$(jq -er '.summary.daily_orders | numbers' "$SNAPSHOT_FILE")"
  EXISTING_DIGEST="$(jq -er '.summary.source_digest | strings | select(test("^[a-f0-9]{64}$"))' "$SNAPSHOT_FILE")"
  if [ "$EXISTING_COUNT" != "$COUNT" ] || [ "$EXISTING_DIGEST" != "$DIGEST" ]; then
    log_event snapshot_conflict \
      --arg delivery_date "$DELIVERY_DATE" \
      --arg error_code existing_snapshot_differs >&2
    exit 38
  fi
  rm -f -- "$TEMP_SNAPSHOT"
  TEMP_SNAPSHOT=
  find "$SNAPSHOT_DIR" -maxdepth 1 -type f -name '*.json' -mtime "+$RETENTION_DAYS" -delete
  log_event snapshot_unchanged \
    --arg delivery_date "$DELIVERY_DATE" \
    --argjson daily_orders "$COUNT" \
    --arg source_digest "$DIGEST" \
    --argjson fleetbase_written false
  exit 0
fi

mv "$TEMP_SNAPSHOT" "$SNAPSHOT_FILE"
TEMP_SNAPSHOT=
find "$SNAPSHOT_DIR" -maxdepth 1 -type f -name '*.json' -mtime "+$RETENTION_DAYS" -delete

log_event daily_readonly_snapshot \
  --arg delivery_date "$DELIVERY_DATE" \
  --argjson daily_orders "$COUNT" \
  --arg source_digest "$DIGEST" \
  --arg completeness_status "$COMPLETENESS_STATUS" \
  --argjson fleetbase_written false
