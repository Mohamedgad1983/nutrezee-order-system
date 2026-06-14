#!/usr/bin/env bash
# Nutrezee staging/production health + backup-freshness check.
# Ready-to-schedule monitoring for MG-E7 (operations_runbook.md §2).
# The OPERATOR deploys + schedules this on the host (e.g. cron every 5 min) — it is
# committed here ready-to-wire; it does NOT deploy itself.
#
# Checks (each prints OK/BREACH; any BREACH -> non-zero exit + optional webhook):
#   1. App health endpoint returns 200 + {"status":"ok"}
#   2. Newest DB backup is fresher than MAX_BACKUP_AGE_HOURS
#   3. Disk usage on the backup/root volume is under DISK_PCT_MAX
#
# Config via env (sensible defaults for the current staging VPS):
#   HEALTH_URL          default http://127.0.0.1:3000/health
#   BACKUP_DIR          default /opt/nutrezee/backups
#   BACKUP_GLOB         default '*.sql.gz'
#   MAX_BACKUP_AGE_HOURS default 26   (nightly + 2h grace)
#   DISK_PCT_MAX        default 85
#   ALERT_WEBHOOK       optional; POSTed a text body on any BREACH
#
# Usage:  ./healthcheck.sh        # prints results, exits 0 (all OK) or 1 (any BREACH)
# Cron:   */5 * * * * /opt/nutrezee/tools/healthcheck.sh >> /var/log/nutrezee-health.log 2>&1
set -uo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
BACKUP_DIR="${BACKUP_DIR:-/opt/nutrezee/backups}"
BACKUP_GLOB="${BACKUP_GLOB:-*.sql.gz}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"
DISK_PCT_MAX="${DISK_PCT_MAX:-85}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
breaches=()

# 1. App health
code="$(curl -s -o /tmp/nz_health.$$ -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || true)"; code="${code:-000}"
body="$(cat /tmp/nz_health.$$ 2>/dev/null || true)"; rm -f /tmp/nz_health.$$
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"status":"ok"'; then
  echo "$(ts) OK    health: 200 ok ($HEALTH_URL)"
else
  echo "$(ts) BREACH health: code=$code body=${body:0:80} ($HEALTH_URL)"
  breaches+=("health code=$code")
fi

# 2. Backup freshness
newest="$(find "$BACKUP_DIR" -maxdepth 1 -name "$BACKUP_GLOB" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1)"
if [ -z "$newest" ]; then
  echo "$(ts) BREACH backup: no file matching $BACKUP_GLOB in $BACKUP_DIR"
  breaches+=("backup missing")
else
  mtime="${newest%% *}"; path="${newest#* }"
  now="$(date -u +%s)"; age_h=$(( (now - ${mtime%.*}) / 3600 ))
  if [ "$age_h" -le "$MAX_BACKUP_AGE_HOURS" ]; then
    echo "$(ts) OK    backup: ${age_h}h old (<= ${MAX_BACKUP_AGE_HOURS}h) $(basename "$path")"
  else
    echo "$(ts) BREACH backup: ${age_h}h old (> ${MAX_BACKUP_AGE_HOURS}h) $(basename "$path")"
    breaches+=("backup stale ${age_h}h")
  fi
fi

# 3. Disk usage on the backup volume (falls back to / if dir absent)
target_dir="$BACKUP_DIR"; [ -d "$target_dir" ] || target_dir="/"
pct="$(df -P "$target_dir" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
if [ -n "$pct" ] && [ "$pct" -lt "$DISK_PCT_MAX" ]; then
  echo "$(ts) OK    disk: ${pct}% used (< ${DISK_PCT_MAX}%) on $target_dir"
else
  echo "$(ts) BREACH disk: ${pct:-?}% used (>= ${DISK_PCT_MAX}%) on $target_dir"
  breaches+=("disk ${pct}%")
fi

# Result + optional alert
if [ "${#breaches[@]}" -eq 0 ]; then
  echo "$(ts) RESULT all OK"
  exit 0
fi
msg="Nutrezee health BREACH ($(ts)): ${breaches[*]}"
echo "$(ts) RESULT $msg"
if [ -n "$ALERT_WEBHOOK" ]; then
  curl -s --max-time 10 -X POST -H 'Content-Type: text/plain' --data "$msg" "$ALERT_WEBHOOK" >/dev/null 2>&1 \
    && echo "$(ts) alert: posted to webhook" || echo "$(ts) alert: webhook POST failed"
fi
exit 1
