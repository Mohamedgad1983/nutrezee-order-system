#!/usr/bin/env bash
# Nutrezee m23 dish-detail (catalog) SCRAPE wrapper — VPS-ONLY, STAGING, READ-ONLY, DISABLED by default.
# Sources legacy creds from a VPS-only env file (never printed), asserts VPS context, and runs the
# read-only getMealsByType catalog scraper. Overlap-guarded (PID lock). Counts-only logs.
# NEVER production, NEVER local, NEVER mutation endpoints, NEVER WhatsApp, no PII/secrets. NO timer.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/nutrezee/dish-per-day}"
SCRIPT="${SCRIPT:-${APP_DIR}/dish-detail-scrape-job.mjs}"
ENV_FILE="${ENV_FILE:-/opt/nutrezee/legacy-migration.env}"   # holds LEGACY_* — NOT committed
OUTPUT_DIR="${OUTPUT_DIR:-${APP_DIR}/raw}"
LOG="${LOG:-${APP_DIR}/scrape.log}"
PIDLOCK="${PIDLOCK:-/run/nutrezee-dish-detail-scrape.pid}"
WINDOW="${WINDOW:-sample}"
LIMIT="${LIMIT:-5}"
CONCURRENCY="${CONCURRENCY:-1}"
RATE_MS="${RATE_MS:-1500}"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
mkdir -p "${APP_DIR}"

[[ -f "${ENV_FILE}" ]] || { echo "$(TS) FAIL: credentials env file missing: ${ENV_FILE}" >>"${LOG}"; exit 2; }
if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  echo "$(TS) SKIP: previous dish-detail scrape still active (pid $(cat "${PIDLOCK}"))" >>"${LOG}"; exit 0
fi
echo $$ >"${PIDLOCK}"; trap 'rm -f "${PIDLOCK}"' EXIT

set -a; # shellcheck disable=SC1090
source "${ENV_FILE}"; set +a
: "${LEGACY_BASE_URL:?missing LEGACY_BASE_URL}"; : "${LEGACY_ADMIN_EMAIL:?missing LEGACY_ADMIN_EMAIL}"; : "${LEGACY_ADMIN_PASSWORD:?missing LEGACY_ADMIN_PASSWORD}"

echo "$(TS) START dish-detail-scrape (STAGING, window=${WINDOW}, limit=${LIMIT}, conc=${CONCURRENCY})" >>"${LOG}"
OUT="$(mktemp)"
set +e
SCRAPE_ON_VPS=1 node "${SCRIPT}" \
    --mode "${SCRAPE_MODE:-dry-run}" --target staging --window "${WINDOW}" \
    --limit "${LIMIT}" --concurrency "${CONCURRENCY}" --rate-limit-ms "${RATE_MS}" \
    --resume --no-local --output-dir "${OUTPUT_DIR}" >"${OUT}" 2>&1
rc=$?
set -e
grep -E '^SUMMARY ' "${OUT}" | tail -1 >>"${LOG}" || true
rm -f "${OUT}"
if [[ $rc -eq 0 ]]; then echo "$(TS) OK dish-detail-scrape rc=0" >>"${LOG}"; else echo "$(TS) FAIL dish-detail-scrape rc=${rc}" >>"${LOG}"; fi
exit $rc
