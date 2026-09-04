#!/usr/bin/env bash
# Nutrezee m22 meal-history SCRAPE wrapper — VPS-ONLY, STAGING, manual-run by default.
# Sources legacy credentials from a VPS-only env file (never committed, never printed), asserts VPS
# context, and runs the GET-only scraper. Overlap-guarded (flock -n + PID lock). Counts-only logs.
# NEVER production, NEVER full-history (unless ALLOW_FULL_HISTORY_SCRAPE=1), NEVER local, no PII/secrets.
#
# Deploy: /opt/nutrezee/legacy-meal-history/run-meal-history-scrape.sh (chmod 750, owner nutrezee/root)
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/nutrezee/legacy-meal-history}"
# The scraper has NO DB dependency (pure Node builtins) and writes host paths under /opt/nutrezee,
# so it runs on the VPS HOST with plain node — NOT inside the api container (whose fs has no
# /opt/nutrezee). The script + its sibling lib live under APP_DIR.
SCRIPT="${SCRIPT:-${APP_DIR}/meal-history-scrape-job.mjs}"
ENV_FILE="${ENV_FILE:-/opt/nutrezee/legacy-migration.env}"   # holds LEGACY_* — NOT committed
OUTPUT_DIR="${OUTPUT_DIR:-${APP_DIR}/raw}"
LOG="${LOG:-${APP_DIR}/scrape.log}"
LOCKFILE="${LOCKFILE:-/tmp/nutrezee-meal-history-scrape.lock}"
PIDLOCK="${PIDLOCK:-/run/nutrezee-meal-history-scrape.pid}"
WINDOW="${WINDOW:-last-90}"
LIMIT="${LIMIT:-10}"
CONCURRENCY="${CONCURRENCY:-1}"
RATE_MS="${RATE_MS:-1200}"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
mkdir -p "${APP_DIR}"

# ---- fail-fast (no secrets printed) ----
[[ "${WINDOW}" == "full" || "${WINDOW}" == "all" || "${WINDOW}" == "last-year" ]] && [[ "${ALLOW_FULL_HISTORY_SCRAPE:-0}" != "1" ]] \
  && { echo "$(TS) FAIL: full-history scrape refused (set ALLOW_FULL_HISTORY_SCRAPE=1 deliberately)" >>"${LOG}"; exit 2; }
[[ -f "${ENV_FILE}" ]] || { echo "$(TS) FAIL: credentials env file missing: ${ENV_FILE}" >>"${LOG}"; exit 2; }

# ---- PID lock (independent of the outer flock) ----
if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  echo "$(TS) SKIP: previous scrape still active (pid $(cat "${PIDLOCK}"))" >>"${LOG}"; exit 0
fi
echo $$ >"${PIDLOCK}"; trap 'rm -f "${PIDLOCK}"' EXIT

# ---- load creds into THIS shell only (never echoed) ----
set -a; # shellcheck disable=SC1090
source "${ENV_FILE}"; set +a
: "${LEGACY_BASE_URL:?missing LEGACY_BASE_URL}"; : "${LEGACY_ADMIN_EMAIL:?missing LEGACY_ADMIN_EMAIL}"; : "${LEGACY_ADMIN_PASSWORD:?missing LEGACY_ADMIN_PASSWORD}"

echo "$(TS) START meal-history-scrape (STAGING, window=${WINDOW}, limit=${LIMIT}, conc=${CONCURRENCY})" >>"${LOG}"

OUT="$(mktemp)"
set +e
# runs on the HOST; creds already sourced into this shell's env (never echoed); SCRAPE_ON_VPS asserts VPS.
SCRAPE_ON_VPS=1 node "${SCRIPT}" \
    --mode "${SCRAPE_MODE:-scrape}" --target staging --window "${WINDOW}" \
    --limit "${LIMIT}" --concurrency "${CONCURRENCY}" --rate-limit-ms "${RATE_MS}" \
    --resume --no-local --orders-source extract --output-dir "${OUTPUT_DIR}" >"${OUT}" 2>&1
rc=$?
set -e

# only the counts-only SUMMARY line reaches the persistent log (raw stdout may name internal_ids only)
grep -E '^SUMMARY ' "${OUT}" | tail -1 >>"${LOG}" || true
rm -f "${OUT}"
if [[ $rc -eq 0 ]]; then echo "$(TS) OK meal-history-scrape rc=0" >>"${LOG}"; else echo "$(TS) FAIL meal-history-scrape rc=${rc}" >>"${LOG}"; fi
exit $rc
