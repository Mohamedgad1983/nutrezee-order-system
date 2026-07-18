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

## Finishing tasks (post-deploy, 2026-06-25)

### Task 1 — Scheduled backups — [x] done
- `/opt/evolution/backup.sh` (700, root): `pg_dump` + instances `tar` → `/opt/evolution/backups/<UTC>/`,
  14-day retention, logs to `backup.log`. Repo copy: `ops/evolution-api/backup.sh`.
- Schedule: `/etc/cron.d/evolution-backup` (644 root) → **daily 04:30 UTC** (clear of nutrezee 02:30 + e2scrub 03:10).
- TEST (manual run): `evolution-pg.sql.gz` = **12 424 B** (valid gzip PostgreSQL dump),
  `evolution-instances.tgz` = **87 B** (valid tar — tiny because the instances volume is empty
  until a WhatsApp instance exists, by design), `backup.log` → `SUCCESS`. cron registered, no parse errors.
- Restore: see *Restore procedure (Evolution backups)* above.

### Task 2 — Commit docs on a new branch — [x] done
- Branch **`ops/evolution-api-v2-deploy`** (NOT main) · commit `299ccb7` · pushed to origin · **no PR/merge**.
- Committed (5 files, +412): PLAN.md, ops/evolution-api/{docker-compose.yml, .env.example, README.md, backup.sh}.
- Secret safety: real `/opt/evolution/.env` is VPS-only and git-ignored (`.gitignore:1:.env`);
  gitleaks 8.30.1 staged scan **and** commit scan → **no leaks found**.

---

## Side-task (2026-06-26) — READ-ONLY DB discovery report

Separate from the Evolution deploy above. Goal: full discovery of the customer/subscription
PostgreSQL DB on the VPS for two upcoming projects (Driver App + AI Customer Service).
Output: `/root/db_discovery_report.md` on the VPS. **Strictly read-only** — no DDL/DML;
every psql session forced read-only via `PGOPTIONS=-c default_transaction_read_only=on`.

- [x] STEP 1 — Identify target DB. → `nutrezee` on container `nutrezee-postgres-1`
      (127.0.0.1:5432), schema `public` (78 tables) + `analytics` (2 views). Confirmed by
      customer tables: customer=19482, address=9511, customer_phone=19377, customer_order=20203.
      NOT the Evolution/WhatsApp DB and NOT ERPNext MariaDB.
- [x] STEP 2 — Discovery: 79 base tables (52 with data, 27 empty) + 2 analytics views;
      per-table row counts, columns (type/null/PK/FK via pg_catalog), FK relationships.
- [x] STEP 3 — Samples: first 5 rows per non-empty table + both analytics views (un-masked).
- [x] STEP 4 — Data-quality notes: per-col NULL%/blank counts + cross-table findings
      (100% addresses lack geo pin; 51% customers no address; 13 non-Kuwait phones;
      0 phone-dup customers; 1,223 name collisions; date-as-text = 6 delivery_time cols).
- [x] STEP 5 — Wrote `/root/db_discovery_report.md` (≈133 KB, 2,502 lines). Done.

---

## Side-task (2026-06-26) — Legacy scraper verification + geo/address hunt (READ-ONLY first)

Separate task. Goal: confirm whether the legacy source actually holds geo/address data and
whether the scraper is still pulling fresh updates. Output: `/root/legacy_scraper_report.md`.
**Hard rule:** no login/forms/writes against the legacy admin without asking first.

### Phase 1 — VERIFY THE SCRAPER (read-only) — [x] done, reported, STOPPED at gate
- [x] Located the jobs under `/opt/nutrezee/` (not cron — a systemd timer + manual scripts):
      `sync/` (incremental order/customer sync), `legacy-meal-history/` (Playwright meal scraper),
      `legacy-detail-2026/` (Playwright order-detail/index/products extract), `address-import.mjs`.
