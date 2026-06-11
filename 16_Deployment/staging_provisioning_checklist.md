# Staging Provisioning Checklist — WP-14 Entry Gate

**Date:** 2026-06-11 · **Status:** Ready to execute — **blocked only on sponsor inputs §1** · **Owner:** Tech Lead
Expands `environment_plan.md` §3 (region note satisfied: AWS **me-south-1** interim, `20_Decisions/NOTE_pg_staging_region_interim.md`). Deploy target: current `main` = `bd51afe` (163 tests, 13/13 CI green, post-review). **No value below is invented — every `<placeholder>` must be supplied by the sponsor/operator.**

## 1. Required sponsor inputs (the ONLY missing pieces)

| # | Input | Format / constraint | Why |
|---|---|---|---|
| STG-1 | Platform choice for the container host | e.g. AWS ECS/Fargate, Lightsail, or small EC2 VM + `docker compose` [environment_plan §1 Proposed: VM+compose is simplest] | hosts the api + admin containers |
| STG-2 | Cloud account access | AWS account ID + IAM credentials (access key id + secret, SSO sign-in, or console session) with rights to create RDS + the STG-1 host **in me-south-1** | provisioning; *never committed — operator session only* |
| STG-3 | Managed PostgreSQL 16 instance | endpoint `<host>:<port>`, **PITR on**, nightly dump schedule | environment_plan §3 step 2; restore drill is a WP-14 entry item |
| STG-4 | DB credentials | db name (proposed `nutrezee`), user, password → composes `DATABASE_URL=postgres://<user>:<password>@<host>:<port>/<db>?sslmode=require` | the API/migrations/bootstrap secret (host secret store) |
| STG-5 | HTTPS endpoint | a domain or platform-issued TLS endpoint in front of admin+api | **mandatory** — the session cookie is `Secure`-only in the production image (D2); browser login fails over plain HTTP |
| STG-6 | First-admin bootstrap values | `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` (strong; argon2-hashed by the script, never stored plaintext) | `app/scripts/bootstrap-admin.mjs` |
| STG-7 | *(optional)* GitHub Actions deploy secrets | registry + host credentials if auto-deploy is wanted; manual deploy is acceptable for staging v1 | no deploy job exists today (D5) |

## 2. Exact runtime configuration surface (verified against code)

| Variable | Read at | Needed on staging | Notes |
|---|---|---|---|
| `DATABASE_URL` | `platform/config/database.ts:11`, `db/migrate.mjs`, `scripts/bootstrap-admin.mjs`, `scripts/export-rbac-matrix.mjs` | **yes (secret)** | pg gets `connectionString` only — TLS must ride the URL (`?sslmode=require`); pool connects lazily, so a wrong URL still boots (see smoke §6 step 5) |
| `PORT` | `main.ts:23` | optional (default 3000) | compose maps api 3000, admin 8080→80 |
| `NODE_ENV` | `auth.controller.ts:31` | baked `production` in `Dockerfile.api` | sole effect: `Secure` flag on `nz_session` → forces STG-5 |
| `OUTBOX_DISPATCHER` | `main.ts:14` | leave **unset** | `off` disables the 2s outbox/audit sweeps (tests only) |
| `BOOTSTRAP_EMAIL/PASSWORD/NAME` | `scripts/bootstrap-admin.mjs:8` | one-time run | NAME optional (default "Super Admin"); idempotent by email only — it never updates an existing user |
| `SESSION_SECRET` | **nowhere — dead config (D4)** | n/a | documented in `.env.example`/plan §2 but no code reads it: sessions are server-side rows with an opaque unsigned cookie id. Either wire it in later or strike it from §3 step 3; do not block on it |
| `DATABASE_URL_TEST` | tests only (`tests/helpers/db.ts`) | **never on staging** | `freshDb()` runs `DROP SCHEMA public CASCADE` — pointing it at staging destroys the DB |

CI currently uses **zero** GitHub secrets (service-container creds are inline) — nothing to rotate before provisioning.

## 3. Pre-deploy defects to fix at deploy time (found by code inspection 2026-06-11; all small, none fixable-verifiable without Docker/staging)

| # | Defect | Prescription |
|---|---|---|
| **D1** | **Admin SPA cannot reach the API in the compose topology.** `App.tsx` fetches relative paths (`/kitchen/board`, `/tickets/:id/transitions`, `/auth/*`) with `credentials:'include'`; `Dockerfile.admin` ships stock nginx with no proxy and no SPA fallback → every SPA API call 404s, deep-link `/kitchen` 404s | Add an nginx config to `Dockerfile.admin`: `try_files $uri /index.html` fallback, plus `proxy_pass http://api:3000` for the API prefixes: `auth, health, drafts, review-queue, orders, payment-reviews, payment-refunds, kitchen/, tickets, notifications, templates, reports, exports, bridge, imports, settings, staff, rbac`. **Caution:** proxy `location /kitchen/ { … }` (trailing slash) — the bare `/kitchen` path is the SPA board page and must fall through to `index.html`, while `/kitchen/board` etc. are API routes. Validate with `docker compose config` + `nginx -t` |
| **D2** | **No TLS anywhere, but the cookie is `Secure`-only** (`NODE_ENV=production` baked into the image) — browser login silently fails on plain HTTP | Terminate TLS at the platform LB or an added proxy (STG-5). curl-based smoke passes regardless (it sends the Cookie header manually) |
| **D3** | **The API image cannot run migrations** — final stage copies only `dist/` + `node_modules`; `db/migrate.mjs` + `db/migrations/` are absent, and the plan §4 requires migrations as an explicit gated pre-rollout step | Run migrations from a repo checkout with network reach to staging PG (command in §5). Longer-term: add a migrate stage/job image |
| **D4** | `SESSION_SECRET` is dead config (see §2) | Decide: wire (signed cookies) or strike from plan §3. Not blocking |
| **D5** | No deploy workflow exists (`ci.yml` has no deploy job despite plan §4 "deploy to staging (auto)") | Manual deploy per §5 is acceptable for staging v1; automate later |
| **D6** | `docker/compose.yml` + both Dockerfiles have **never been validated** (authored on a Docker-less machine — WP-00 register note; still no Docker on this machine 2026-06-11) | First step on any Docker-equipped machine: `docker compose config` + full build; expect first-run build issues |

