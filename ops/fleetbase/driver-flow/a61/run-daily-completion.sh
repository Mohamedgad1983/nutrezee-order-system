#!/bin/sh
# A29 + A61 daily rule — close yesterday's (and any older leftover) open orders.
# Cron: 01:00 host time (Europe/Berlin) = 02:00 Kuwait in summer, 03:00 in winter; both are before
# the ~03:00 kitchen collection and after every delivery of the previous day, and the host date
# equals the Kuwait date at run time. Batches of 500 with retries: Fleetbase's generatePublicId can
# throw under bulk insert; a failed batch rolls back and the next attempt re-covers it (idempotent).
set -u
BEFORE=$(date +%F)
LOG=/opt/fleetbase/backups/complete-backfill-2026-08-31/daily.log
DB_COUNT_SQL="SELECT COUNT(*) FROM orders WHERE company_uuid='2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c' AND deleted_at IS NULL AND status IN ('dispatched','started','not_delivered','returned_to_kitchen') AND scheduled_at IS NOT NULL AND DATE(scheduled_at) < '$BEFORE'"

echo "=== daily completion $(date -u +%FT%TZ) before=$BEFORE" >> "$LOG"
for i in 1 2 3 4 5 6 7 8; do
    R=$(/usr/bin/docker exec fleetbase-database-1 sh -c "mysql -uroot \"\$MYSQL_DATABASE\" -N -e \"$DB_COUNT_SQL\"")
    echo "batch $i: remaining=$R" >> "$LOG"
    [ "$R" = "0" ] && break
    /usr/bin/docker exec fleetbase-application-1 php /fleetbase/api/storage/app/integrations/nutreeze-complete-past-orders.php --before="$BEFORE" --limit=500 --apply --confirm=NUTREEZE >> "$LOG" 2>&1
done
R=$(/usr/bin/docker exec fleetbase-database-1 sh -c "mysql -uroot \"\$MYSQL_DATABASE\" -N -e \"$DB_COUNT_SQL\"")
echo "=== done $(date -u +%FT%TZ) remaining=$R" >> "$LOG"
