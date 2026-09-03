#!/bin/sh
set -eu
umask 077

KEY_FILE=/root/nutreeze-vendor.key
CONTAINER=fleetbase-application-1
SCRIPT=/fleetbase/api/storage/app/integrations/nutreeze-orders.php
DRIVER_ROSTER=/fleetbase/api/storage/app/integrations/config/nutreeze-driver-roster.json
PICKUP_CONFIG=/fleetbase/api/storage/app/integrations/config/nutreeze-pickup.json
PARTNER_DRIVER_MAP=/fleetbase/api/storage/app/integrations/config/nutreeze-partner-driver-map.json
CAPTURE_CONFIG=''
NUTREEZEE_DB_CONTAINER=nutrezee-postgres-1
CAPTURE_HOST=''
LOCATION_RECOVERY_DATE=''

cleanup_location_captures() {
  if [ -n "$CAPTURE_HOST" ]; then
    find /var/tmp -maxdepth 1 -type f -name "$(basename "$CAPTURE_HOST")" -delete
  fi
  if [ -n "$CAPTURE_CONFIG" ]; then
    docker exec "$CONTAINER" find "$(dirname "$CAPTURE_CONFIG")" -maxdepth 1 -type f \
      -name "$(basename "$CAPTURE_CONFIG")" -delete >/dev/null 2>&1 || true
  fi
}
trap cleanup_location_captures EXIT HUP INT TERM

if [ ! -f "$KEY_FILE" ]; then
  printf '%s\n' 'vendor key file missing' >&2
  exit 20
fi

if [ -L "$KEY_FILE" ] || [ "$(stat -c '%F' "$KEY_FILE")" != "regular file" ] || [ "$(stat -c '%u' "$KEY_FILE")" != 0 ]; then
  printf '%s\n' 'vendor key must be a root-owned regular non-symlink file' >&2
  exit 22
fi

MODE="$(stat -c '%a' "$KEY_FILE")"
if [ "$MODE" != 600 ]; then
  printf '%s\n' 'vendor key file must have mode 0600' >&2
  exit 21
fi

DAILY=0
for ARG in "$@"; do
  case "$ARG" in
    --limit=*|--verify|--dry-run|--expected-count=*|--expected-digest=*|--confirm-daily-sync=*|--confirm-zero-day=*|--confirm-address-call-dispatch=*|--driver-orders-manifest=*) ;;
    --confirm-location-recovery=*) LOCATION_RECOVERY_DATE=${ARG#*=} ;;
    --delivery-date=*) DAILY=1 ;;
    *)
      printf '%s\n' 'unsupported runtime option' >&2
      exit 23
      ;;
  esac
done

if [ "$DAILY" -ne 1 ]; then
  printf '%s\n' 'daily delivery date is required' >&2
  exit 24
fi
set -- "$@" "--driver-roster=$DRIVER_ROSTER" "--pickup-config=$PICKUP_CONFIG" "--partner-driver-map=$PARTNER_DRIVER_MAP"

if [ -n "$LOCATION_RECOVERY_DATE" ]; then
  CAPTURE_HOST="$(mktemp /var/tmp/nutrezee-location-captures.XXXXXX)"
  CAPTURE_CONFIG="/fleetbase/api/storage/app/integrations/config/$(basename "$CAPTURE_HOST").json"
  chmod 600 "$CAPTURE_HOST"
  TABLE_PRESENT="$(docker exec "$NUTREEZEE_DB_CONTAINER" psql -U nutrezee -d nutrezee -Atc \
    "SELECT CASE WHEN to_regclass('public.driver_customer_location_capture') IS NULL THEN 0 ELSE 1 END;")"
  if [ "$TABLE_PRESENT" = 1 ]; then
    docker exec "$NUTREEZEE_DB_CONTAINER" psql -U nutrezee -d nutrezee -Atc \
      "SELECT coalesce(json_agg(json_build_object('partner_customer_ref',c.partner_customer_ref,'latitude',c.latitude,'longitude',c.longitude,'capture_id',c.id) ORDER BY c.partner_customer_ref),'[]'::json) FROM driver_customer_location_capture c WHERE NOT EXISTS (SELECT 1 FROM driver_customer_location_capture newer WHERE newer.supersedes_id=c.id);" \
      > "$CAPTURE_HOST"
  else
    printf '%s\n' '[]' > "$CAPTURE_HOST"
  fi
  docker cp "$CAPTURE_HOST" "$CONTAINER:$CAPTURE_CONFIG" >/dev/null
  docker exec "$CONTAINER" chown 0:0 "$CAPTURE_CONFIG"
  docker exec "$CONTAINER" chmod 600 "$CAPTURE_CONFIG"
  set -- "$@" "--location-captures=$CAPTURE_CONFIG"
fi

if docker exec -i "$CONTAINER" php "$SCRIPT" --token-stdin "$@" < "$KEY_FILE"; then
  STATUS=0
else
  STATUS=$?
fi
cleanup_location_captures
trap - 0 HUP INT TERM
exit "$STATUS"
