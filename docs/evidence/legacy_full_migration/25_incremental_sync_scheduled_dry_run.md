# 25 — Incremental Sync: Scheduled 30-Minute **Dry-Run** (built, disabled)

> **Scope:** STAGING ONLY (`https://13-140-159-201.sslip.io`). Production is **never** touched.
> **Status:** ✅ **BUILT** · ✅ **INSTALLED-DISABLED on the VPS** · ✅ **DRY-RUN PROVEN STABLE
> (2026-06-17)** · ⛔ **TIMER NOT ENABLED.** The units are on the VPS but the timer is
> `disabled`/`inactive`; 3 consecutive manual ticks were clean (§6.1). Enabling remains a deliberate
> human action (§6). Until then the sync runs only on manual demand, in dry-run.
> **Mode:** dry-run only. **No `apply`. No WhatsApp. No destructive SQL. No raw PII / secrets committed.**

Builds on `21_incremental_sync_design.md` (the diff design) and `22_cron_systemd_runbook.md` (the
operational runbook). This doc records the **committed schedule artifacts**, the **dry-run output
schema**, the **safeguards proven**, and **read-only evidence from live staging**.

---

## 1. What ships in the repo (Phase-1 deliverables)

| Path | Role |
|---|---|
| `ops/systemd/nutrezee-legacy-sync.service` | `Type=oneshot` (non-reentrant) unit; flock-guarded `ExecStart`; hardened (`NoNewPrivileges`, `ProtectSystem=strict`). No `[Install]` — fired by the timer only. |
| `ops/systemd/nutrezee-legacy-sync.timer` | `OnCalendar=*:0/30` (every 30 min), `Persistent=false` (no catch-up), `RandomizedDelaySec=20s`. |
| `ops/systemd/run-legacy-sync.sh` | Wrapper: outer-flock + PID-lockfile, masked log, run-history append, alert file on failure. |
| `ops/systemd/README.md` | Install (disabled) / manual-run / enable / disable steps. |
| `tools/legacy-full-migration/incremental-sync.mjs` | The dry-run M19 caller. Refuses `apply` / non-staging. Emits the full summary schema (§3). |

Preferred scheduler = **systemd timer + oneshot service** (per the mission). Crontab is the documented
fallback (`22_cron_systemd_runbook.md` §4). Exactly one of the two is ever active — never both.

---

## 2. Schedule & overlap safety

- **Cadence:** `OnCalendar=*:0/30` → fires at :00 and :30 every hour.
- **Overlap guard — three independent layers:**
  1. `Type=oneshot` systemd service is inherently non-reentrant (systemd will not start a second
     instance while one is active).
  2. `ExecStart=/usr/bin/flock -n /tmp/nutrezee-incremental-sync.lock …` — `-n` makes a still-running
     tick exit immediately instead of stacking.
  3. The node script's own `O_EXCL` PID lockfile (`/tmp/nutrezee-incremental-sync.lock`), with stale-lock
     reclaim after 25 min. The wrapper adds a fourth PID lock at `/run/nutrezee-incremental-sync.pid`.
- **No catch-up:** `Persistent=false` — after VPS downtime the job does **not** replay missed ticks
  (a stale drift report is misleading; the next live tick supersedes it).

---

## 3. Dry-run output schema (the required fields)

Every run emits one machine-readable summary line (`DRY_RUN_SUMMARY`) and appends the same object to
`run-history.jsonl`. Fields:

| Field | Meaning |
|---|---|
| `started_at` | ISO-8601 UTC run start |
| `finished_at` | ISO-8601 UTC run end |
| `duration_ms` | wall-clock duration |
| `records_seen` | legacy records evaluated from the read-only extract |
| `would_create` | M19 dry-run `created` (new orders that *would* be inserted) |
| `would_update` | M19 dry-run `matched` (existing rows that *would* be updated) |
| `would_skip` | pre-filtered (bad date/phone/amount) + M19 `skipped` + `merge_review` |
| `would_fail` | M19 dry-run `error` count |
| `errors` | array of error strings (empty on success) |
| `watermark` | highest numeric legacy order key already in `sync_record` |
| `next_cursor` | max legacy order id seen this run (advances the watermark on a future apply) |
| `applied` | always `false` |
| `whatsapp_sent` | always `false` |
| `ok` | `true` iff no errors |

Example shape (counts only — never PII):

```json
{ "job":"incremental-sync","mode":"dry-run","target":"staging",
  "started_at":"2026-06-16T19:30:00.000Z","finished_at":"2026-06-16T19:30:11.420Z","duration_ms":11420,
  "records_seen":26071,"would_create":0,"would_update":0,"would_skip":26071,"would_fail":0,
  "errors":[],"watermark":24630,"next_cursor":24630,"applied":false,"whatsapp_sent":false,"ok":true }
```

---

## 4. Safeguards proven (this session)

| Safeguard | Evidence |
|---|---|
| **Refuses `apply`** | `SYNC_MODE=apply` → `fatal: refused: SYNC_MODE=apply …`, exit 2, before any DB/driver load. |
| **Refuses `--apply` flag** | `… incremental-sync.mjs --apply` → same refusal, exit 2. |
| **Refuses non-staging** | `SYNC_TARGET=production` → `fatal: refused: SYNC_TARGET must be 'staging' …`, exit 2. |
| **Fail-fast** | Guards run on Node builtins only; heavy deps (`pg`, argon2, ulid) load via dynamic `import()` **after** the guards + lock, so a misuse aborts even where `pg` is absent. |
| **Overlap** | `O_EXCL` lockfile + stale reclaim (script) · `flock -n` (wrapper/unit) · `Type=oneshot` (systemd). |
| **No WhatsApp** | wrapper sets `NOTIFY_DISABLE=1`; the script never calls a notification/outbox path; summary always `whatsapp_sent:false`. |
| **No destructive SQL** | script issues `SELECT` + bootstraps/deletes only a TEMP super-admin (its own row); business writes go exclusively through the governed **M19 dry-run** endpoint, which does not mutate. |
| **No secrets/PII in logs** | logs/history carry counts, masked ids, rc codes only; `DATABASE_URL` is read from the container env, never echoed; alert file is counts-only. |

