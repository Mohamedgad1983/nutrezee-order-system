# 05 — Staging Real Email Test (Gmail SMTP)

**Date:** 2026-06-21 · **Result: PASS** — dry-run verified, then **one** real internal test email sent to the Nutrition Doctor. No production, no customer emails, no timer enabled.

---

## Scope of this test

Enable Gmail SMTP for the existing job [`app/scripts/expiring-subscription-email.mjs`](../../../app/scripts/expiring-subscription-email.mjs) on **staging only**, run a dry-run, then send exactly one real internal email for customers whose subscription expires in exactly **3 days**.

## Configuration (server-side only — no secrets in repo)

SMTP + job env stored in **`/opt/nutrezee/expiring-subscription.env`** on the staging host (mode **600**, owner **root**). **Never committed; values never printed.** Presence verified by variable name only (all 12 PRESENT).

Variable names use exactly what the **code reads** (note the mapping from the request spec):

| Requested name | Actual env var the script reads |
|---|---|
| `SMTP_PASSWORD` | **`SMTP_PASS`** |
| `EXPIRING_SUBSCRIPTION_EMAIL_DRY_RUN` | **`EXPIRING_SUBSCRIPTION_DRY_RUN`** |
| (rest unchanged) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_FROM`, `NUTRITION_DOCTOR_EMAIL`, `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED`, `EXPIRING_SUBSCRIPTION_DAYS_AHEAD`, `EXPIRING_SUBSCRIPTION_WINDOW_MODE`, `EXPIRING_SUBSCRIPTION_TZ` |

Settings: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS), `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true`, `EXPIRING_SUBSCRIPTION_DAYS_AHEAD=3`, `EXPIRING_SUBSCRIPTION_WINDOW_MODE=exact`, `EXPIRING_SUBSCRIPTION_TZ=Asia/Kuwait`, `EXPIRING_SUBSCRIPTION_DRY_RUN=true` (default; a real send overrides per-invocation only).

**Run context:** executed inside the `nutrezee-api-1` container (has node v22 + `pg` + `DATABASE_URL`), env injected via `docker exec --env-file /opt/nutrezee/expiring-subscription.env`. The optional `nodemailer` transport was installed **runtime-only** (`npm i nodemailer --no-save`) for the send — it is **not** yet baked into the image (see "Production follow-ups").

## Dry-run (DRY_RUN=true) — PASS

```
INFO starting {"enabled":true,"dryRun":true,"daysAhead":3,"windowMode":"exact","tz":"Asia/Kuwait","recipientSet":true}
INFO report built {"subject":"Nutrezee Subscriptions Expiring in 3 Days - 2026-06-21","total":36}
INFO NOT sent (dry_run). Rendered report below: …
  Report date (Asia/Kuwait): 2026-06-21
  Target expiry date:        2026-06-24  (exactly 3 days ahead)
  Total customers:           36   (10 low-confidence)
  By package / By status summaries + per-customer rows (internal IDs only)
```

- **Target date = Kuwait today (2026-06-21) + 3 = 2026-06-24** ✓
- **Count = 36** customers ✓
- **Subject + body generated** ✓
- **No real email sent** (`dry_run`) ✓
- **No forbidden PII** — body contains `customer_id`, `current_order_id`, package name, expire date, days_left, status, confidence only. **No names/phones/emails/addresses/health/dish/payment.** ✓

## Real test (DRY_RUN=false, one-off override) — PASS

```
INFO starting {"enabled":true,"dryRun":false,…}
INFO report built {"subject":"… 2026-06-21","total":36}
INFO email sent to internal recipient for target 2026-06-24
INFO run recorded in audit_event {"entityId":"expiring-subscription-2026-06-24","sent":true,"total":36}
```

- **Email sent successfully** via Gmail SMTP ✓
- **Recipient = `NUTRITION_DOCTOR_EMAIL`** (the single internal staff address; not customers) ✓
- **`audit_event` recorded**: `event_type=report.expiring_subscription_email`, `actor_role=system`, `mode=sent`, `sent=true`, `total=36`, `recipient_present=true`, `entity_id=expiring-subscription-2026-06-24`, `occurred_at=2026-06-21 08:03:19Z` ✓
- Idempotency: a second real run for the same target date would be skipped (`already_sent`).

## Post-test state

- **`EXPIRING_SUBSCRIPTION_DRY_RUN=true`** restored in the env file (real send was a per-invocation override; the file is back to the safe default) ✓
- **No daily timer enabled** (`systemctl list-timers` → none for this job) ✓
- Temp script removed from the container.

## Security notes

- SMTP secret lives only in `/opt/nutrezee/expiring-subscription.env` (600, root) — not in the repo, not in CI, not in any image.
- **Action for owner:** the Gmail App Password was shared in chat during setup; **rotate it** and update the host env file, since chat is not a secure secret store.
- Verify the recipient domain spelling is intended (`…@nutreeze.com`) — Gmail accepted the message for delivery; final inbox delivery depends on that address being valid.

## Production follow-ups (NOT done here — out of scope)

1. Bake `nodemailer` into the API image (or a dedicated job image) + record the dependency, so a scheduled run doesn't rely on a runtime install.
2. When ready to schedule daily: create + enable the systemd timer (the `ops/systemd/` unit is present but **disabled**); keep `DRY_RUN=true` until a final go-live decision.
