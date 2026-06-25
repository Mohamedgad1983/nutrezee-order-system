# PLAN.md — Self-host Evolution API v2 on the Nutreeze VPS (isolated stack)

**Single source of truth** for deploying a self-hosted [Evolution API](https://doc.evolution-api.com/v2)
v2 (WhatsApp gateway) onto the Nutreeze VPS as a fully isolated Docker stack,
fronted by the existing Caddy over HTTPS. Execute top-to-bottom, run each test,
mark status, log every issue at the bottom.

- **Owner:** mohamed gad · **Date started:** 2026-06-24
- **Target:** Nutreeze VPS (`13.140.159.201`, Ubuntu 24.04, Docker 29.5.3 / Compose v5.1.4)
- **Public URL (chosen):** `https://wa.13-140-159-201.sslip.io` (sslip.io wildcard → zero DNS, auto-TLS)
- **Manager UI:** `https://wa.13-140-159-201.sslip.io/manager`
- **Stack location (VPS):** `/opt/evolution/` (compose + `.env`, mode 600)
- **Repo copy:** `ops/evolution-api/` (compose + `.env.example`, no secrets)

Status legend: `[ ]` pending · `[x]` done · `[!]` fixed (failed then resolved — see log)

---

## Verified research (Phase 0 — DONE)

Confirmed live against official sources 2026-06-24 (not memory):

| Item | Verified value | Why |
|---|---|---|
| Image | **`evoapicloud/evolution-api:v2.3.7`** | Current stable. `atendai/*` is deprecated (frozen v2.2.3). |
| Avoid `:latest` | latest = `2.4.0-rc` line | 2.4.0 adds **mandatory license activation** → `503 LICENSE_REQUIRED`. 2.3.x has no gate. |
| DB | PostgreSQL via Prisma (mandatory; `DATABASE_ENABLED` removed in v2) | `DATABASE_PROVIDER=postgresql` + `DATABASE_CONNECTION_URI` |
| Cache | Redis | `CACHE_REDIS_ENABLED=true`, `CACHE_REDIS_URI=redis://evolution-redis:6379/6` |
| Session persistence | `evolution_instances:/evolution/instances` | Baileys session store survives restarts |
| API port | 8080 (internal only; behind reverse proxy) | no host port published |
| Manager UI | bundled at `/manager` on the API container | no separate frontend/port-3000 container needed |
| Root/health | `GET /` → JSON `…"message":"…it is working!","version":"2.3.7"…` | step 6/7 test target |

Sources: GitHub Releases API (`/releases/latest` → 2.3.7, prerelease=false), Docker Hub
(`evoapicloud` current / `atendai` deprecated), repo `.env.example` + `src/config/env.config.ts`,
repo `docker-compose.yaml`, 2.4.0-rc release notes (license gate).

## Discovery snapshot (Phase 0 — DONE)

- OS Ubuntu 24.04.4; 8 vCPU; **23 GiB RAM (≈21 GiB available)**; 166 GB free disk; swap 0.
- Docker 29.5.3 + Compose v5.1.4 present (nothing to install).
- Reverse proxy = **Caddy** (`nutrezee-caddy-1`, `caddy:2-alpine`), owns 80/443, auto-TLS,
  config `/opt/nutrezee/repo/docker/Caddyfile`, on network `nutrezee_default`.
- Host ports occupied: 8080 (admin), 3000 (api), 5432 (app pg), 6379/11000/13000 (ERPNext redis),
  3306 (ERPNext mariadb), 8000/8090/9000 (ERPNext). → **new stack publishes NO host ports.**
- Existing data services NOT reused: dedicated Postgres + Redis for Evolution only.

---

## Decisions locked with owner

1. Subdomain: **`wa.13-140-159-201.sslip.io`** (sslip.io wildcard, zero DNS, instant Let's Encrypt).
2. Caddy → Evolution reach: **dual-home `evolution-api` on `nutrezee_default`** (mirrors how
   `hermes-webui` is wired; no host ports; Caddy resolves it by container name).

## Hard rules (may NOT auto-resolve — stop and ask if blocked by one)

- Work only inside the repo folder + the new isolated stack (`/opt/evolution`).
- Do NOT create any WhatsApp instance (stop after step 8).
- Do NOT modify/delete/restart existing containers, DBs, or the Caddy container config
  beyond adding the ONE new route (graceful `caddy reload`, no restart).
- No destructive commands outside the new stack. No host-level changes (swap/firewall/OS pkgs).

---

## Steps

### Step 1 — Write `docker-compose.yml` + `.env`
- **(a) Does:** Create `/opt/evolution/docker-compose.yml` (pinned `v2.3.7`) and a `.env`
  with a freshly generated 256-bit `AUTHENTICATION_API_KEY` and a strong Postgres password,
  generated in place on the VPS (mode 600); secrets masked in all output.
- **(b) Command:** write compose via MCP; generate `.env` with `openssl rand -hex 32` (key) and
  `openssl rand -hex 24` (pg pass) inside a `umask 177` heredoc; `chmod 600`.
- **(c) Test:** `cd /opt/evolution && docker compose config -q` (and a masked grep that the key/URI exist).
- **(d) Expected:** exits 0, no errors; resolves image `evoapicloud/evolution-api:v2.3.7`; key present (masked).
- **(e) Status:** [x] done — `docker compose config -q` exit 0; image=`evoapicloud/evolution-api:v2.3.7`; `evolution_internal` internal:true; `nutrezee_default` external:true; `.env` mode 600 (key 64-hex/256-bit, masked `00244d…35e8`).

### Step 2 — Pull images only
- **(a) Does:** Pre-pull the three pinned images without starting anything.
- **(b) Command:** `cd /opt/evolution && docker compose pull`
- **(c) Test:** `docker image inspect evoapicloud/evolution-api:v2.3.7 postgres:16-alpine redis:7-alpine`
- **(d) Expected:** all three present; Evolution image label/version = 2.3.7.
- **(e) Status:** [x] done — `evoapicloud/evolution-api:v2.3.7` (label version v2.3.7, digest `sha256:1bd8afc4…` matching research), `postgres:16-alpine`, `redis:7-alpine` all pulled.

### Step 3 — Bring up `evolution-postgres` alone
- **(a) Does:** Start only Postgres on the isolated net.
- **(b) Command:** `docker compose up -d evolution-postgres`
- **(c) Test:** wait for `healthy`; `docker exec evolution-postgres pg_isready -U evolution -d evolution`.
- **(d) Expected:** container `healthy`; `pg_isready` → "accepting connections".
- **(e) Status:** [x] done — healthy in 8s; `pg_isready` → "accepting connections"; attached ONLY to `evolution_internal`; host port `5432→null` (unpublished).

### Step 4 — Bring up `evolution-redis` alone
- **(a) Does:** Start only Redis on the isolated net.
- **(b) Command:** `docker compose up -d evolution-redis`
- **(c) Test:** `docker exec evolution-redis redis-cli ping`
- **(d) Expected:** container `healthy`; reply `PONG`.
- **(e) Status:** [x] done — healthy in 8s; `redis-cli ping` → `PONG`; AOF on; only on `evolution_internal`; host port `6379→null`.

### Step 5 — Bring up `evolution-api`
- **(a) Does:** Start the API; it runs Prisma migrations and connects to DB + Redis.
- **(b) Command:** `docker compose up -d evolution-api`
- **(c) Test:** logs show server start, no DB/Redis connection errors; container up; DB has tables.
- **(d) Expected:** logs show "HTTP server" listening on 8080; no `P1001`/`ECONNREFUSED`; migrations applied.
- **(e) Status:** [x] done — healthy at t+28s; logs: `Migration succeeded`, `redis ready`, `Repository:Prisma - ON`, `[SERVER] HTTP - ON: 8080`; 37 Prisma tables in `public`; zero connection errors.

### Step 6 — Verify health endpoint internally
- **(a) Does:** Hit `GET /` over the Docker network (no host port, no proxy yet).
- **(b) Command:** `docker exec nutrezee-caddy-1 wget -qO- http://evolution-api:8080/`
- **(c) Test:** response JSON contains "it is working" and `"version":"2.3.7"`.
- **(d) Expected:** the Evolution welcome JSON with version 2.3.7.
- **(e) Status:** [x] done — `GET /` → `{"status":200,"message":"Welcome to the Evolution API, it is working!","version":"2.3.7",…}` via `nutrezee-caddy-1`; api dual-homed on `evolution_internal`+`nutrezee_default`; host port `8080→null`.

### Step 7 — Add Caddy route for `wa.13-140-159-201.sslip.io`
- **(a) Does:** Append ONE site block to the existing Caddyfile and graceful-reload (no restart).
  `evolution-api` is already on `nutrezee_default` so Caddy resolves it by name.
- **(b) Command:** back up Caddyfile → append `wa…sslip.io { reverse_proxy evolution-api:8080 }`
  → `docker exec nutrezee-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
- **(c) Test:** `curl -sS https://wa.13-140-159-201.sslip.io/` from the VPS (valid TLS) returns the health JSON;
  `curl -I .../manager` → 200.
- **(d) Expected:** external HTTPS works, valid Let's Encrypt cert, welcome JSON; Manager UI loads.
- **(e) Status:** [x] done — Caddyfile backed up (`.bak-20260624-172354`), one block appended, `caddy validate` = "Valid configuration", graceful `caddy reload` exit 0 (container NOT restarted: `startedAt` unchanged, `restarts=0`). External `GET /` → welcome JSON v2.3.7; valid Let's Encrypt cert (CN=`wa.13-140-159-201.sslip.io`, Jun 24→Sep 22). `/manager/` → HTTP 200, `<title>Evolution Manager</title>` SPA loads.

### Step 8 — Final isolation re-check
- **(a) Does:** Confirm nothing existing was touched and all neighbours are healthy.
- **(b) Command:** re-list containers/ports; curl existing sites; confirm evolution data services have no host port.
- **(c) Test:** nutrezee admin/api/postgres + ERPNext (`erp.*`) + hermes (`gad.*`) still respond;
  `evolution-postgres`/`evolution-redis` bound to no host port; only new public surface is `wa.*`.
- **(d) Expected:** all pre-existing services unchanged and 200/healthy; new DB/Redis unpublished.
- **(e) Status:** [x] done — existing containers `startedAt` unchanged + `restarts=0` (none restarted); admin `200`, ERPNext `200`, hermes `302` (own login), app API `/health`→`{"status":"ok","service":"nutrezee-api"}`; host port set identical to pre-deploy (Evolution added none); `evolution-postgres`/`redis`/`api` host ports all `null`; evolution stack all `healthy`.

---

## Issues & Resolutions log

**No step failed — all 8 passed on first execution; no remediation/`[!]` needed.**
Two transient/expected behaviors observed and confirmed benign (logged for completeness):

1. **Step 7 — initial `tlsv1 alert internal error` for ~6s on first HTTPS hit.**
   - *Root cause:* not a fault — Caddy provisions the Let's Encrypt cert **on first request** (ACME HTTP-01). The two early polls hit the window before the cert existed.
   - *Resolution:* none required; cert issued and `GET /` returned the v2.3.7 welcome JSON at t+9s. Valid cert confirmed (issuer Let's Encrypt, CN=`wa.13-140-159-201.sslip.io`).
2. **Step 7 — `GET /manager` returned HTTP 301.**
   - *Root cause:* expected SPA path normalization — Evolution redirects `/manager` → `/manager/` (trailing slash).
   - *Resolution:* none required; following the redirect yields HTTP 200 with `<title>Evolution Manager</title>` + `<div id="root">` (SPA loads).

Minor cosmetic note (no action): the root JSON's `"manager"` field renders as `http://…/manager` rather than `https://`. Evolution builds it from the forwarded host but defaults the scheme to http; access over HTTPS works normally. Irrelevant until an instance/webhooks are configured (out of scope here).

---

## Backups (Evolution holds the WhatsApp session — back BOTH up) — AUTOMATED ✅

The WhatsApp pairing/session survives in **two** places, so a complete backup needs both:
- **`evolution_evolution_pgdata`** volume → Postgres (Instance creds/metadata, messages, contacts) — captured via `pg_dump`.
- **`evolution_evolution_instances`** volume → `/evolution/instances` Baileys file session store — captured via `tar`.

**Installed:** `/opt/evolution/backup.sh` (700, root) — see repo copy `ops/evolution-api/backup.sh`.
- Writes `evolution-pg.sql.gz` (`pg_dump --clean --if-exists --no-owner`, gzip -9) + `evolution-instances.tgz`
  into a timestamped folder `/opt/evolution/backups/<UTC-stamp>/`.
- **Schedule:** `/etc/cron.d/evolution-backup` → **daily 04:30 UTC** (clear of nutrezee 02:30 + e2scrub 03:10).
- **Retention:** rolling **14 days** (older `/opt/evolution/backups/20*` folders auto-deleted).
- **Log:** `/opt/evolution/backups/backup.log` — one `SUCCESS|…|pg=…B instances=…B` (or `FAILURE|…`) line per run.
- First manual run verified: `pg=12424B`, `instances=87B` (instances archive is tiny **until a WhatsApp
  instance exists** — empty volume today, by design), log line `SUCCESS`.

### Restore procedure (Evolution backups)
Restore BOTH artifacts from the **same** backup folder (DB Instance creds must match the Baileys session files):
```bash
cd /opt/evolution
BK=/opt/evolution/backups/<UTC-stamp>      # choose the folder to restore
docker compose stop evolution-api          # quiesce writers (do NOT touch other stacks)

# 1) PostgreSQL (the dump's --clean --if-exists drops+recreates objects, so it cleanly overwrites)
gunzip -c "$BK/evolution-pg.sql.gz" | docker exec -i evolution-postgres psql -U evolution -d evolution

# 2) Instances volume (wipe current content, then extract the tar back in)
docker run --rm -v evolution_evolution_instances:/dst -v "$BK":/in:ro alpine \
  sh -c 'rm -rf /dst/* /dst/.[!.]* /dst/..?* 2>/dev/null; tar xzf /in/evolution-instances.tgz -C /dst'

docker compose start evolution-api         # bring API back up
docker compose logs --tail 30 evolution-api   # confirm "redis ready" + "HTTP - ON: 8080"
```
Off-box copies: `scp -r` a `/opt/evolution/backups/<stamp>/` folder elsewhere; both files are self-contained.

---

## DONE — final state (2026-06-24)

All steps `[x]`. Stack `up -d`, all three containers `healthy`. Existing nutrezee app, ERPNext,
and Hermes verified untouched and responding. **No WhatsApp instance created (stopped at step 8 per the hard rule).**

- **API base URL:** `https://wa.13-140-159-201.sslip.io`
- **Manager UI:** `https://wa.13-140-159-201.sslip.io/manager`
- **API key:** stored in `/opt/evolution/.env` (VPS, mode 600) as `AUTHENTICATION_API_KEY` — 256-bit, masked `00244d…35e8`.
- **Image:** `evoapicloud/evolution-api:v2.3.7` (digest `sha256:1bd8afc4…`).
- **Next (owner, separate):** create the WhatsApp instance with the dedicated reminder number.
