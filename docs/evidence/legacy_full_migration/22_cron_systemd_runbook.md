# Cron / systemd Runbook — 30-Minute Incremental Legacy Sync

> **Scope:** STAGING ONLY (`https://13-140-159-201.sslip.io`). Production is **never** touched by this job.
> **Status:** ⛔ **BUILT BUT DISABLED.** No cron line is active; no systemd timer is enabled. Nothing in this doc runs automatically until a human explicitly enables it (see §6). Until then the sync exists only as a manual, **dry-run** operation (§8).
> **Mode:** Dry-run by default. **No `apply`. No destructive SQL. No WhatsApp messages. No raw PII / secrets committed.**

---

## 1. What this job does

Calls the governed **M19 import** endpoints in **dry-run** mode to detect drift between the read-only legacy source (`nutreeze.com` admin) and the staging DB, in this fixed order:

1. `POST /imports/customer/dry-run`
2. `POST /imports/catalog/dry-run`
3. `POST /imports/active_plans/dry-run`

Each call is **idempotent and audited** by the API. The job only **reports** the diff (counts + exception deltas against `migration_exception_review`); it does **not** mutate business data and does **not** emit notifications. Promotion to `apply` is a separate, human-gated, out-of-band action — **not** part of this scheduled job.

### Hard rules honored
- Staging only — the script refuses to run if `DATABASE_URL` host is not the staging Postgres.
- Dry-run only — no `apply` path is wired into the scheduled command.
- No destructive SQL (no `DELETE`/`TRUNCATE`/`DROP`); read + dry-run diff only.
- No raw PII or secrets written to logs or git. Logs carry counts and masked identifiers only.
- No WhatsApp / notification dispatch (`NOTIFY_DISABLE=1`, outbox dispatch left to the API; this job sends nothing).
- Overlap-proof: **two** independent guards — `flock` (option A) / systemd `oneshot` non-reentrancy (option B), **plus** the script's own PID lockfile.

---

## 2. Layout on the VPS

```
/opt/nutrezee/sync/
├── incremental-sync.sh            # wrapper: flock target + script lockfile + logging
├── incremental-sync.node.mjs      # the actual dry-run M19 caller (built, committed)
├── .env.sync                      # DATABASE_URL etc. (chmod 600, NOT in git)
└── logs/
    └── incremental-sync.log       # rotated by logrotate (see §7)
```

`.env.sync` is sourced from the running API container's environment (§5) and is **never** committed. `chmod 600`, owner `nutrezee`.

---

## 3. Wrapper script — `/opt/nutrezee/sync/incremental-sync.sh`

Double overlap protection: an outer `flock` (the lock that cron/systemd grabs) **and** the script's own PID lockfile that survives even if invoked outside flock (e.g. manual run).

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# ---- config -------------------------------------------------------------
APP_DIR="/opt/nutrezee/sync"
LOCKFILE="/tmp/nutrezee-incremental-sync.lock"     # used by flock AND by the script
PIDLOCK="/run/nutrezee-incremental-sync.pid"       # script's own lockfile
LOG="${APP_DIR}/logs/incremental-sync.log"
CONTAINER="nutrezee-api-1"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

mkdir -p "${APP_DIR}/logs"

# ---- script-owned lockfile (independent of flock) -----------------------
# Guards manual invocations that bypass flock, and stale-lock cleanup.
if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  echo "$(TS) SKIP: previous run still active (pid $(cat "${PIDLOCK}"))" >>"${LOG}"
  exit 0
fi
echo $$ >"${PIDLOCK}"
trap 'rm -f "${PIDLOCK}"' EXIT

echo "$(TS) START incremental-sync (DRY-RUN, staging only, no WhatsApp)" >>"${LOG}"

# ---- run the dry-run M19 caller inside the api container ----------------
# Option 1 (default): exec into the already-running api container.
docker exec \
  -e NOTIFY_DISABLE=1 \
  -e SYNC_MODE=dry-run \
  -e SYNC_TARGET=staging \
  "${CONTAINER}" \
  node /app/apps/api/dist/tools/incremental-sync.node.mjs >>"${LOG}" 2>&1
rc=$?

# ---- Option 2 (alternative, commented): one-off container reusing api env
# DBURL="$(docker exec "${CONTAINER}" printenv DATABASE_URL)"
# docker run --rm --network container:"${CONTAINER}" \
#   -e DATABASE_URL="${DBURL}" -e NOTIFY_DISABLE=1 -e SYNC_MODE=dry-run -e SYNC_TARGET=staging \
#   -v "${APP_DIR}:/sync:ro" \
#   node:22-alpine node /sync/incremental-sync.node.mjs >>"${LOG}" 2>&1
# rc=$?

