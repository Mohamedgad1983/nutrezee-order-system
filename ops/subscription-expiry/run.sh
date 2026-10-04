#!/bin/sh
# Nutreeze daily subscription-expiry report (READ-ONLY legacy admin reading, Playwright in Docker).
# Reports + log: /var/log/nutrezee/subscription-expiry/  (root-only: customer names and phones).
# Credentials: /root/a68/legacy-admin.cred (owner-written, root 0600) — mounted read-only, never logged.
# One copy at a time (flock); up to 3 attempts for transient browser/network errors; login failure is not retried.
set -u
DIR=/opt/nutrezee/subscription-expiry
OUT=/var/log/nutrezee/subscription-expiry
CRED=/root/a68/legacy-admin.cred
LOG="$OUT/run.log"
umask 077
mkdir -p "$OUT"
exec 9>"$OUT/.lock"
if ! flock -n 9; then echo "$(TZ=Asia/Kuwait date '+%F %T') another run is in progress — skipped" >>"$LOG"; exit 75; fi
[ -f "$CRED" ] || { echo "$(TZ=Asia/Kuwait date '+%F %T') ERROR missing credential file (owner step)" >>"$LOG"; exit 10; }
attempt=1
while :; do
  docker run --rm --ipc=host --name nutreeze-subscription-expiry \
    -v "$DIR/app:/app:ro" -v /root/a68/legacy-app/node_modules:/app/node_modules:ro \
    -v "$CRED:/run/legacy-admin.cred:ro" -v "$OUT:/out" \
    -e LEGACY_CRED_FILE=/run/legacy-admin.cred -e EXPIRY_OUT_DIR=/out -e HOME=/tmp \
    -e EXPIRY_TODAY="${EXPIRY_TODAY:-}" -e EXPIRY_DAYS_AHEAD="${EXPIRY_DAYS_AHEAD:-3}" \
    -w /app mcr.microsoft.com/playwright:v1.60.0-noble \
    timeout 1500 node subscription-expiry.mjs "$@" >>"$LOG" 2>&1
  rc=$?
  [ "$rc" -eq 0 ] && exit 0
  if [ "$rc" -eq 10 ] || [ "$attempt" -ge 3 ]; then
    echo "$(TZ=Asia/Kuwait date '+%F %T') Job FAILED (exit $rc after $attempt attempt(s)); previous reports left untouched" >>"$LOG"
    exit "$rc"
  fi
  echo "$(TZ=Asia/Kuwait date '+%F %T') attempt $attempt failed (exit $rc) — retrying in 60 s" >>"$LOG"
  docker rm -f nutreeze-subscription-expiry >/dev/null 2>&1
  attempt=$((attempt + 1))
  sleep 60
done
