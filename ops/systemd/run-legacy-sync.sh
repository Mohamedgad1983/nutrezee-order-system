#!/usr/bin/env bash
# Nutrezee 30-minute incremental legacy sync — DRY-RUN wrapper (STAGING ONLY).
# Double overlap guard: outer flock (grabbed by systemd/cron) + the node script's own
# PID lockfile. Never applies, never sends WhatsApp, never touches production.
# Logs counts/masked ids only — no raw PII, no DATABASE_URL, no secrets.
#
# Deploy target on the VPS: /opt/nutrezee/sync/run-legacy-sync.sh  (chmod 750, owner nutrezee)
# See docs/evidence/legacy_full_migration/25_incremental_sync_scheduled_dry_run.md
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/nutrezee/sync}"
CONTAINER="${CONTAINER:-nutrezee-api-1}"
SCRIPT_IN_CONTAINER="${SCRIPT_IN_CONTAINER:-/app/tools/legacy-full-migration/incremental-sync.mjs}"
ORDERS_JSON="${ORDERS_JSON:-/srv/orders_history.json}"
LOG_DIR="${LOG_DIR:-${APP_DIR}/logs}"
LOG="${LOG:-${LOG_DIR}/incremental-sync.log}"
HISTORY="${HISTORY:-${LOG_DIR}/run-history.jsonl}"
ALERT="${ALERT:-${LOG_DIR}/last-failure.json}"
LOCKFILE="${LOCKFILE:-/tmp/nutrezee-incremental-sync.lock}"
PIDLOCK="${PIDLOCK:-/run/nutrezee-incremental-sync.pid}"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

mkdir -p "${LOG_DIR}"

# ---- script-owned lockfile (independent of the outer flock) ----
if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  echo "$(TS) SKIP: previous run still active (pid $(cat "${PIDLOCK}"))" >>"${LOG}"
  exit 0
fi
echo $$ >"${PIDLOCK}"
trap 'rm -f "${PIDLOCK}"' EXIT

echo "$(TS) START incremental-sync (DRY-RUN, staging only, no WhatsApp)" >>"${LOG}"

# The node script appends a counts-only summary to ${HISTORY} and writes ${ALERT} on failure.
# It refuses to run unless SYNC_MODE=dry-run and SYNC_TARGET=staging (defense in depth).
set +e
docker exec \
  -e NOTIFY_DISABLE=1 \
  -e SYNC_MODE=dry-run \
  -e SYNC_TARGET=staging \
  -e RUN_HISTORY="${HISTORY}" \
  -e ALERT_FILE="${ALERT}" \
  "${CONTAINER}" \
  node "${SCRIPT_IN_CONTAINER}" "${ORDERS_JSON}" >>"${LOG}" 2>&1
rc=$?
set -e

if [[ $rc -eq 0 ]]; then
  echo "$(TS) OK incremental-sync rc=0" >>"${LOG}"
else
  echo "$(TS) FAIL incremental-sync rc=${rc} (see ${ALERT})" >>"${LOG}"
fi
exit $rc