- [x] Schedule/command/logs:
      - `nutrezee-legacy-sync.timer` = `OnCalendar=*:0/30` but **disabled + inactive (dead)** →
        `nutrezee-legacy-sync.service` (oneshot) runs
        `flock -n /tmp/nutrezee-incremental-sync.lock /opt/nutrezee/sync/run-legacy-sync.sh`
        which `docker exec nutrezee-api-1 node /srv/incremental-sync.mjs /srv/orders_history.json`
        (SYNC_MODE=dry-run, SYNC_TARGET=staging). Logs → `/opt/nutrezee/sync/logs/`.
      - journal for the service shows **no execution records** — only a cosmetic `Documentation=`
        invalid-URL parse warning. The timer has never fired (ships disabled by design).
- [x] Last activity (all manual):
      - incremental-sync dry-run: last **2026-06-18 01:10Z** (ok, would_create=0).
      - order-resync (plan-only): last **2026-06-21 12:14Z** (ok, would_create=0, watermark 24675).
      - meal-history Playwright scrape: last **2026-06-18 01:15Z → FAILED rc=1** (partial:
        7/8526 requests failed, ok:false) after the prior last-90 scrape ok 2026-06-17.
      - legacy-detail Playwright extract: **2026-06-16** (order_detail.jsonl, products, index).
- [x] DB freshness: newest `created_at` — customer 2026-06-21 12:49Z, customer_order 2026-06-21
      12:50Z, **address 2026-06-16 06:16Z (max_updated NULL — never updated)**. Address origin:
      legacy 9,506 / new 5; all bulk-loaded 2026-06-15→16. Newest import_batch 2026-06-21 12:50Z.
      → No automated freshness; nothing pulled since 2026-06-21; addresses frozen since 2026-06-16.

### Phase 2 — LOCATE GEO/ADDRESS IN LEGACY (read-only) — [x] done (no legacy login used)
- [x] Read scrapers (`address-import.mjs`, `extract-details.ts`, `legacy-detail-extract.mjs`) +
      analysed saved `customer_details.jsonl` (20,165 recs) and order/meals raw HTML.
- [x] **Structured address EXISTS** in legacy as a templated string `House no / Building Name /
      block / Street / Area / Contact no`; populated for **9,778/20,165 (48.5%)**. Captured into
      `customer_details.jsonl` but the importer wrote **only the area name** → House/Building/Street
      dropped. Recoverable with NO legacy access (re-parse the saved JSONL).
- [x] **Geo pins effectively ABSENT** — only 2/20,165 pasted a maps link (1 real coord), 1 lat,lng
      pattern; order/meals raw HTML has zero geo tokens. Caveat: scraper strips all tags + raw
      customer HTML not retained, so a map *widget* can't be 100% ruled out without one re-scrape (gated).
- [x] Scraper limitation: `extract-details.ts` truncates every field to **120 chars** → longest
      addresses cut mid-string.

### Phase 3 — FIX THE SCRAPER — [x] done: NO auto-fix applied (none qualified)
- [x] Nothing met the bar "contained technical break, no legacy login, no DB write." The schedule is
      disabled-by-design + dry-run (not broken); the only real failure (meal-history rc=1) needs a
      gated legacy re-run; the high-value fix (structured-address backfill) writes to staging → needs
      owner go-ahead. Reported with decisions A/B/C in `/root/legacy_scraper_report.md`.

