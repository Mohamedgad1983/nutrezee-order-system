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
# In-container paths. The staging API image runs with workdir /srv and resolves node_modules at
# /srv/node_modules, so the dry-run script + its orders extract live under /srv (baked at image
# build for production; docker-cp'd for the manual pre-enable proof). Override for other layouts.
SCRIPT_IN_CONTAINER="${SCRIPT_IN_CONTAINER:-/srv/incremental-sync.mjs}"
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

# The node script refuses to run unless SYNC_MODE=dry-run and SYNC_TARGET=staging (defense in
# depth) and emits a counts-only `SUMMARY {json}` line. We run it inside the API container (where
# pg/argon2/ulid resolve), capture its output to the host log, and persist the summary to the
# host-side run-history (the script's own RUN_HISTORY/ALERT_FILE are container-internal and only
# used when it runs directly on the host).
OUT="$(mktemp)"
set +e
docker exec \
  -e NOTIFY_DISABLE=1 \
  -e SYNC_MODE=dry-run \
  -e SYNC_TARGET=staging \
  "${CONTAINER}" \
  node "${SCRIPT_IN_CONTAINER}" "${ORDERS_JSON}" >"${OUT}" 2>&1
rc=$?
set -e

cat "${OUT}" >>"${LOG}"
# Extract the bare summary line -> host run-history (counts only, no PII).
summary="$(grep -E '^SUMMARY ' "${OUT}" | tail -1 | sed 's/^SUMMARY //')"
if [[ -n "${summary}" ]]; then echo "${summary}" >>"${HISTORY}"; fi
rm -f "${OUT}"

if [[ $rc -eq 0 ]]; then
  echo "$(TS) OK incremental-sync rc=0" >>"${LOG}"
else
  echo "$(TS) FAIL incremental-sync rc=${rc} (see ${ALERT})" >>"${LOG}"
  if [[ -n "${summary}" ]]; then echo "${summary}" >"${ALERT}"; else echo "{\"ok\":false,\"rc\":${rc},\"at\":\"$(TS)\"}" >"${ALERT}"; fi
fi
exit $rc