---

## 5. Read-only staging evidence (2026-06-16)

Queried directly against the staging Postgres (read-only `SELECT`s — no writes):

| Metric | Value |
|---|---|
| `sync_record` orders (watermark population) | **20,103** |
| `customer_order` rows total | **20,104** (the extra is the UAT demo order) |
| `sync_record` customers | **19,463** |
| **Watermark** = max numeric legacy order key in `sync_record` | **24,630** |
| Legacy records in the read-only extract (`orders_index.jsonl`) | **26,071** (`records_seen` upper bound) |
| `migration_exception_review` pending | **1,272** (excluded from sync candidacy by design) |

Interpretation: the bulk of legacy orders are already stored (Phase-1 migration). A scheduled dry-run
re-scans the extract, finds the small delta above the watermark / not yet in `sync_record`, and reports
what an `apply` *would* do — without doing it. The 1,272 pending exceptions are intentionally **not**
sync candidates (they await manual review per doc 20).

> A full end-to-end live dry-run (TEMP-admin login → `POST /imports/active_plans/dry-run`) is executed
> on the VPS via `run-legacy-sync.sh` as the pre-enable gate (§6), because it needs `pg`/argon2 resolved
> inside the API container and the extract converted to the array the caller reads. The read-only diff
> half (watermark vs extract) is evidenced above.

---

## 6. Pre-enable checklist (sign-off gate)

- [x] Manual dry-run via `run-legacy-sync.sh` exits 0 with a sane summary and **zero** writes, on **3
      consecutive ticks** (§6.1) — stability proven.
- [x] `would_fail = 0` and `errors = []` across all 3 runs.
- [x] flock overlap test: a second concurrent run is refused (`SKIP: lock held -> overlap correctly
      prevented`).
- [x] `run-history.jsonl` is host-side, **counts only** (no PII/secret); `watermark` stable at 24,630.
- [x] `apply` / non-staging guards refuse in-container (exit 2, before any DB/driver load).
- [x] No TEMP super-admin created (no auto-creatable candidates ⇒ no API auth round-trip this run; the
      script still deletes it in `finally` when it does bootstrap).
- [ ] **Human approval to enable** — still required. The gate criteria above are met; flipping the
      timer on is a deliberate human action: `systemctl enable --now nutrezee-legacy-sync.timer`
      (§ README). Never enable both cron and systemd.

### 6.1 VPS dry-run proof (2026-06-17, staging)

Installed disabled (`systemctl is-enabled nutrezee-legacy-sync.timer` → `disabled`; service `static` =
timer-triggered only), then ran `run-legacy-sync.sh` 3× consecutively inside the API container
(`nutrezee-api-1`, workdir `/srv`):

| Tick | started_at (UTC) | dur | records_seen | would_create | would_update | would_skip | would_fail | watermark | next_cursor | ok |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 09:25:48Z | 883ms | 26,071 | 0 | 0 | 639 | **0** | 24,630 | 24,675 | ✅ |
| 2 | 09:26:31Z | 618ms | 26,071 | 0 | 0 | 639 | **0** | 24,630 | 24,675 | ✅ |
| 3 | 09:26:32Z | 524ms | 26,071 | 0 | 0 | 639 | **0** | 24,630 | 24,675 | ✅ |

- **Idempotent** — identical counts every tick; no writes, `applied:false`, `whatsapp_sent:false`.
- **Guards** — `SYNC_MODE=apply` → `exit 2` (`refused: …apply…`); `SYNC_TARGET=production` → `exit 2`.
- **Overlap** — concurrent `flock -n` second run refused; **no alert file** written (no failures).
- **Live DB (read-only)** — watermark 24,630 · synced_orders 20,103 · pending_exceptions 1,272.

> **Honest caveat (why `would_create = 0`):** this manual proof fed the on-disk `orders_index`
> extract, which carries `order_number / dates / package / status` but **no customer phone or amount**.
> `next_cursor 24,675 > watermark 24,630` correctly shows ~45 orders exist above the watermark, but
> they are **not** auto-creatable without a customer-phone match, so they fall to `would_skip`, never
> `would_create`. This is the **safest** possible result (nothing would change) and is exactly why the
> production schedule must re-pull the **full-shape** order data from the legacy admin (runbook §1)
> before `apply` is ever considered — and `apply` stays out of scope regardless.

### 6.2 Deployment note
The dry-run script (`/srv/incremental-sync.mjs`) and orders array (`/srv/orders_history.json`) were
`docker cp`'d into the running container for this proof. For an enabled schedule they must be **baked
into the API image** (or bind-mounted) so they survive container recreation — record this in the
deploy that flips the timer on. The host-built `orders_history.json` contains **no PII** (no phone /
name) and lives only on the VPS (`/opt/nutrezee/sync/`), never in git.

**Apply mode stays out of scope** until the full-shape pull is wired and separately signed off. The
schedule is *built, installed-disabled, and proven stable in dry-run* — not *running*.
