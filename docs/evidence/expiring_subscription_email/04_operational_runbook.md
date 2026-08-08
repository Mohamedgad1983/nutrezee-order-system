# 04 — Operational Runbook

**Date:** 2026-06-20 · Job: [`app/scripts/expiring-subscription-email.mjs`](../../../app/scripts/expiring-subscription-email.mjs) · npm: `npm run expiring-subscription-email`

---

## Run a dry-run (safe; default)

From a node runtime with `pg` + `DATABASE_URL` (the api container is the reference):

```bash
# inside the api container (node + pg + DATABASE_URL present):
docker cp app/scripts/expiring-subscription-email.mjs nutrezee-api-1:/srv/scripts/expiring-subscription-email.mjs
docker exec -e NUTRITION_DOCTOR_EMAIL=doctor@nutrezee.internal nutrezee-api-1 \
  node /srv/scripts/expiring-subscription-email.mjs
# → renders the report, sends nothing (disabled+dry-run), writes one audit_event run row.
```

Or via the wrapper template: [`ops/systemd/run-expiring-subscription-email.sh`](../../../ops/systemd/run-expiring-subscription-email.sh) (reads `/opt/nutrezee/expiring-subscription.env`).

## Enable a real daily send (operator decision — gated)

1. Install the optional transport (records the dependency): `npm i nodemailer`.
2. Create the host env-file `/opt/nutrezee/expiring-subscription.env` (mode 600) with `NUTRITION_DOCTOR_EMAIL`, `SMTP_*`, `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true`, `EXPIRING_SUBSCRIPTION_DRY_RUN=false` (see [02](02_env_and_config.md)).
3. Do a final dry-run with the env-file (`EXPIRING_SUBSCRIPTION_DRY_RUN=true`) and confirm the report.
4. Flip `EXPIRING_SUBSCRIPTION_DRY_RUN=false` and run once manually; confirm the doctor receives it and the `audit_event` row shows `sent=true`.

## Schedule it (NOT done here — timers deliberately not enabled)

The unit [`ops/systemd/nutrezee-expiring-subscription-email.service`](../../../ops/systemd/nutrezee-expiring-subscription-email.service) is a **oneshot with no `[Install]` and no `.timer`** — it does not auto-start. To schedule (operator approval required), create a timer, e.g.:

```ini
# /etc/systemd/system/nutrezee-expiring-subscription-email.timer  (operator-created)
[Unit]
Description=Daily 07:00 Asia/Kuwait expiring-subscription email
[Timer]
OnCalendar=*-*-* 07:00:00 Asia/Kuwait
Persistent=true
[Install]
WantedBy=timers.target
```
then `systemctl enable --now nutrezee-expiring-subscription-email.timer`. **Do not enable without sign-off.**

## Idempotency & re-runs

Safe to run multiple times per day: a real send is skipped if an `audit_event` row for the same `entity_id` (`expiring-subscription-<target_expiry>`) already has `sent=true` (`send_blocked_reason='already_sent'`). Dry-runs always record a row.

## Observability

- Logs are labeled `[expiring-subscription-email]` with structured `INFO/WARN/ERROR` lines.
- Run history: `SELECT entity_id, after->>'mode', after->>'sent', after->>'total', occurred_at FROM audit_event WHERE event_type='report.expiring_subscription_email' ORDER BY occurred_at DESC;`

## Failure modes

| Symptom | `send_blocked_reason` | Action |
|---|---|---|
| Disabled | `disabled` | Set `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true` |
| Still dry-run | `dry_run` | Set `EXPIRING_SUBSCRIPTION_DRY_RUN=false` |
| No recipient | `no_recipient` | Set `NUTRITION_DOCTOR_EMAIL` |
| Already sent today | `already_sent` | Expected; no action |
| SMTP/nodemailer error | `send_error` | Check `nodemailer` install + `SMTP_*`; report is still logged |
| `DATABASE_URL` unset | exit 1 | Provide the connection string |
