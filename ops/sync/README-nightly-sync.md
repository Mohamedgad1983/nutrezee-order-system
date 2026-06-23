# Nightly legacy → staging sync — runbook

Automatic nightly pull of **new** legacy orders into the new system. Runs at **02:30 Asia/Kuwait**.
Built on the pieces proven during the 2026-06 migration; the only new part is the orchestration +
the incremental fetch.

## What one run does (`ops/sync/run-nightly-legacy-sync.sh`)
1. **Legacy refresh (read-only, incremental):** `orders-index` + `orders-detail` (skips already-archived
   → only **new** orders).
2. **Validate the fetch:** if the index is empty/partial (< `MIN_INDEX_ROWS`=10k rows or < 4 statuses —
   i.e. legacy is down/erroring), **ABORT with an alert** — it will *not* "sync nothing" silently.
3. **Enrich** (`order_number → internal_id → "Contact no"`) + validate the output is a non-empty array.
4. **Snapshot** `pg_dump` **before any DB write**, integrity-checked, dumps > 14 days pruned.
5. **Customers:** extract genuinely-missing (single real name + valid Kuwait mobile; shared/test phones
   quarantined), **cap** `MAX_NEW_CUSTOMERS`=500, governed import (**fail-fast**).
6. **Plan + cap:** dry-run; **abort** if `would_create` > `MAX_NEW_ORDERS`=1000 or any `would_fail`; stop
   early if 0 new.
7. **Orders:** governed M19 apply (idempotent, **fail-fast**).
8. **Correctness probe (FAIL-CLOSED):** every order created *this run* must have stored phone == legacy
   page phone, map to exactly one customer, and be verifiable. **Any failure ⇒ ABORT before relink** +
   write `nightly-last-alert.json`.
9. **Relink** meal-history (exit recorded in the summary).

**Safety:** validated-fetch · snapshot-first + integrity + prune · per-night caps · idempotent
(`sync_record`) · fail-fast applies · **fail-closed** correctness probe · trap-cleaned PII temp files ·
lockfile · counts-only log. Never production, never WhatsApp, never customer email. Legacy is read-only.
Tunables (env): `MIN_INDEX_ROWS`, `MAX_NEW_CUSTOMERS`, `MAX_NEW_ORDERS`, `SNAP_RETAIN_DAYS`.

## Why two steps are yours (the assistant cannot do them)
The assistant is blocked by design from (a) logging into the legacy production system and (b) installing
systemd units. So **the one-time enablement is owner-run.** After that, the timer fires the job
autonomously every night — that scheduled path is *not* blocked.

## Enable it (owner, one time)
```bash
# 0. Prereqs already on the VPS: /opt/nutrezee/legacy-migration.env (legacy creds),
#    /opt/nutrezee/.env (POSTGRES_PASSWORD). The called scripts are deployed under
#    /opt/nutrezee/legacy-detail-2026/, /opt/nutrezee/legacy-meal-history/, and staged in
#    nutrezee-api-1:/srv (apply-order-sync.mjs, apply-customer-import.mjs, incremental-sync.mjs).

# 1. Install the orchestrator + units
install -m 750 -o root ops/sync/run-nightly-legacy-sync.sh /opt/nutrezee/sync/run-nightly-legacy-sync.sh
cp ops/systemd/nutrezee-nightly-legacy-sync.{service,timer} /etc/systemd/system/
systemctl daemon-reload

# 2. SUPERVISED FIRST RUN (foreground — watch it; nothing else should be running)
/opt/nutrezee/sync/run-nightly-legacy-sync.sh ; echo "exit=$?"
#    Review: tail -50 /opt/nutrezee/sync/logs/nightly-legacy-sync.log
#    Confirm: "probe OK (0 mismatches)" and a sane would_create. If the probe ABORTED, restore the
#    snapshot it names and investigate before enabling the timer.

# 3. Enable the nightly timer
systemctl enable --now nutrezee-nightly-legacy-sync.timer
systemctl list-timers nutrezee-nightly-legacy-sync.timer   # confirm next fire = 02:30 Kuwait
```

## Monitor
```bash
tail -f /opt/nutrezee/sync/logs/nightly-legacy-sync.log
tail  /opt/nutrezee/sync/logs/nightly-legacy-sync-history.jsonl   # one counts-only line per night
cat   /opt/nutrezee/sync/logs/nightly-last-alert.json 2>/dev/null # present only after a failure/abort
journalctl -u nutrezee-nightly-legacy-sync.service -n 50 --no-pager
```

## If a run aborts (correctness probe failed or any step died)
The job stops and writes `nightly-last-alert.json`. Nothing past the failed step ran. To roll back the
night's writes, restore the snapshot it named:
```bash
docker stop nutrezee-api-1
docker exec nutrezee-postgres-1 psql -U nutrezee -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='nutrezee' AND pid<>pg_backend_pid();"
docker exec -i nutrezee-postgres-1 pg_restore -U nutrezee -d nutrezee --clean --if-exists --no-owner < /opt/nutrezee/backups/nightly-pre-<ts>.dump
docker start nutrezee-api-1
```

## Disable / pause
```bash
systemctl disable --now nutrezee-nightly-legacy-sync.timer
```

## Housekeeping
Prune old snapshots periodically (they accumulate one per night):
`find /opt/nutrezee/backups -name 'nightly-pre-*.dump' -mtime +14 -delete`.
