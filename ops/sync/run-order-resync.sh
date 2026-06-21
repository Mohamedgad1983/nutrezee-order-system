#!/usr/bin/env bash
# Ongoing order-resync ORCHESTRATOR (STAGING) — PLAN-ONLY monitor by default.
#
# Pipelines the validated, side-effect-free steps and reports counts:
#   1. enrich-orders.mjs  (offline: order_number -> internal_id -> "Contact no" phone)
#   2. incremental-sync.mjs --dry-run  (governed M19 plan: would_create / would_skip / would_fail)
# It NEVER applies, NEVER scrapes legacy, NEVER touches production, NEVER messages customers.
#
# The two consequential steps stay SEPARATE and DELIBERATE (each with its own guards):
#   * LEGACY REFRESH (pull fresh out/orders_index.jsonl + out/raw/view_<internal_id>.html.gz)
#       — owner-run, touches legacy production. See README-ongoing-resync.md.
#   * APPLY (apply-order-sync.mjs, ALLOW_APPLY=yes) — snapshot first, then the mandatory
#       correctness probe (stored customer phone == legacy page phone). See the runbook.
#
# Deploy: /opt/nutrezee/sync/run-order-resync.sh (chmod 750). Safe to schedule (read-only).
set -Eeuo pipefail

DIR="${RESYNC_DIR:-/opt/nutrezee/legacy-detail-2026}"
CONTAINER="${CONTAINER:-nutrezee-api-1}"
ENRICHED_HOST="${DIR}/orders_history_enriched.json"
ENRICHED_IN_CTR="/srv/orders_history_enriched.json"
LOG_DIR="${LOG_DIR:-/opt/nutrezee/sync/logs}"
LOG="${LOG:-${LOG_DIR}/order-resync.log}"
HISTORY="${HISTORY:-${LOG_DIR}/order-resync-history.jsonl}"
PIDLOCK="${PIDLOCK:-/run/nutrezee-order-resync.pid}"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
mkdir -p "${LOG_DIR}"

if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  echo "$(TS) SKIP: previous run active (pid $(cat "${PIDLOCK}"))" >>"${LOG}"; exit 0
fi
echo $$ >"${PIDLOCK}"; trap 'rm -f "${PIDLOCK}"' EXIT

echo "$(TS) START order-resync (PLAN-ONLY, staging)" >>"${LOG}"

# 1) enrich offline from the (possibly freshly-refreshed) archive
enrich="$(OUT="${ENRICHED_HOST}" node "${DIR}/enrich-orders.mjs" 2>>"${LOG}")"
echo "$(TS) enrich ${enrich}" >>"${LOG}"

# 2) governed dry-run plan inside the api container
docker cp "${ENRICHED_HOST}" "${CONTAINER}:${ENRICHED_IN_CTR}" >/dev/null
OUT="$(mktemp)"
docker exec -e NOTIFY_DISABLE=1 -e SYNC_MODE=dry-run -e SYNC_TARGET=staging \
  "${CONTAINER}" node /srv/incremental-sync.mjs "${ENRICHED_IN_CTR}" >"${OUT}" 2>&1 || true
summary="$(grep -E '^SUMMARY ' "${OUT}" | tail -1 | sed 's/^SUMMARY //')"
rm -f "${OUT}"
if [[ -n "${summary}" ]]; then echo "${summary}" >>"${HISTORY}"; echo "$(TS) plan ${summary}" >>"${LOG}"; fi

# would_create>0 means new linkable orders are waiting for a supervised apply (see runbook).
echo "${enrich}"
echo "${summary:-{\"ok\":false,\"note\":\"no plan summary\"}}"
echo "$(TS) OK order-resync" >>"${LOG}"