### Forward plan (owner approved A=backfill, B=re-scrape, C=geo both) — 2026-06-26
Dry-run done (read-only, no writes). Report: `/root/address_backfill_dryrun.md`. Parser hits 99.8%.
- **A — structured-address backfill (dry-run DONE; apply PENDING approval).** Of 9,778 parsed legacy
  addresses: **would_enrich=9,678, would_create=31**, skip(no_phone=20/no_match=33/parse_fail=16);
  delivery_notes=704; area_resolved=9,635; contact differs from mobile=85.
  - [x] Parser + read-only dry-run preview.
  - [x] DECISION: schema **b1** (structured cols) + sequencing **backfill now, refine later** (owner).
  - [x] **APPLIED & VERIFIED 2026-06-26.** Migration `0022_address_structured_fields.sql` (house_no,
        building, block_floor_raw, street) applied + ledgered. Snapshot
        `pre-address-backfill-20260626T065926Z.dump`. Backfill: 9,492 enriched + 31 created (9,511→9,542,
        0 lost); house_no 9,408 / street 9,506 / block_floor_raw 9,381 / notes 274; **location_pin still 0**.
        Correctness probe 200/200, 0 mismatch. Provenance `created_by/updated_by='address-structured-backfill'`.
        Result: `/root/address_backfill_result.md`; evidence `docs/evidence/legacy_address_backfill/01_*`.
        First apply attempt rolled back cleanly (import_batch type CHECK) → re-applied without a batch row.
- **B — gated legacy re-scrape (PLAN only; not executed).** Purpose: untruncated full addresses
  (fix `extract-details.ts` 120-char cap), retry failed meal-history run, confirm/deny a map widget.
  Requires legacy login/session → **STOP & get final go before running** (account-flag risk).
  - [ ] Write exact read-only plan (pages, throttle, safety allowlist) then await explicit yes.
- **C — geo (both).** No pins in legacy. (i) Geocode parsed block/street/area → approx lat/lng into
  `location_pin` (EXTERNAL egress of addresses to a geocoder → own go/no-go); (ii) add pin-capture in
  the new system for accurate pins going forward. Depends on A landing first.

### Issues & Resolutions log (scraper task)
1. `import_batch` has no `status` column → it's `state` (+ `dry_run`, `counts`, `type`). Adjusted query.
2. `nutrezee-legacy-sync.service:4` invalid `Documentation=` URL → harmless systemd parse warning
   on every daemon-reload; candidate cosmetic fix (Phase 3) but not affecting runs.

---

## Side-task (2026-06-26) — Scraper fix + BLOCK-capture prep (gated at legacy login)

Branch `build/scraper-block-capture` (uncommitted). Report `/root/scraper_fix_report.md`.
Read-only/contained pass; live `address` table NOT written; no legacy login performed.