if [[ $rc -eq 0 ]]; then
  echo "$(TS) OK incremental-sync rc=0" >>"${LOG}"
else
  echo "$(TS) FAIL incremental-sync rc=${rc}" >>"${LOG}"
fi
exit $rc
```

```bash
chmod 750 /opt/nutrezee/sync/incremental-sync.sh
chown nutrezee:nutrezee /opt/nutrezee/sync/incremental-sync.sh
```

The Node entrypoint (`incremental-sync.node.mjs`) must, on startup, **assert** `SYNC_TARGET=staging` and `SYNC_MODE=dry-run` and abort (non-zero) otherwise — defense in depth so an accidental `apply` can never run from the scheduler.

---

## 4. Option A — crontab (with `flock -n`)

`flock -n` makes the run **non-blocking**: if the previous 30-min run is still holding the lock, this tick exits immediately instead of stacking up.

### Install — keep it DISABLED (default state, do this now)

Edit `crontab -e` for user `nutrezee` and paste the line **commented out**:

```cron
# === Nutrezee incremental legacy sync — STAGING, DRY-RUN, DISABLED ========
# Built but intentionally NOT enabled. Uncomment ONLY after sign-off (§6).
# Every 30 min; flock -n prevents overlap; output already redirected in wrapper.
# */30 * * * * /usr/bin/flock -n /tmp/nutrezee-incremental-sync.lock /opt/nutrezee/sync/incremental-sync.sh >> /opt/nutrezee/sync/logs/incremental-sync.log 2>&1
```

Leaving it commented = the documented disabled state. Verify nothing is scheduled:

```bash
crontab -l | grep -c '^\*/30 .*incremental-sync' || true   # expect 0
```

### Enable later (single edit)

Remove the leading `# ` from the `*/30` line only, then:

```bash
crontab -l | grep incremental-sync     # confirm exactly one ACTIVE (uncommented) line
```

### Disable again

Re-add the leading `# ` to that line (or delete it). Confirm with the grep above → 0 active lines.

---

## 5. Sourcing `DATABASE_URL` from the API container

`docker exec` (default path) inherits the container's own env, so `DATABASE_URL` is already correct inside `nutrezee-api-1` — nothing to copy.

For the one-off-container path (Option 2 in §3), pull it at runtime — **never** persist it to disk or git:

```bash
docker exec nutrezee-api-1 printenv DATABASE_URL   # used inline; do not echo into a committed file
```

If a `.env.sync` is used instead, generate it on the VPS only, `chmod 600`, and add `/opt/nutrezee/sync/.env.sync` to `.gitignore`. It is **out of scope of git** by policy.

---

## 6. Option B — systemd service + timer

Two units: a **oneshot** service (`Type=oneshot` is inherently non-reentrant — systemd will not start a second instance while one is active) plus a timer firing `*:0/30`. Combined with the wrapper's flock + PID lockfile, overlap is impossible.

### `/etc/systemd/system/nutrezee-incremental-sync.service`

```ini
[Unit]
Description=Nutrezee incremental legacy sync (STAGING, DRY-RUN) — built, disabled by default
Documentation=file:///opt/nutrezee/sync/RUNBOOK.md
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=nutrezee
Group=nutrezee
# flock here too, so a manual `systemctl start` can't overlap a cron run or itself
ExecStart=/usr/bin/flock -n /tmp/nutrezee-incremental-sync.lock /opt/nutrezee/sync/incremental-sync.sh
Nice=10
TimeoutStartSec=1200
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/nutrezee/sync/logs /run
PrivateTmp=false
```

> `PrivateTmp=false` is required so the unit shares `/tmp/nutrezee-incremental-sync.lock` with cron/manual runs. If you standardize on systemd only, you may set it `true` and move the lock under `ReadWritePaths`.

### `/etc/systemd/system/nutrezee-incremental-sync.timer`

```ini
[Unit]
Description=Run Nutrezee incremental legacy sync every 30 min (STAGING, DRY-RUN)

[Timer]
OnCalendar=*:0/30
Persistent=false
AccuracySec=30s
RandomizedDelaySec=20s
Unit=nutrezee-incremental-sync.service

[Install]
WantedBy=timers.target
```

