# OPS-WAHA — Replace the isolated Evolution gateway

Owner request, 2026-10-01: deploy WAHA as the replacement for `/opt/evolution`.
Scope: isolated `/opt/waha` stack, existing WhatsApp HTTPS route only, preserving
Evolution files/volumes/backups for rollback. No WhatsApp session creation,
pairing, message sends, Fleetbase vendor edits, or unrelated service restarts.

Predeclared files: `ops/waha/PLAN.md`, `docker-compose.yml`, `.env.example`,
`README.md`, `backup.sh`, `verify.py`, and an append-only session entry in
`19_Roadmap/build_progress_register.md`. Deployment credentials remain on VPS.
Existing Evolution API credential is reused; no secret generation.

Acceptance: digest-pinned official image, persistent sessions/media, no host
ports, authenticated API/dashboard, no auto-created session, HTTPS verification,
backup artifact verification, unaffected neighbouring container start times,
rollback documented. Existing consumer references must be inspected before
cutover: WAHA is not Evolution API-compatible.

Verified discovery: one Evolution instance, state `connecting`; VPS has ~6 GB
available RAM and 35 GB free disk. Fleetbase `.env` contains a gateway reference;
active provider and runtime references are being inspected before cutover.

## Deployment evidence — 2026-10-01

Verified WAHA 2026.9.1 CORE/GOWS; digest
`sha256:41283bd89922ec3f722e5a772b844c451634d4aa72e9c34043c3480184f970fe`.
Installed `/opt/waha`; existing strong credential reused, `.env` 0600, directories
0700. No host ports. Authenticated internal readiness 200; missing key 401.
Evolution backup: `/opt/evolution/backups/20261001-173522`. No files/volumes deleted.

HTTPS cutover verified: missing/wrong API key 401; correct key 200 and zero
sessions; dashboard and Swagger missing Basic auth 401 and valid auth 200.
TLS certificate trusted. Session/media probe files survived container recreation
and were removed after verification. Root-only backup archive readability passed.

Resolved startup: image includes its own Tini; removed duplicate Docker init.
Resolved proxy: active host Caddyfile and the existing read-only file mount refer
to different inodes and already differed in unrelated routes before this work.
Host WhatsApp block updated; a protected `/tmp/Caddyfile.waha` inside Caddy holds
the existing mounted config with only the WhatsApp block changed. Validated and
gracefully reloaded that file, preserving all existing running routes. Runtime
copy also saved as `/opt/waha/Caddyfile.runtime.waha`. Do not reload the stale
`/etc/caddy/Caddyfile`: it would restore the old Evolution route. No Caddy restart.

Consumer inspection: Fleetbase gateway reference is commented out; active env
provider is Twilio; no active running container env reference to the old gateway
was found. This is not an exhaustive audit of external clients or DB-held config.
No Fleetbase source, settings or vendor files changed. Evolution stays running
internally as rollback capacity; its original HTTPS route now serves WAHA.

Remaining owner step: create/pair a WAHA session with the selected phone QR.
Message delivery and a paired-session restore drill are not verified.
