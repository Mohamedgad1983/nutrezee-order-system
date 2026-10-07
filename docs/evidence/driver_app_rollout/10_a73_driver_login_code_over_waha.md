# A73 — driver login code over WhatsApp through WAHA

Date: 2026-10-07 (Kuwait) · Owner: "OTP WhatsApp ممكن نشغله دلوقتي خصوصا بعد ما بنيت سيرفر WAHA" → "اه شغله وابعت
الكود على رقمي" → (after the plus-sign finding) "اه ياريت تعملها وتشغله".

## Before (Verified)
- Fleetbase settings: `system.sms.default_provider = twilio` (not configured), `custom_http` still pointing at the
  Evolution instance whose WhatsApp account was restricted in July. A driver asking for a login code received nothing
  on WhatsApp; the last code requested at all was on 2026-09-23.
- WAHA session `nutreeze` is `WORKING` on a different number (ends 7146). All 9 active drivers have a phone.

## Finding
Fleetbase's custom HTTP SMS provider can template the recipient only as stored (`+965…`). WAHA `POST /api/sendText`
never answers when the chat id carries the plus sign (`+965…@c.us` and bare `+965…` both hang until the 30 s client
timeout, nothing is sent); with digits only it answers 201 in 0.4 s and the message reaches the phone.

## Change
- `ops/waha/otp-relay/` — a 100-line standard-library relay in its own hardened container (`waha-otp-relay`, pinned
  Python digest, uid 10001, read-only root, no capabilities, **no host ports**, internal Docker network only).
  `POST /send {to, text}` with a shared secret header → digits of the number → WAHA `sendText` on the fixed session.
  Stores nothing; logs only `sent` / `failed` / `refused`, never a number or a text. Hard ceiling of 40 messages per
  hour so a login loop cannot flood the WhatsApp number. Unit tests `test_relay.py` (4), added to the CI `waha-bulk` job.
- `otp-switch.py apply|rollback|show` — changes only the two Fleetbase settings rows
  (`system.services.sms.providers.custom_http`, `system.sms.default_provider`), then `octane:reload`. Originals are
  kept root-only in `/root/a73/sms-settings-original.json`; `rollback` restores them. No secret is printed.
- No Fleetbase or WAHA code, image or restart is involved.

## Verification on staging (owner's own number, with permission)
| Step | Result |
|---|---|
| Direct WAHA send, digits only | 201 in 0.39 s; WhatsApp ack `DEVICE`, later `READ`; owner confirmed receipt |
| Same with the plus sign (two forms) | no answer in 30–40 s, nothing sent |
| Relay from the Fleetbase container: `/health`, no token, bad number | 200 / 401 / 400 |
| Fleetbase `SmsService->send()` after the switch | `success: true`, message id returned, relay log `sent`, WhatsApp ack `DEVICE` |

## Not verified [NC]
The login button of the driver app itself with a real driver: it uses the same `SmsService`, and the settings rows are
the reload-safe source, but the first real driver login is the final proof. If a code does not arrive:
`docker logs waha-otp-relay` (sent / failed / refused) and the Fleetbase log line "Sending SMS via custom HTTP gateway".

## Risk the owner accepted
The same WhatsApp number sends the renewal reminders (20 a day); it was restricted for 24 h on 2026-10-03 after 50
messages in one day. Login codes are few (9 drivers, tokens do not expire), and the relay's hourly ceiling bounds them.
