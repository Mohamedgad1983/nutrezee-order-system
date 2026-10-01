# WAHA replacement gateway — OPS-WAHA

Deployment: `/opt/waha` on the existing VPS. HTTPS:
`https://wa.13-140-159-201.sslip.io/dashboard/`.
Image is pinned by immutable registry digest in `docker-compose.yml`.
No host ports, persistent `sessions/` and `media/`, 2 GB memory and 2 CPU limits,
bounded Docker logs, authenticated readiness check and automatic restart.

Login username: `admin`. Password and API key are the existing Evolution
`AUTHENTICATION_API_KEY`, reused server-side without generating new secrets.
Read credentials privately from `/opt/waha/.env` as root; never paste into logs,
issues, this repository, or URLs. API uses the `X-Api-Key` header.

The server deployment does not create/pair WhatsApp sessions or send messages.
The owner must create a session in the dashboard and scan its QR using the chosen
WhatsApp phone. Evolution session files cannot be reused as WAHA credentials.
Sending and receiving remain unverified until owner pairing and an explicitly
requested message test. WAHA endpoints/webhook payloads differ from Evolution;
this deployment does not claim transparent compatibility with old clients.

## Operate

```sh
cd /opt/waha
docker compose ps
python3 verify.py  # initial deployment only: expects zero sessions
```

Before an image upgrade, choose and verify a new digest explicitly. Do not switch
the installed compose to `latest`. Never print `docker compose config` or full
container environment: both expose credentials.

## Backup and restore

For paired sessions, stop only `waha-api` before running `sh backup.sh`, then
start it again. The root-only archive includes credentials, compose, sessions and
media. No automatic retention/deletion is configured; set an owner-approved
schedule and retention before relying on unattended operation. Initial empty
session/config backup is verified during deployment.

Restore into a stopped WAHA stack using the same image digest. Extract the
chosen archive into `/opt/waha` as root, preserve `.env` mode 0600 and directory
permissions 0700, then `docker compose up -d`. Do not merge mismatched session
snapshots. Initial backup validation proves archive readability, not a paired
WhatsApp restore drill.

## Rollback

Evolution stack and its existing backups are preserved at `/opt/evolution`.
The pre-cutover Caddy file is protected under `/opt/waha/`. To roll back, change
only the `wa.13-140-159-201.sslip.io` block in the current active Caddyfile back to
`reverse_proxy evolution-api:8080`, validate and gracefully reload Caddy. Do not
restore the entire saved Caddyfile over subsequent unrelated route changes.
No unrelated container restart is required. `/manager` redirects to WAHA's
`/dashboard/` on the replacement route.

## Existing Caddy mount caveat

The pre-existing read-only bind mount is stale relative to its host pathname.
The running proxy was gracefully reloaded from `/tmp/Caddyfile.waha` inside the
container (protected copy `/opt/waha/Caddyfile.runtime.waha`). Until a separately
planned Caddy recreation remounts the current host file, use this runtime file
for validation/reload and change only the required route. The host
`/opt/nutrezee/repo/docker/Caddyfile.active` already has the WAHA route for future
container recreation. Do not reload `/etc/caddy/Caddyfile`; it still points to
Evolution. For rollback, patch the WhatsApp block in both current host and
runtime copies, validate and reload the runtime copy. Preserve unrelated routes.
