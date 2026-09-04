#!/usr/bin/env bash
# Fleetbase daily backup — ISOLATED. Dumps Fleetbase's OWN MySQL (all app DBs) + tars its
# bind-mount data/config. Touches NOTHING about how nutrezee/evolution/ERPNext are backed up.
# Deployed at /opt/fleetbase/backup.sh (700, root); scheduled by /etc/cron.d/fleetbase-backup @ 05:00 UTC.
set -Eeuo pipefail
DIR=/opt/fleetbase
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/backups/$TS"
LOG="$DIR/backups/backup.log"
mkdir -p "$OUT"
TSn() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# 1) MySQL: dump every non-system database from Fleetbase's own DB container (root, empty pw, internal)
DBS=$(docker exec fleetbase-database-1 mysql -uroot -N -e "SHOW DATABASES" 2>/dev/null \
        | grep -ivE '^(information_schema|performance_schema|mysql|sys)$' | tr '\n' ' ')
if docker exec fleetbase-database-1 mysqldump -uroot --no-tablespaces --single-transaction \
        --databases $DBS 2>/dev/null | gzip -9 > "$OUT/fleetbase-mysql.sql.gz"; then :; else
  echo "$(TSn) FAILURE $TS mysqldump" >> "$LOG"; exit 1; fi

# 2) Config + storage (the install dir IS the data dir — bind mounts)
tar czf "$OUT/fleetbase-files.tgz" -C "$DIR" \
    api/.env api/storage/app console/fleetbase.config.json docker-compose.override.yml 2>/dev/null || true

# Retention: 14 days
find "$DIR/backups" -maxdepth 1 -type d -name '20*' -mtime +14 -exec rm -rf {} + 2>/dev/null || true

MY=$(stat -c %s "$OUT/fleetbase-mysql.sql.gz" 2>/dev/null || echo 0)
FB=$(stat -c %s "$OUT/fleetbase-files.tgz" 2>/dev/null || echo 0)
echo "$(TSn) SUCCESS $TS mysql=${MY}B files=${FB}B dbs=[$DBS]" >> "$LOG"