### Phase 1 — Fix the scraper (root cause + contained fix) — [x] done
- [x] Root cause (read-only): **no scheduled address scraper ever existed**. Only timer
      (`nutrezee-legacy-sync.timer`) is disabled + is the unrelated dry-run order-sync (no legacy,
      no address). Address data = manual one-off `extract-details.ts` runs 2026-06-14/15 → "frozen
      since 06-16" = manual passes ended, not a fault. Playwright+chromium present; no stuck lock;
      meal-history rc=1 (06-18) was partial + meal-only. (Did NOT re-enable the order-sync timer — it
      wouldn't touch addresses.)
- [x] Real defect = address PARSE: original flattened all HTML + sliced `Building Name`→`Street`,
      merging Block/Floor into the `0, 9` pair + 120-char truncation. **Fixed in code**:
      `legacy-address-parser.mjs` preserves row boundaries then tokenizes by full label set →
      `block` gets its own field. Offline self-test **4/4** (separates block; doesn't invent one
      from the ambiguous pair).
- [x] Scoped read-only test-pull wrapper `extract-block-sample.ts` (≤20, cap 25, GET-only, saves raw
      HTML, dry-run JSONL, never writes DB) + `compare-block-sample.mjs` + `RUNBOOK-block-sample.md`.
      **Smoke test (creds unset): exit 2 at guard, no browser, no legacy contact** — runnable & safe.

### Phase 2 — Verify BLOCK on ≤20 sample — [x] DONE (owner authorized the pull)
- [x] Owner authorized the one scoped pull. Contained env fixes to run on VPS: installed chromium
      build 1223 + `playwright install-deps chromium` (apt; no services restarted). Ran scoped
      ≤20-page READ-ONLY pull: **20/20 ok, 0 err**, raw HTML saved, dry-run JSONL, no DB write.
- [x] **Ground truth:** legacy `<address>` is positional; the Kuwait **BLOCK is the UNLABELLED number
      between `Building Name :` and `Street :`** (no "Block" label exists — that's why it was lost).
      Old flattener merged it into the `block_floor_raw = "<building>, <block>"` pair.
- [x] Parser rewritten to capture block positionally. **Self-test 5/5; live side-by-side BLOCK
      correctness = 14/14 = 100%** (20 sampled, 6 empty profiles). Report `/root/scraper_fix_report.md`.
- [x] Key finding: block already present as the **2nd number of existing `block_floor_raw`** → likely
      recoverable for the 9,381 backfilled rows **without a full re-scrape**.
- [x] Owner chose path (1): derive block from existing data. Read-only derivation dry-run → 8,707
      derivable; then exact rollback-dry-run → `UPDATE 8695` (verified, nothing persisted).
- [x] **APPLIED 2026-06-26** (owner approved, snapshot first): snapshot
      `pre-block-derive-20260626T110107Z.dump`; migration `0023_address_block.sql` (add `block`)
      ledgered; **UPDATE 8695** committed. Probe: block_filled=8,695, **correctness 8,695/8,695=100%**
      (block == block_floor_raw last number), `location_pin` still 0, total 9,542. 686 left NULL
      (644 no-comma + 12 >199 + ~30 junk like `haha, I`/`-, -`). Rollback handle `updated_by='block-derive'`.
      Repo: `app/db/migrations/0023_address_block.sql`. (2) full re-scrape NOT needed for block;
      (3) geocoding still HELD.

### Issues & Resolutions log (scraper-fix task)
1. Task premise ("scheduled scraper stopped 06-16") didn't match reality → reported the true root
   cause (never automated) instead of performing a no-op timer re-enable.
2. Block correctness is unverifiable offline (no raw customer HTML retained; parser strips tags) →
   prepared a raw-HTML-saving scoped pull; verification deferred to the gated run. Parser proven on
   synthetic fixtures (4/4) meanwhile.
3. Owner authorized me to run the ≤20-page pull. Pre-flight (no legacy contact) found Playwright 1.60.0
   wants chromium build 1223 → installed it (`npx playwright install chromium`), but launch still fails:
   **host missing ~7 chromium system libs** (libatk-1.0, libatk-bridge-2.0, libXcomposite, libXdamage,
   libXfixes, libasound, libatspi) — `--no-sandbox` doesn't help. Evidence the original scrapes ran on
   the owner's **Mac** (out/ files owned by uid 501/staff), so the VPS never ran this browser.
   → **BLOCKED: running on the VPS needs a HOST-level apt install** (`playwright install-deps chromium`),
   which exceeds the "run the pull" authorization + standing "no host OS-pkg changes" rule. STOP & ASK.
   Alt: owner runs the ≤20-page pull on their Mac with the same staged scripts (no host change).

---

## Side-task (2026-06-26) — Full relationship-graph map (READ-ONLY)

For Driver-App / Fleetbase planning. Output `/root/nutrezee_relationship_map.md` (Mermaid erDiagram +
FK graph + delivery path + gaps). Strictly read-only (`PGOPTIONS`); nothing modified.

- [x] **Full FK graph:** 100 real FKs + 23 implicit `*_id` (no FK). Delivery spine is fully FK-enforced
      (`customer_order.customer_id→customer`, `address.customer_id→customer`, `address.area_id→area`,
      `fulfillment_day.order_id→customer_order`, all ON DELETE RESTRICT). Implicit links are mostly
      legacy external ids + polymorphic `actor_id`/`entity_id`; flagged missing FKs:
      `driver_assignment_history.driver_id`, `packing_item.product_id`, `delivery_method/slot.import_batch_id`.
- [x] **Delivery path** order→customer→address→area/block/street traced + 6 real samples resolve end to
      end. **Critical:** `customer_order` has **no `address_id`** — resolves only because customers are
      **1:1 with addresses today** (`customer_multi_addr=0`). Frozen fields are area-name text only;
      `fulfillment_day.address_frozen` jsonb is null placeholders (530k rows).
- [x] **Counts** (of 20,203 orders): customer 100%, has-address 99.6%, **full area+block+street 86.1%
      (17,397)**, geo pin **0%**. Fail full address = 2,806 (2,726 miss block, 73 no address).
- [x] **Delivery tables EMPTY:** driver / driver_area / driver_shift / delivery_route /
      delivery_route_order = 0 (the Fleetbase plug-in point). area=127, address=9,542 populated.
- [x] **Gaps:** (1) no geo pins, (2) no order→address_id snapshot, (3) empty frozen address jsonb,
      (4) 14% no full address, (5) empty delivery layer, (6) free-text street/house quality.

---

## Side-task (2026-06-26) — Install Fleetbase (Driver App backend), fully isolated

Branch `build/fleetbase-install`. Report `/root/fleetbase_install_report.md`. RULE ZERO: protect every
running app. **Phase 1 = READ-ONLY discovery, DONE; STOPPED at the resource/isolation/clash gate.**

### Phase 1 — Discovery + resource + clash (read-only) — [x] done, awaiting approval
- [x] Research (verified multi-agent workflow, primary sources): pin **`v0.7.48`**; install via
      clone+compose (NOT the CLI — it forces `:latest` + host ports). 8 services
      (api×3, console, httpd, socket, redis:4, mysql:8.0-oracle). Default compose publishes **4 host
      ports: 3306, 8000, 4200, 38000**; bind-mount persistence; implicit `fleetbase_default` net.
- [x] Inventory (untouched): 8 running containers (nutrezee, evolution, hermes) + ERPNext/MariaDB as
      **host processes**. Bound host ports 22/53/80/443/3000/3306/5432/6379/8000/8080/8090/9000/11000/13000.
      Baseline saved `/root/fleetbase_preinstall_docker_state.txt`.
- [x] Resources: 8 vCPU (load 0.76), **~20 GiB RAM free**, 163 GB disk free, **0 swap**. Verdict: SAFE
      (≈16 GiB still free after Fleetbase). Caveat: build-time OOM risk → use prebuilt console image.
- [x] Clashes: only **3306 (ERPNext MariaDB) + 8000 (ERPNext gunicorn)** — both removed by publishing
      **zero host ports**. Network/container/volume names clash-free via `/opt/fleetbase` + `fleetbase-` prefix.
- [x] Before-baseline health recorded: nutrezee 200, api ok, ERPNext 200, Hermes 302, Evolution 200, all DBs healthy.
- [x] Isolation plan proposed (own net/MySQL/Redis, no host ports, dual-home 3 proxy services on
      nutrezee_default like Evolution, ADD 2 Caddy blocks `fleet.`+`fleetapi.`, own daily backups).

### Phase 2 — Install — [x] DONE & VERIFIED (owner approved; no swap; fleet.+fleetapi.)
- [x] Cloned v0.7.48 → `/opt/fleetbase`; override pins api image, **removes all 4 host ports**
      (`!reset null`), dual-homes console/httpd/socket on nutrezee_default (aliases). `docker compose
      config` confirmed ZERO published ports.
- [x] Built console (dev, so runtime fleetbase.config.json honored) + httpd locally; pulled
      api:v0.7.48 / mysql:8.0-oracle / redis:4-alpine / socketcluster:v17.4.0. APP_KEY pre-generated.
- [x] `up -d` (8 containers) + `deploy.sh` init (125 tables, seeded, 3 DBs). Internal checks via
      Caddy aliases: httpd→API 200 (`fleetbase 0.7.48`), console serves our runtime config, socket 200.
- [x] **Caddy: appended 2 blocks** (`fleet.`→console:4200, `fleetapi.`→httpd:80 + `/socketcluster/`→socket:8000),
      backup taken, `caddy validate`=Valid, graceful reload (StartedAt unchanged, restarts=0).
      External: fleet 200 (`<title>Fleetbase Console</title>`), fleetapi 200, valid LE cert.
- [x] **RULE ZERO verified:** all 7 pre-existing containers StartedAt UNCHANGED + restarts=0; host
      port set identical to baseline; existing sites root/erp/gad/wa unchanged (200/200/302/200);
      RAM used 2.9→4.5 GiB (Fleetbase ≈1.6 GiB), 18 GiB free.
- [x] Isolated daily backup (`/opt/fleetbase/backup.sh` + `/etc/cron.d/fleetbase-backup` 05:00 UTC,
      mysqldump+tar, 14d) tested OK. Report `/root/fleetbase_install_report.md`. AGPL = config-only.
- [ ] Owner follow-up: create first admin/org via console onboarding (no create-user CLI); optional
      cosmetic scheduler healthcheck override; add Maps/OSRM keys when wiring live routing.

### Issues & Resolutions log (Fleetbase task) — Phase 2 additions
3. Prebuilt `fleetbase-console` image is built `production` → `disableRuntimeConfig=true` → ignores
   fleetbase.config.json. Resolved by building console locally with upstream `development` default.
4. `deploy.sh` (migrate+seed) exceeds a single SSH timeout → ran it detached inside the container
   (idempotent/resumable); completed EXIT=0 (125 tables).
5. `scheduler` reports "unhealthy" — cosmetic: inherits the api image HTTP healthcheck but runs
   go-crond. Container up, not restarting. Documented; optional override later.

### Issues & Resolutions log (Fleetbase task)
1. ERPNext runs as host processes (not Docker) → its ports 3306/8000/8090/9000/11000/13000 are the real
   clash surface; caught via `ss -tlnp`, not just `docker ps`. Avoided by zero host ports for Fleetbase.
2. Official compose hardcodes `:latest` + builds console/httpd locally (OOM-prone) → pin via
   `docker-compose.override.yml` + `git checkout v0.7.48` + use prebuilt console image.

---

## Side-task (2026-06-26) — nutrezee ↔ Fleetbase integration (order bridge + status back)

Branch `build/fleetbase-integration`. Report `/root/nutrezee_fleetbase_integration.md`. READ-ONLY on
nutrezee + Fleetbase until approval; no real orders until 2B. API key from `/opt/fleetbase/integration.env`
(never printed).

### Phase 1 — Study the Fleetbase API (read-only) — [x] DONE, STOPPED for approval
- [x] Research (verified multi-agent workflow, source-grounded): auth `Authorization: Bearer` @ `/v1/`
      (NOT int/v1); `POST /v1/orders` requires `type|order_config` + (pickup+dropoff | waypoints≥2);
      places accept text address (server-geocoded); webhooks = `WebhookEndpoint` (console), HMAC body in
      header `Signature`; order events `order.dispatched/driver_assigned/completed/canceled` (one l), no
      `order.started` (use entity/waypoint activity).
- [x] Live read-only probe: auth **OK** (`GET /v1/orders`→200 `[]`); drivers/places/service-areas/zones/
      fleets/contacts all 200 `[]`; seeded `transport` order-config; flow `created→dispatched→started→
      enroute→completed(+canceled)`.
- [x] Field mapping nutrezee→Fleetbase done. **Gaps flagged:** (1) `address.location_pin` 100% NULL →
      coords missing; Fleetbase Google-geocodes KW addresses poorly → `Point(0,0)` junk (and no
      GOOGLE_MAPS_API_KEY set); (2) **dispatch-by-area NOT native** → build glue (area→fleet map); (3) no
      drivers/fleets/zones yet; (4) webhook needs console admin onboarding + secret.
- [x] **Design:** route by our clean **area text** (area→fleet map, sidesteps coords for routing); freeze
      address on order at dispatch (fixes the misroute fragility); module `modules/m24-fleetbase`;
      idempotent via `internal_id=order_number`; webhook receiver `POST /integrations/fleetbase/webhook`.

### Phase 2 — Build the module — [x] BUILT + 2B PASSED (owner approved 2A; coords=hold-pending-geocoding)
- [x] 2A approved. Built `modules/m24-fleetbase`: types, address-assembler (geo gate), order-mapper,
      fleetbase.client (Bearer env, contact upsert, HMAC), fleetbase.service (read-only load → freeze →
      geo gate → idempotent create → audit), fleetbase.controller (webhook, HMAC `Signature`, fail-closed).
      Migration `0024_fleetbase_dispatch.sql` (NOT applied to staging). Wired in app.module + main.ts rawBody.
- [x] **Quality green:** typecheck ✓, eslint ✓, unit 7/7 ✓, scan-no-get-mutation ✓, scan-cross-module-writes ✓.
- [x] **Geo policy honored:** orders without a real location_pin are HELD `pending_geocoding`, flagged,
      NEVER sent (no Point(0,0)); real-coord = present/numeric/≠0,0/in-Kuwait-bbox.
- [x] **2B PASSED** — 5 SAFE synthetic orders → live Fleetbase: 4 CREATED (201) with real pins +
      tracking (order_4tSHt8YOjb etc.), 1 HELD by the geo gate. Verified dropoff coords ≠0,0 + contact
      linked; visible in console. nutrezee real data UNTOUCHED (harness synthetic; 0024 not applied).
- [ ] STOPPED before real orders. Gated next: apply 0024 + deploy module; geocoding provider decision
      (Google/HERE); drivers/fleets/area→fleet map; register webhook (console + FLEETBASE_WEBHOOK_SECRET);
      central-kitchen pickup; wire dispatch trigger into order lifecycle.

### Issues & Resolutions log (integration task) — Phase 2 additions
3. Order create 400 "Failed to find or create customer" with inline customer object → Fleetbase needs a
   contact public_id. Added client.upsertContact (find by phone else create). Contact create also requires
   `email` (400 "Undefined array key email") → use customer.email or a `<order_number>@orders.nutrezee.local`
   placeholder. Re-test: 4/4 created (201).

### Issues & Resolutions log (integration task)
1. `int/v1` rejects API keys (it's the console session namespace) → public surface is the bare `/v1/`
   prefix (confirmed live: `/v1/orders`→200). Use `/v1/` + Bearer.
2. Dispatch-by-area is not built into Fleetbase (Order has no zone column) → design routes by nutrezee's
   existing area text via an area→fleet map, avoiding geofence/coords for the routing decision.

---

## DONE — final state (2026-06-24)

All steps `[x]`. Stack `up -d`, all three containers `healthy`. Existing nutrezee app, ERPNext,
and Hermes verified untouched and responding. **No WhatsApp instance created (stopped at step 8 per the hard rule).**

- **API base URL:** `https://wa.13-140-159-201.sslip.io`
- **Manager UI:** `https://wa.13-140-159-201.sslip.io/manager`
- **API key:** stored in `/opt/evolution/.env` (VPS, mode 600) as `AUTHENTICATION_API_KEY` — 256-bit, masked `00244d…35e8`.
- **Image:** `evoapicloud/evolution-api:v2.3.7` (digest `sha256:1bd8afc4…`).
- **Next (owner, separate):** create the WhatsApp instance with the dedicated reminder number.

---

## Appendix — Fleetbase SMTP for driver verification codes (2026-07-09)

Unrelated to the Evolution stack above; recorded here per request. Full detail in `PROGRESS.md` / `BLOCKERS.md`.
- **Access:** `nutrezee-vps` MCP reaches Fleetbase host 13.140.159.201 (verified). Accounting server 161.97.134.110 not touched.
- **Root cause:** `/opt/fleetbase/api/.env` `MAIL_MAILER=log` → OTP emails logged, never sent (sync send from `application` container).
- **Minimal fix:** set `MAIL_MAILER=smtp` + SMTP keys in `api/.env`; restart only `fleetbase-application-1`; pinned image `fleetbase-api:v0.7.48`.
- **Status:** blocked on SMTP secret (Mohamed places `MAIL_PASSWORD`). Login testable once live.
