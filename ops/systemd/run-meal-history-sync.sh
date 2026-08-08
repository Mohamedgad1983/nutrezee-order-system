#!/usr/bin/env bash
# Nutrezee m22 meal-history INCREMENTAL SYNC wrapper — VPS-ONLY, STAGING, DRY-RUN, DISABLED by default.
# Runs the read-only incremental-sync PLANNER (diffs new meal-history orders vs the m22 raw watermark
# and reports counts). It NEVER applies, NEVER scrapes the legacy site, NEVER sends WhatsApp, NEVER
# touches production. DB password is sourced from a VPS-only env file (never printed). Counts-only log.
#
# Application of any detected new orders is performed SEPARATELY by the gated tools — each with its own
# explicit token: meal-history-scrape-job.mjs (VPS GET scrape) then meal-history-import.mjs (gated apply).
#
# Deploy: /opt/nutrezee/legacy-meal-history/run-meal-history-sync.sh (chmod 750, owner root). NO timer.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/nutrezee/legacy-meal-history}"
SCRIPT="${SCRIPT:-${APP_DIR}/meal-history-incremental-sync.mjs}"
DB_ENV_FILE="${DB_ENV_FILE:-/opt/nutrezee/.env}"            # holds POSTGRES_PASSWORD — NOT committed
ORDERS_INDEX="${ORDERS_INDEX:-/opt/nutrezee/legacy-detail-2026/out/orders_index.jsonl}"
RUN_HISTORY="${RUN_HISTORY:-${APP_DIR}/meal-history-sync-run-history.jsonl}"
LOG="${LOG:-${APP_DIR}/meal-history-sync.log}"
PIDLOCK="${PIDLOCK:-/run/nutrezee-meal-history-sync.pid}"
WINDOW_DAYS="${SYNC_WINDOW_DAYS:-30}"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
mkdir -p "${APP_DIR}"

# ---- fail-fast (no secrets printed); this wrapper is dry-run only ----
[[ "${SYNC_MODE:-dry-run}" == "dry-run" ]] || { echo "$(TS) FAIL: this wrapper is dry-run only (got SYNC_MODE=${SYNC_MODE})" >>"${LOG}"; exit 2; }
[[ -f "${DB_ENV_FILE}" ]] || { echo "$(TS) FAIL: DB env file missing: ${DB_ENV_FILE}" >>"${LOG}"; exit 2; }

# ---- PID lock (independent of any outer flock) ----
if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  echo "$(TS) SKIP: previous meal-history sync still active (pid $(cat "${PIDLOCK}"))" >>"${LOG}"; exit 0
fi
echo $$ >"${PIDLOCK}"; trap 'rm -f "${PIDLOCK}"' EXIT

# ---- DB creds into THIS shell only (never echoed) ----
set -a; # shellcheck disable=SC1090
source "${DB_ENV_FILE}"; set +a
: "${POSTGRES_PASSWORD:?missing POSTGRES_PASSWORD}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-nutrezee}" PGDATABASE="${PGDATABASE:-nutrezee}"
export PGPASSWORD="${POSTGRES_PASSWORD}"

echo "$(TS) START meal-history-sync (DRY-RUN, staging, window=${WINDOW_DAYS}d, no WhatsApp, no scrape)" >>"${LOG}"
OUT="$(mktemp)"
set +e
SYNC_MODE=dry-run SYNC_TARGET=staging SYNC_WINDOW_DAYS="${WINDOW_DAYS}" \
  ORDERS_INDEX="${ORDERS_INDEX}" RUN_HISTORY="${RUN_HISTORY}" \
  node "${SCRIPT}" >"${OUT}" 2>&1
rc=$?
set -e
# only the counts-only SUMMARY line reaches the persistent log
grep -E '^SUMMARY ' "${OUT}" | tail -1 >>"${LOG}" || true
rm -f "${OUT}"
if [[ $rc -eq 0 ]]; then echo "$(TS) OK meal-history-sync rc=0" >>"${LOG}"; else echo "$(TS) FAIL meal-history-sync rc=${rc}" >>"${LOG}"; fi
exit $rc
