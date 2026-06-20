# 01 — Expiring-Subscription Email: Business Rule & Design

**Date:** 2026-06-20 · **Status:** built, validated (dry-run on staging), **disabled + dry-run by default**.
**Script:** [`app/scripts/expiring-subscription-email.mjs`](../../../app/scripts/expiring-subscription-email.mjs)

---

## Business goal

A **daily internal** email to the **Nutrition Doctor** listing customers whose subscription expires in exactly **N days** (default **3**) from the Asia/Kuwait business date. Internal staff report only.

## Hard safety contract (enforced in code)

- **Only recipient is `NUTRITION_DOCTOR_EMAIL`** — a single internal staff address. Customer contact details are **never** used as recipients and are **not** included in the report.
- **No customer emails. No WhatsApp. No marketing automation.**
- **Disabled + dry-run by default.** A real send requires ALL of: `EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true`, `EXPIRING_SUBSCRIPTION_DRY_RUN=false`, `NUTRITION_DOCTOR_EMAIL` set, and an SMTP transport configured. Otherwise the report is rendered to logs + a run row is written to `audit_event` — nothing leaves the system.
- **No full PII.** Report carries internal IDs + non-PII subscription fields only (see fields below). No phone, address, email, health notes, allergies, dish preferences, or payment details.
- **No send if recipient missing** → `send_blocked_reason='no_recipient'`.

## Data source & business rule

Source of truth: **`analytics.customer_subscription_status`** (migration 0021), which derives expiry from `MAX(fulfillment_day.date)`. Expiry = **scheduled service-schedule entitlement, NOT confirmed delivery** (delivery outcome is not captured).

**Target date selection (Asia/Kuwait):**
- `exact` mode (default): `subscription_expire_date = (kuwait_today + N)`
- `within` mode: `subscription_expire_date BETWEEN (kuwait_today + 1) AND (kuwait_today + N)`

`N = EXPIRING_SUBSCRIPTION_DAYS_AHEAD` (default 3).

## Date handling (documented)

The business date and target are computed **in SQL** as `(now() AT TIME ZONE $tz)::date` with `$tz = EXPIRING_SUBSCRIPTION_TZ` (default `Asia/Kuwait`, UTC+3, no DST). This matches the view's own anchor exactly and **does not rely on the server's UTC clock**. On 2026-06-20 the Kuwait business date was `2026-06-20`; target (+3) = `2026-06-23`.

## Email content

- **Subject:** `Nutrezee Subscriptions Expiring in {N} Days - {report_date}` (report_date = Kuwait today).
- **Body:** report date, target expiry date, total count, low-confidence count, a "by package" summary, a "by status" summary, then one row per customer with:
  `customer_id · current_order_id · current_package_name · subscription_expire_date · days_remaining · subscription_status · source_confidence`.
- **Excluded by design:** full phone, full address, full email, health notes, allergies/medical, dish preferences, payment details.

`source_confidence='low'` flags customers whose latest order is cancelled/rejected (the doctor can deprioritize these) — surfaced, not dropped.

## Architecture decision

A **standalone `.mjs` ops job** (like `app/db/migrate.mjs` and the meal-history sync scripts) — not an in-process API sweep. Rationale: a once-daily job fits the established ops-script pattern, stays decoupled from the API request path, and is scheduled by an operator-controlled (currently **un-installed**) systemd unit. It connects with the app `DATABASE_URL` (the official backend source), reads the view, and records each run.

## Run history / idempotency

Each run writes one **`audit_event`** row (reusing the existing audit pattern — no new table): `event_type='report.expiring_subscription_email'`, `actor_role='system'`, `entity_id='expiring-subscription-<target_expiry>'`, `after={mode,sent,send_blocked_reason,total,target_expiry,days_ahead,window_mode,tz,recipient_present}`. Before a **real send**, the job checks for an existing row with the same `entity_id` and `after->>'sent'='true'` and skips if found (`send_blocked_reason='already_sent'`) — idempotent per target date. Dry-runs are always recorded.

## Hermes vs this job (separation of concerns)

The Hermes DB agent (Part B) is a **read-only inspection** assistant (read-only DB user). **This backend job is the official source** for the daily email and uses the app `DATABASE_URL`. They are independent; Hermes does not send the email.
