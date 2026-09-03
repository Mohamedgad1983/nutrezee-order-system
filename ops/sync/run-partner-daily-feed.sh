#!/usr/bin/env bash
# WP-OPS-06 (A47) — host wrapper for the Partner daily order feed.
# Copies partner-daily-feed.mjs into the running nutrezee-api container (which already holds
# DATABASE_URL, pg/argon2/ulid and the API on 127.0.0.1:3000) and runs it there, exactly like
# run-nightly-legacy-sync.sh runs apply-order-sync.mjs. Nothing Partner-related is read on the host.
# Env: FEED_MODE=dry-run|apply (default dry-run), ALLOW_APPLY=yes (apply only), FEED_DATES="YYYY-MM-DD ..."
set -euo pipefail
CONTAINER="${CONTAINER:-nutrezee-api-1}"
SCRIPT="${SCRIPT:-/opt/nutrezee/sync/partner-daily-feed.mjs}"
LOG_DIR="${LOG_DIR:-/opt/nutrezee/sync/logs}"
LOG="${LOG_DIR}/partner-daily-feed.log"
mkdir -p "${LOG_DIR}"
[[ -f "${SCRIPT}" ]] || { echo "missing ${SCRIPT}" >&2; exit 2; }
docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -qx true || { echo "${CONTAINER} not running" >&2; exit 2; }
docker cp "${SCRIPT}" "${CONTAINER}:/srv/partner-daily-feed.mjs" >/dev/null
echo "$(date -u +%FT%TZ) START mode=${FEED_MODE:-dry-run} dates=${FEED_DATES:-auto}" >>"${LOG}"
set +e
docker exec \
  -e SYNC_TARGET=staging \
  -e FEED_MODE="${FEED_MODE:-dry-run}" \
  -e ALLOW_APPLY="${ALLOW_APPLY:-no}" \
  -e API="${API:-http://127.0.0.1:3000}" \
  -e FEED_DATES="${FEED_DATES:-}" \
  "${CONTAINER}" node /srv/partner-daily-feed.mjs 2>&1 | tee -a "${LOG}"
rc=${PIPESTATUS[0]}
set -e
echo "$(date -u +%FT%TZ) END rc=${rc}" >>"${LOG}"
exit "${rc}"
