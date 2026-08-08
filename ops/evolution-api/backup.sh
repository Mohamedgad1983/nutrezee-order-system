#!/usr/bin/env bash
# Evolution API v2 — daily backup of BOTH WhatsApp-session stores:
#   * evolution-postgres DB        -> logical pg_dump, gzip   (backs evolution_evolution_pgdata)
#   * evolution_evolution_instances -> Baileys file session store, tar.gz
# Writes a timestamped folder under /opt/evolution/backups, keeps 14 days, logs to backup.log.
# Install: perms 700, root-owned. Scheduled daily via /etc/cron.d/evolution-backup.
# Restore procedure: see /PLAN.md (repo) -> "Restore procedure (Evolution backups)".
set -euo pipefail

BACKUP_ROOT="/opt/evolution/backups"
LOG="${BACKUP_ROOT}/backup.log"
RETENTION_DAYS=14
PG_CONTAINER="evolution-postgres"
INSTANCES_VOLUME="evolution_evolution_instances"

TS="$(date -u +%Y%m%d-%H%M%S)"
DEST="${BACKUP_ROOT}/${TS}"

mkdir -p "${DEST}"

ts()   { date -u +%Y-%m-%dT%H:%M:%SZ; }
log()  { echo "$(ts) | $*" >> "${LOG}"; }
fail() { log "FAILURE | ${TS} | $*"; exit 1; }
trap 'fail "unexpected error (line ${LINENO})"' ERR

# 1) PostgreSQL logical dump (idempotent restore via --clean --if-exists)
if ! docker exec "${PG_CONTAINER}" sh -c \
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
      | gzip -9 > "${DEST}/evolution-pg.sql.gz"; then
  fail "pg_dump failed"
fi

# 2) Instances volume (Baileys session files)
if ! docker run --rm \
      -v "${INSTANCES_VOLUME}:/src:ro" \
      -v "${DEST}:/out" \
      alpine tar czf /out/evolution-instances.tgz -C /src . ; then
  fail "instances tar failed"
fi

# 3) Verify both artifacts exist and are non-empty
PG_SZ="$(stat -c%s "${DEST}/evolution-pg.sql.gz" 2>/dev/null || echo 0)"
IN_SZ="$(stat -c%s "${DEST}/evolution-instances.tgz" 2>/dev/null || echo 0)"
[ "${PG_SZ}" -gt 0 ] || fail "pg dump is empty"
[ "${IN_SZ}" -gt 0 ] || fail "instances tar is empty"

# 4) Retention: remove backup folders older than RETENTION_DAYS days
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -name '20*' \
     -mtime +"${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true

log "SUCCESS | ${TS} | pg=${PG_SZ}B instances=${IN_SZ}B dir=${DEST}"
echo "backup ok: ${DEST} (pg=${PG_SZ}B instances=${IN_SZ}B)"
