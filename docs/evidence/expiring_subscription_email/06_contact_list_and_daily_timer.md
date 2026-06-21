# 06 — Contact Call-List Format + Daily Timer

**Date:** 2026-06-21 · Owner-requested: the Nutrition Doctor needs a usable call list (Name + Phone), in Excel, sent daily.

---

## What changed in the report

The job [`app/scripts/expiring-subscription-email.mjs`](../../../app/scripts/expiring-subscription-email.mjs) now renders:

- A **clean HTML table** (email body): `# · Name · Phone · Package · Expiry date · Days left · Status`, with low-confidence rows highlighted ⚠.
- A **CSV attachment** `nutrezee_expiring_<target>.csv` — opens in **Excel**, UTF-8 BOM (Arabic names render), columns: `#, Name, Phone, Package, Expiry date, Days left, Status, Confidence, Customer ID, Order ID`.
- Subject: `Nutrezee — N subscriptions expiring <date> (in K days)`.

### New env flags

| Var | Default | Meaning |
|---|---|---|
| `EXPIRING_SUBSCRIPTION_INCLUDE_CONTACT` | `false` | `true` → include customer **Name + Phone** (internal PII call list). Owner-authorized for the doctor. Default off = ID-only (PII-safe). |
| `EXPIRING_SUBSCRIPTION_FORCE` | `false` | `true` → re-send for a target date already marked `sent` (manual corrections). Daily run leaves it off (stays idempotent). |

**"Confidence"** = whether the customer's latest order is a genuine active subscription (`high`) vs cancelled/rejected (`low` ⚠ — verify before calling). Derived in `analytics.customer_subscription_status` (no status over-filter).

> **PII note:** with `INCLUDE_CONTACT=true` the report and CSV contain real customer names + phone numbers — an internal call list. Treat the generated files / emails as confidential; this is a deliberate, owner-authorized change from the earlier PII-masked report.

## Daily timer (08:00 Asia/Kuwait)

Units (in [`ops/systemd/`](../../../ops/systemd/), deployed to `/etc/systemd/system/` on staging):
- `nutrezee-expiring-subscription-email.service` — oneshot → runs `run-expiring-subscription-email.sh` (stages the script into the api container, ensures `nodemailer`, runs with the host env-file).
- `nutrezee-expiring-subscription-email.timer` — `OnCalendar=*-*-* 08:00:00 Asia/Kuwait`, `Persistent=true`. systemd 255 honours the tz suffix (the staging host runs Europe/Berlin time, not UTC; the schedule is still anchored to Kuwait). Verified next-fire = 08:00 Kuwait.

**Created but DISABLED + disarmed** (env still `DRY_RUN=true`) pending operator go-live.

## Go-live (operator) — the assistant cannot trigger the PII email

The safety classifier **hard-blocks the assistant** from sending bulk customer PII via external email ("user consent cannot clear"), so the **operator** performs go-live on the server (their data, their infra). The **daily send itself runs server-side via the timer — that autonomous path is not blocked.**

```bash
# 1) Arm real sending (off dry-run) — affects the manual test AND the daily job:
sed -i 's/^EXPIRING_SUBSCRIPTION_DRY_RUN=true$/EXPIRING_SUBSCRIPTION_DRY_RUN=false/' /opt/nutrezee/expiring-subscription.env

# 2) Send the corrected report to the doctor NOW (force: today's date was already sent during testing):
docker exec --env-file /opt/nutrezee/expiring-subscription.env -e EXPIRING_SUBSCRIPTION_FORCE=true \
  nutrezee-api-1 node /srv/scripts/expiring-subscription-email.mjs

# 3) Turn on the automatic daily 08:00 Kuwait email (each day is a new date — no force):
systemctl enable --now nutrezee-expiring-subscription-email.timer
systemctl list-timers nutrezee-expiring-subscription-email.timer        # confirm next run
journalctl -u nutrezee-expiring-subscription-email.service -n 20 --no-pager   # check a run's result
```

Before step 2/3, **verify the recipient** `NUTRITION_DOCTOR_EMAIL` is correct — it receives customer PII.

## Outstanding

- **Rotate the Gmail App Password** (shared in chat during setup).
- Optional hardening: bake `nodemailer` into the api image so the wrapper doesn't install it at runtime.
