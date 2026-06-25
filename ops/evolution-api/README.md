# ops/evolution-api — self-hosted Evolution API v2 (WhatsApp gateway)

Repo copy of the **isolated** Evolution API stack deployed to the Nutreeze VPS.
Full step-by-step plan, tests, and issue log live in [`/PLAN.md`](../../PLAN.md).

- **Live stack (VPS):** `/opt/evolution/` — `docker-compose.yml` + `.env` (mode 600, **never committed**).
- **Public URL:** https://wa.13-140-159-201.sslip.io · **Manager:** `/manager`
- **Image (pinned):** `evoapicloud/evolution-api:v2.3.7` — **not `:latest`** (latest tracks the
  `2.4.0-rc` line, which requires mandatory license activation → `503 LICENSE_REQUIRED`).

## Isolation model
- `evolution-postgres` + `evolution-redis` live only on `evolution_internal` (`internal: true`):
  no internet egress, **no host ports**, unreachable from the existing nutrezee/ERPNext services.
- `evolution-api` is dual-homed on `evolution_internal` (DB/Redis) + the external `nutrezee_default`
  (egress + so the existing Caddy reverse-proxies it by name). No host port published.
- The only public surface is HTTPS via the existing Caddy (one appended site block).

## Files
- `docker-compose.yml` — identical to the VPS copy (no secrets).
- `.env.example` — variable template; the real `.env` is generated in place on the VPS with
  `openssl rand` (256-bit `AUTHENTICATION_API_KEY` + Postgres password).

## Operate (on the VPS, from `/opt/evolution`)
```bash
docker compose ps
docker compose logs -f evolution-api
docker compose pull && docker compose up -d   # update (re-pin a new tag first)
```
Backup (session lives in BOTH the PG volume and the instances volume) — see `/PLAN.md` → Backups.

> Do not create a WhatsApp instance here as part of deployment — that is an owner step with the
> dedicated reminder number.