## 4. Provisioning steps (= environment_plan §3, expanded)

1. ~~Region note~~ ✅ me-south-1 interim (`NOTE_pg_staging_region_interim.md`).
2. Provision managed PostgreSQL 16 in me-south-1 (STG-2/3): PITR on, nightly dump schedule; **document the restore drill here** (drill itself is a WP-14 entry item, environment_plan §4).
3. Provision the container host (STG-1); store secrets `DATABASE_URL` (+ bootstrap values for the one-time run) in the host secret store.
4. Fix D1 (+ optionally D4/D5), validate D6, build images from `main`, deploy behind TLS (STG-5/D2).
5. Run §5 deploy sequence + §6 smoke. Record the staging URL in `environment_plan.md` §3; flip gate ④ staging-half to ✅ in `build_progress_register.md`.

## 5. Deploy sequence for current `main` (`bd51afe`)

```bash
# from a checkout at main, Node >= 22, network reach to staging PG
cd app && npm ci --workspaces --include-workspace-root
export STAGING_DATABASE_URL='postgres://<user>:<password>@<host>:<port>/<db>?sslmode=require'

# 1. gated migration step (forward-only; 13 files 0001..0013; idempotent re-run prints "up to date")
DATABASE_URL="$STAGING_DATABASE_URL" node db/migrate.mjs

# 2. deploy containers (api + admin) per STG-1 platform, env DATABASE_URL from the secret store

# 3. one-time admin bootstrap (idempotent by email; creates staff_user + super_admin grant + HIGH audit)
BOOTSTRAP_EMAIL='<email>' BOOTSTRAP_PASSWORD='<password>' BOOTSTRAP_NAME='Staging Admin' \
  DATABASE_URL="$STAGING_DATABASE_URL" node scripts/bootstrap-admin.mjs
```

## 6. Smoke-test runbook (record results in the register; gate ④ flips only when ALL pass)

`API=https://<staging-host-api>` `ADMIN=https://<staging-host-admin>` — paths verified against controllers 2026-06-11.

| # | Step | Command | Expected |
|---|---|---|---|
| 1 | Migrations | `DATABASE_URL=… node db/migrate.mjs` (re-run) | `up to date`, exit 0 |
| 2 | Health | `curl -si $API/health` | `200` `{"status":"ok","service":"nutrezee-api"}` — **static handler: proves routing, NOT DB** |
| 3 | Unauth probe | `curl -si $API/drafts` | `401 {"error_code":"no_session"}` (controller mounted + cookie middleware active) |
| 4 | Login (first real DB proof) | `curl -si -D h.txt -H 'Content-Type: application/json' -d '{"email":"<email>","password":"<password>"}' $API/auth/login; SID=$(grep -i '^set-cookie: nz_session=' h.txt \| sed 's/.*nz_session=\([^;]*\).*/\1/')` | `200` body `{staff_id,name,roles:["super_admin"],locale}`; `Set-Cookie: nz_session=…; HttpOnly; SameSite=Lax; Secure`. **Max 1–2 bad-credential probes** — 5 failures lock the only admin (`login_lockout_threshold`=5; unlock = DB surgery) |
| 5 | whoami | `curl -si -H "Cookie: nz_session=$SID" $API/auth/me` | `200 {staff_id,name,email,locale,roles,masked:false}` — `masked` is a **boolean**; super_admin holds the pii grant so email is clear. A lesser role seeing `email:"***",masked:true` is correct masking, not failure |
| 6 | Authed read | `curl -si -H "Cookie: nz_session=$SID" $API/drafts` | `200 {"items":[],"page":{"limit":100}}` on a fresh DB |
| 7 | Logout | `curl -si -X POST -H "Cookie: nz_session=$SID" $API/auth/logout` | `200 {"ok":true}` + cookie cleared |
| 8 | Server-side revocation | repeat step 5 with old `$SID` | `401` — session row ended in DB, not just cookie cleared |
| 9 | Admin shell | `curl -si $ADMIN/` | `200` HTML containing the admin shell; after D1: `$ADMIN/kitchen` also 200 (SPA fallback) and the board's API calls proxy correctly |
| 10 | Background sweeps | check api logs / `SELECT count(*) FROM outbox_event WHERE dispatched_at IS NULL` after a login burst | undispatched count drains; note: sweep errors are swallowed (`.catch(() => undefined)`) — silence ≠ health, check the gauge |

**Caveats baked into the design (not failures):** `/health` is static (D-note step 2); session idle expiry slides 60 min — a paused smoke run must re-login; `bootstrap-admin` re-run says `user already exists — no action` and will NOT repair a missing role or reset a password.

## 7. After smoke passes

1. Record staging URL + smoke evidence in `environment_plan.md` §3 and the register run log; flip gate ④ to ✅.
2. Schedule the restore drill (WP-14 entry, plan §4) and document it in `environment_plan.md`.
3. WP-14 execution may then start per `19_Roadmap/wp14_blocker_report.md` §4 (workshop/sponsor items remain on its critical path).
