# Ops tooling

Operator-side scripts for staging/production. Committed ready-to-wire; **the operator deploys + schedules them** — nothing here self-deploys.

## healthcheck.sh

Health + backup-freshness + disk check (MG-E7, `16_Deployment/operations_runbook.md §2`). Run by cron on the host; exits non-zero and optionally POSTs a webhook on any breach.

```bash
# manual
./healthcheck.sh                      # prints OK/BREACH per check; exit 0 (all ok) / 1 (any breach)

# defaults match the current staging VPS; override via env
HEALTH_URL=http://127.0.0.1:3000/health \
BACKUP_DIR=/opt/nutrezee/backups \
MAX_BACKUP_AGE_HOURS=26 DISK_PCT_MAX=85 \
ALERT_WEBHOOK=https://hooks.example/...   ./healthcheck.sh

# schedule (operator, on host) — every 5 minutes
# */5 * * * * /opt/nutrezee/tools/healthcheck.sh >> /var/log/nutrezee-health.log 2>&1
```

Checks: (1) `GET /health` → 200 + `{"status":"ok"}`; (2) newest `*.sql.gz` in the backup dir younger than `MAX_BACKUP_AGE_HOURS`; (3) disk usage under `DISK_PCT_MAX`. Health + backup-freshness are the two day-one non-negotiables before production go-live.

**Deploy step (operator, when wiring):** `vps_upload` the script to `/opt/nutrezee/tools/healthcheck.sh`, `chmod 755`, add the cron line, set `ALERT_WEBHOOK`. Not done automatically — scheduling on the live host is an operator action (production-risk).
