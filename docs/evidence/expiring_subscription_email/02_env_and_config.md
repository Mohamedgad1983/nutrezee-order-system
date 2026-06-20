# 02 — Environment & Configuration

**Date:** 2026-06-20. All config is via environment variables (the repo convention — direct `process.env`, documented in `app/.env.example`). **No secrets in the repo.**

---

## Variables

| Variable | Default | Required for send | Purpose |
|---|---|---|---|
| `DATABASE_URL` | — | yes (read + audit write) | App DB connection (official backend source) |
| `NUTRITION_DOCTOR_EMAIL` | _(unset)_ | **yes** | The ONLY recipient (internal staff). No send if unset. |
| `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED` | `false` | **yes (`true`)** | Master on/off switch |
| `EXPIRING_SUBSCRIPTION_DRY_RUN` | `true` | **yes (`false`)** | Render+log only vs actually send |
| `EXPIRING_SUBSCRIPTION_DAYS_AHEAD` | `3` | no | Days before expiry to report (0..90) |
| `EXPIRING_SUBSCRIPTION_WINDOW_MODE` | `exact` | no | `exact` (= today+N) or `within` (today+1..today+N) |
| `EXPIRING_SUBSCRIPTION_TZ` | `Asia/Kuwait` | no | Business-date timezone |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | — / `587` / — / — / `NUTRITION_DOCTOR_EMAIL` / `false` | for real send | SMTP transport |

The placeholders are documented in [`app/.env.example`](../../../app/.env.example) (commented; copy to a real env-file to use).

## Recipient: do NOT hardcode

The recipient is read **only** from `NUTRITION_DOCTOR_EMAIL`. It is not present in code or committed config. If unset, the job runs (report-only) and records `send_blocked_reason='no_recipient'`. To set it for a scheduled run, place it in the operator env-file (default `/opt/nutrezee/expiring-subscription.env`, mode 600), e.g.:

```
NUTRITION_DOCTOR_EMAIL=doctor@nutrezee.internal
EXPIRING_SUBSCRIPTION_DAYS_AHEAD=3
EXPIRING_SUBSCRIPTION_TZ=Asia/Kuwait
# To actually send (default is dry-run):
#EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true
#EXPIRING_SUBSCRIPTION_DRY_RUN=false
#SMTP_HOST=...
#SMTP_PORT=587
#SMTP_USER=...
#SMTP_PASS=...     # secret — host env-file only, never the repo
#SMTP_FROM=no-reply@nutrezee.internal
```

## SMTP transport (optional dependency)

The job has **no hard mailer dependency**. A real send dynamically imports `nodemailer`; if it is not installed, the send fails gracefully and the job stays report-only (`send_blocked_reason='send_error'`). To enable real sends the operator must install it with a recorded reason:

```
npm i nodemailer        # records the dependency (per repo rule: no new deps without a reason)
```

This keeps the default footprint dependency-free and the job safe (dry-run) until a deliberate enablement step.

## Enablement checklist (all required for a real send)

1. `npm i nodemailer` (recorded dependency).
2. Env-file sets `NUTRITION_DOCTOR_EMAIL`, `SMTP_*`, `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true`, `EXPIRING_SUBSCRIPTION_DRY_RUN=false`.
3. A scheduler (operator-created systemd timer / cron) — **not enabled by this work**.
4. Verify a dry-run first (`EXPIRING_SUBSCRIPTION_DRY_RUN=true`) — see [03](03_validation_report.md).