### Install but KEEP DISABLED (default state, do this now)

Drop both files in place and reload — but **do not** enable:

```bash
systemctl daemon-reload
systemctl status nutrezee-incremental-sync.timer    # expect: inactive (dead), disabled
systemctl is-enabled nutrezee-incremental-sync.timer   # expect: disabled
```

The unit files existing on disk = "built." `disabled` + `inactive` = the required current state.

### Enable later

```bash
systemctl enable --now nutrezee-incremental-sync.timer
systemctl list-timers nutrezee-incremental-sync.timer   # confirm NEXT fire time
```

### Disable again

```bash
systemctl disable --now nutrezee-incremental-sync.timer
systemctl is-enabled nutrezee-incremental-sync.timer    # expect: disabled
```

---

## 7. Logging & rotation

All output goes to `/opt/nutrezee/sync/logs/incremental-sync.log` (wrapper redirects). systemd runs additionally land in the journal:

```bash
journalctl -u nutrezee-incremental-sync.service -n 100 --no-pager
```

Logrotate — `/etc/logrotate.d/nutrezee-incremental-sync`:

```
/opt/nutrezee/sync/logs/incremental-sync.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

Logs contain **counts, masked ids, rc codes only** — no raw PII, no `DATABASE_URL`, no secrets.

---

## 8. Manual dry-run (the only thing you should run today)

Run on demand without any scheduler. Safe to run anytime — it is dry-run, staging, no WhatsApp:

```bash
# Direct (recommended): same wrapper the scheduler would call, guarded by flock + PID lock
/usr/bin/flock -n /tmp/nutrezee-incremental-sync.lock /opt/nutrezee/sync/incremental-sync.sh
tail -n 40 /opt/nutrezee/sync/logs/incremental-sync.log
```

Or invoke the node caller straight inside the API container:

```bash
docker exec -e NOTIFY_DISABLE=1 -e SYNC_MODE=dry-run -e SYNC_TARGET=staging \
  nutrezee-api-1 node /app/apps/api/dist/tools/incremental-sync.node.mjs
```

Expected: exit 0, a printed diff summary (customer/catalog/active_plans dry-run counts + `migration_exception_review` delta), and **zero** writes / zero notifications.

---

## 9. Healthcheck & monitoring

| Check | Command | Healthy result |
|---|---|---|
| Timer disabled (now) | `systemctl is-enabled nutrezee-incremental-sync.timer` | `disabled` |
| No active cron line (now) | `crontab -l \| grep -c '^\*/30 .*incremental-sync'` | `0` |
| Last run rc (after enable) | `grep -E 'OK \|FAIL ' /opt/nutrezee/sync/logs/incremental-sync.log \| tail -1` | `... OK ... rc=0` |
| Freshness (after enable) | last `START` line < 35 min old | recent |
| No overlap occurred | `grep -c 'SKIP:' /opt/nutrezee/sync/logs/incremental-sync.log` | low / 0 |
| Lock not stale | `[ -e /run/nutrezee-incremental-sync.pid ] && kill -0 $(cat /run/nutrezee-incremental-sync.pid)` | no orphan pid |
| API reachable | `curl -fsS https://13-140-159-201.sslip.io/health` | `{"status":"ok",...}` |

Alerting (post-enable): page if no `OK` line appears within the last 60 min, or if any `FAIL` line appears. A run skipped via `SKIP:` is **not** an error.

---

## 10. Pre-enable checklist (sign-off gate)

- [ ] Confirmed `SYNC_TARGET=staging` and `DATABASE_URL` points at staging Postgres only.
- [ ] Manual dry-run (§8) exits 0 with a sane diff and **zero** writes.
- [ ] `flock` overlap test: start two wrappers back-to-back → second logs `SKIP:` / exits 0.
- [ ] `.env.sync` (if used) is `chmod 600` and git-ignored; no secrets/PII in `incremental-sync.log`.
- [ ] No WhatsApp/notification path reachable (`NOTIFY_DISABLE=1`, outbox untouched by job).
- [ ] Temp super-admin (if bootstrapped for testing) deleted; in-process password not persisted.
- [ ] Human approval recorded. **Only then** uncomment cron (§4) **or** `systemctl enable --now` (§6) — **never both.**

> **Reminder:** As of this runbook the job is **disabled**. Enabling is a deliberate, signed-off action. Until then: dry-run only, staging only, no WhatsApp, production untouched.
