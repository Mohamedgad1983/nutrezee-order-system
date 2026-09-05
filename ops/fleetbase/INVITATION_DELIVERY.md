# Fleet-Ops invitation delivery (WP-OPS-A58)

The API publishes notifications to the Redis namespace derived from its runtime
configuration. The upstream queue and scheduler may have a different `APP_NAME`
and no mounted API `.env`. A successful Invite User response only proves enqueueing.

Use `render-application-queue.py` with the host's existing compose files.
The opt-in worker copies the effective `application` image, protected environment
mounts, network and Redis/mail configuration. The generated overlay is mode 0600
and must remain server-held because effective environment values may be sensitive.
It publishes no host ports. Preserve
the original queue and scheduler, which still share their original namespace.

Before activation, compare the effective application/worker image, environment and
mounts without printing secrets. Verify SMTP authentication and ensure pending jobs
are within the authorized operation. Keep credentials only in the host's protected
`/opt/fleetbase/api/.env` (0600), never in this repository or command output.

```sh
python3 render-application-queue.py \
  --file docker-compose.yml --file docker-compose.override.yml \
  --output docker-compose.application-queue.json
docker compose -f docker-compose.yml -f docker-compose.override.yml \
  -f docker-compose.application-queue.json --profile application-queue \
  up -d --no-deps application-queue
```

Restart only `application-queue` after changing SMTP credentials so its long-lived
Laravel process reloads them. Do not replace the host override with the historical
repository template. Do not restart dispatch or modify the legacy queue prefix.
After changing the application compose configuration, render the overlay again and
recreate only the application worker to maintain parity.

To recover a failed invitation, verify the failed job's notification class and
target user before retrying its exact UUID through the application runtime. Never
retry all failed jobs. Reuse the existing invitation to preserve role and expiry;
if expired, use the supported IAM invitation flow. Do not print serialized payloads,
invitation codes, links or credentials. Confirm worker completion and SMTP acceptance;
mailbox delivery requires separate evidence.

Rollback: stop and remove only `application-queue` with the same compose arguments.
The queued jobs remain in Redis; application, scheduler and original queue continue.
