# ops/systemd — Nutrezee scheduled jobs

Deployment artifacts for the **30-minute incremental legacy sync** (STAGING, DRY-RUN).

> **Current state: BUILT, NOT ENABLED.** These files live in the repo so the schedule is
> reviewable and reproducible. Nothing runs automatically until a human explicitly enables the
> timer on the VPS (§Enable). Until then the sync is a manual, dry-run operation only.
> No `apply`. No WhatsApp. No production. No destructive SQL.

## Files

| File | Role |
|---|---|
| `run-legacy-sync.sh` | Wrapper: flock + PID lock + masked log + run-history + alert file. Calls the dry-run node script inside the API container. |
| `nutrezee-legacy-sync.service` | `Type=oneshot` unit (non-reentrant). flock-guarded `ExecStart`. Hardened. No `[Install]` — triggered by the timer only. |
| `nutrezee-legacy-sync.timer` | `OnCalendar=*:0/30` (every 30 min). `Persistent=false` (no catch-up). |

The node script is `tools/legacy-full-migration/incremental-sync.mjs` — it **refuses** to run unless
`SYNC_MODE=dry-run` and `SYNC_TARGET=staging`, and emits a counts-only summary
(`started_at, finished_at, records_seen, would_create, would_update, would_skip, would_fail,
errors, duration_ms, watermark, next_cursor`). Full runbook + field reference:
`docs/evidence/legacy_full_migration/25_incremental_sync_scheduled_dry_run.md`.

## Install on the VPS (keep DISABLED)

```bash
# 1. Wrapper + logs dir
install -o nutrezee -g nutrezee -m 750 run-legacy-sync.sh /opt/nutrezee/sync/run-legacy-sync.sh
install -d -o nutrezee -g nutrezee /opt/nutrezee/sync/logs

# 2. Units
sudo cp nutrezee-legacy-sync.service /etc/systemd/system/
sudo cp nutrezee-legacy-sync.timer   /etc/systemd/system/
sudo systemctl daemon-reload

# 3. Confirm DISABLED (the required current state)
systemctl is-enabled nutrezee-legacy-sync.timer   # expect: disabled
systemctl status   nutrezee-legacy-sync.timer     # expect: inactive (dead)
```

## Manual dry-run (safe today)

```bash
/usr/bin/flock -n /tmp/nutrezee-incremental-sync.lock /opt/nutrezee/sync/run-legacy-sync.sh
tail -n 20 /opt/nutrezee/sync/logs/incremental-sync.log
tail -n 1  /opt/nutrezee/sync/logs/run-history.jsonl   # last counts-only summary
```

## Enable later (after dry-run proves stable — signed-off gate, see doc 25 §checklist)

```bash
sudo systemctl enable --now nutrezee-legacy-sync.timer
systemctl list-timers nutrezee-legacy-sync.timer   # confirm NEXT fire time
```

## Disable

```bash
sudo systemctl disable --now nutrezee-legacy-sync.timer
systemctl is-enabled nutrezee-legacy-sync.timer    # expect: disabled
```

Logs (`incremental-sync.log`, `run-history.jsonl`, `last-failure.json`) carry **counts, masked ids,
rc codes only** — never raw PII, `DATABASE_URL`, or secrets. They live on the VPS under
`/opt/nutrezee/sync/logs/` and are **not** committed.
