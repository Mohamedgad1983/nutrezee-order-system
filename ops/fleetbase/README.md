# Fleetbase (Driver-App backend) — isolated self-host

Logistics Manager driver-password rotation is documented in
[`DRIVER_CREDENTIAL_ROTATION.md`](./DRIVER_CREDENTIAL_ROTATION.md) (WP-OPS-02 / A21).
Driver-to-driver bulk reassignment: [`DRIVER_ORDER_REASSIGNMENT.md`](./DRIVER_ORDER_REASSIGNMENT.md)
(WP-OPS-03 / A22).

Fleetbase **v0.7.48** installed 2026-06-26 as a fully isolated Docker stack on the VPS
(`/opt/fleetbase`), behind the shared Caddy, sharing **nothing** with the existing apps except the
Caddy proxy network. Report: `/root/fleetbase_install_report.md`. Repo branch `build/fleetbase-install`.

## Endpoints
- Console (Driver-App admin): **https://fleet.13-140-159-201.sslip.io**
- API + websockets: **https://fleetapi.13-140-159-201.sslip.io** (`/socketcluster/*` → socket)

## Install (clash-avoidance) — what was done
1. `git clone https://github.com/fleetbase/fleetbase.git /opt/fleetbase && git checkout v0.7.48`
2. `api/.env` from `api.env.example` here + `APP_KEY` (`docker run --rm fleetbase/fleetbase-api:v0.7.48
   php artisan key:generate --show`), mode 600.
3. `console/fleetbase.config.json` (this dir) — runtime API_HOST/socket for the console.
4. `docker-compose.override.yml` (this dir) — pins the api image to v0.7.48, **removes ALL 4 host ports**
   (`!reset null`), dual-homes console/httpd/socket on the external `nutrezee_default` net (aliases).
5. Build Console with the tracked A45 production overlay in `console/`: Ember `production`,
   `DISABLE_RUNTIME_CONFIG=false`, fingerprint-safe Nutrezee theme alias, gzip and governed cache
   headers. Do not use a development build to preserve runtime config.
6. `docker compose up -d` then `docker compose exec application sh deploy.sh` (migrate+seed; 125 tables).
7. Caddy: append `caddy-fleetbase.snippet` to `/opt/nutrezee/repo/docker/Caddyfile`, `caddy validate`,
   graceful `caddy reload`. (ADD-only; existing blocks untouched.)

## Isolation guarantees (verified)
- **Zero published host ports** (only reachable via Caddy on `nutrezee_default`).
- Own `fleetbase_default` network + own MySQL/Redis + bind-mount data under `/opt/fleetbase`.
- All pre-existing containers untouched (StartedAt unchanged, restarts=0); host port set unchanged.

## Backups
`/opt/fleetbase/backup.sh` (this dir) + `/etc/cron.d/fleetbase-backup` → daily **05:00 UTC**,
`mysqldump` (fleetbase + sandbox + storefront DBs) + `tar` (.env/storage/config) →
`/opt/fleetbase/backups/<UTC>/`, 14-day retention. Independent of the other apps' backups.

## Partner order snapshots

The A23/A24 read-only Partner snapshot runs daily at 01:00 Kuwait through
`nutreeze-partner-snapshot.timer`. It retains only sanitized aggregate manifests
under `/var/lib/nutreeze-partner-snapshots/` for 30 days. Because 01:00 precedes
the previously documented 06:00 Partner publication, every snapshot remains
explicitly non-authoritative. It never writes to the Partner/legacy source or
Fleetbase. The separate dispatch timer remains disabled; see
`PARTNER_DAILY_DISPATCH_RUNBOOK.md`.

## Data dirs (bind mounts — back these up, not Docker volumes)
`./docker/database/mysql` (MySQL data), `./api/.env`, `./api/storage/app`, `./console/fleetbase.config.json`.

## Follow-ups
- First admin/org: register via the console onboarding (no `create-user` CLI in v0.7.48).
- `scheduler` shows "unhealthy" — cosmetic (inherits the api HTTP healthcheck; runs go-crond).
- Add `GOOGLE_MAPS_API_KEY` / real `OSRM_HOST` when wiring live routing.
