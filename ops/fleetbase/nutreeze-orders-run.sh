#!/bin/sh
set -eu
umask 077

KEY_FILE=/root/nutreeze-vendor.key
CONTAINER=fleetbase-application-1
SCRIPT=/fleetbase/api/storage/app/integrations/nutreeze-orders.php
DRIVER_ROSTER=/fleetbase/api/storage/app/integrations/config/nutreeze-driver-roster.json
PICKUP_CONFIG=/fleetbase/api/storage/app/integrations/config/nutreeze-pickup.json

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
    --limit=*|--verify|--dry-run|--meal-since=*|--expected-count=*|--expected-digest=*|--confirm-daily-sync=*|--confirm-zero-day=*) ;;
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
set -- "$@" "--driver-roster=$DRIVER_ROSTER" "--pickup-config=$PICKUP_CONFIG"

exec docker exec -i "$CONTAINER" php "$SCRIPT" --token-stdin "$@" < "$KEY_FILE"
