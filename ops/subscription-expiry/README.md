# Nutreeze daily subscription-expiry report (installed 2026-10-03)

READ-ONLY. Every day at 07:30 Asia/Kuwait, logs in to https://nutreeze.com/admin with Playwright,
reads every page of **Customer Active Orders** (`/orders/list/Active`), keeps orders whose End Date is
today+1 .. today+3 (Kuwait date), opens each matching order's "View Order" page for customer id + area,
and writes the report. Never submits a form on an order; never visits action links.

- Script: `app/subscription-expiry.mjs` · wrapper: `run.sh` (flock, 3 attempts, Docker image
  `mcr.microsoft.com/playwright:v1.60.0-noble`, node_modules reused from `/root/a68/legacy-app`)
- Schedule: `nutreeze-subscription-expiry.timer` → `.service` (Persistent=true, survives reboot)
- Credentials: `/root/a68/legacy-admin.cred` (owner-written, root 0600), mounted read-only, never logged
- Classification (one row per customer; customer = account phone on the list):
  the customer's active order with the latest End Date decides.
  Latest ends inside the window -> `ACTION_REQUIRED`; latest ends after the window -> `ALREADY_RENEWED`.
  A customer with several orders ending in the window appears once (latest one); the others are in `other_expiring_orders`.
- Output (root-only, contains names + phones): `/var/log/nutrezee/subscription-expiry/`
  `latest_action_required.{csv,json}` — the daily operational list
  `latest_already_renewed.{csv,json}` — expiring order but a later active order exists (renewal order no/start/end)
  `latest.{csv,json}` — audit: every expiring order with `classification` and `customer_row`
  plus `YYYY-MM-DD*` copies of all three, and `run.log`
- Exit codes: 0 ok · 10 login failed · 11 page/table missing · 12 incomplete reading · 13 empty list · 75 already running
  A failed run never overwrites reports and never writes an empty one.
- `detail_check` = the order page showed the same order number and customer name.
- Logic self-test (no browser, no login): `./run.sh --self-test` (result in run.log)
- Manual run: `systemctl start nutreeze-subscription-expiry.service` · options: `EXPIRY_DAYS_AHEAD`, `EXPIRY_TODAY`
- Customers whose name matches test/"do not deliver" are excluded and counted in the log.

## WhatsApp renewal reminders — gentle mode (2026-10-03, currently OFF)

`nutreeze-renewal-whatsapp.timer` (14:00 Asia/Kuwait) → refreshes the report (`run.sh`) → `whatsapp-reminder.py`.
After the 24 h WhatsApp block of 2026-10-03 the owner kept this channel with gentler rules (`whatsapp.env`):
`DAILY_CAP=20`, random gap `GAP_MIN..GAP_MAX` (4–8 min), nothing after `SEND_UNTIL`, customers with 3 days left only.
`whatsapp-message.txt` is personal ({name} = customer first name, {days}), has the US15 promo code but no link, and an opt-out line;
a reply "إيقاف"/"stop" (or `--optout <phone>`) stops reminders for that number. The first failed send or a
disconnected session halts sending for the day (`.whatsapp-halt-YYYY-MM-DD`). Sent directly through the WAHA session
(not the Bulk page: it can only send identical text every 60 s). Summary email + .xlsx to it@ (cc call centre) after each run.
Switch: `WHATSAPP_LIVE=yes|no`. Ledger `whatsapp-ledger.sqlite3`, log `whatsapp.log` in `/var/log/nutrezee/subscription-expiry/`.

## Daily call list for customer service (2026-10-03)

After the 07:30 reading, `whatsapp-reminder.py --report-email` (ExecStartPost of `nutreeze-subscription-expiry.service`)
emails today's ACTION_REQUIRED customers as an .xlsx to callcenter@nutreeze.com (cc it@nutreeze.com).
WhatsApp sending is OFF (`WHATSAPP_LIVE=no`) since the number got a 24 h WhatsApp block on 2026-10-03;
the owner chose to move to the official WhatsApp Business API before sending again.

## Deploy (repo → VPS)

Copy `ops/subscription-expiry/` to `/opt/nutrezee/subscription-expiry/` (root, 0700; create an empty
`app/node_modules/` as the mount point) and `ops/systemd/nutreeze-subscription-expiry.{service,timer}` to
`/etc/systemd/system/`, then `systemctl daemon-reload && systemctl enable --now nutreeze-subscription-expiry.timer`.
The credential file, reports and logs live only on the VPS and are never committed.
