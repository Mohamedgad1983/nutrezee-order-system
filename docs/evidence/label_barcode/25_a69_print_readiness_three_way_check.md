# 25 — A69: nightly print-readiness check — legacy screen + Partner API + Fleetbase, every order and driver

**Date:** 2026-09-27. **Owner:** "انا عايز استخدم fleetbase print من غير اي خطا علشان كده مديك طريقين تتاكد منهم
partner api and playwright script" — both run on the server, nightly, before the 01:00 label print.

## What runs (VPS, Kuwait time) — Verified installed
| Time | Unit | What |
|---|---|---|
| 00:25 | `nutreeze-partner-daily.timer` (A68) | Fleetbase refreshed with tomorrow from Partner |
| 00:45 | `nutreeze-legacy-screen-check.timer` | Playwright (official image `mcr.microsoft.com/playwright:v1.60.0-noble`) logs in to the legacy admin, opens *Orders Driver Wise* for tomorrow, reads the total, every Order ID, and every driver's count + Order IDs → `/root/a68/legacy-ui-<day>.json` |
| 00:55 | `nutreeze-print-readiness.timer` | Compares legacy screen ↔ Partner API ↔ Fleetbase ↔ label DB order by order and driver by driver; emails callcenter@ + it@ from hello@nutreeze.com (Fleetbase Laravel mailer, M365) |

Verdict **READY** only if: tonight's Fleetbase sync for the day completed, every active Partner order is in
Fleetbase with the same driver, nothing extra is in Fleetbase, every Fleetbase order maps to the label DB,
and the legacy screen matches the Partner API in total, order numbers and per-driver counts. Anything else →
subject `[ACTION]` with the exact order numbers. A missing/failed legacy run or Partner API error is never OK.

## Credentials — owner-held
- Legacy admin login: macOS Keychain item `nutreeze-legacy-admin` (owner-created), copied by the owner to
  `/root/a68/legacy-admin.cred` (root 0600, line 1 username, line 2 password) with a pipe from his Mac.
  The assistant never saw, typed or stored the value; the recording file was redacted locally before reading.
- Partner API: existing protected `/root/nutreeze-vendor.key` (read-only GET `daily-deliveries`).
- Mail: existing SMTP settings in `/opt/fleetbase/api/.env`; SMTP auth verified without sending.

## Legacy screen facts learned — Verified
- `/driverOrders` = server-side DataTables **1.10.7**, endpoint `/getDriverOrders/<driver>/<date>/<area>/<slot>`,
  10 rows per page, no page-size selector; `length=-1` returns HTTP 500, `length=<count>` works (`ajax_870`).
- Paging without a unique sort overlaps (739/870 unique); the script requests rows sorted by Order ID.
- Counts must be read after the table settles: a mid-load read gave 0 for a 146-order driver (fixed by
  waiting for the processing overlay to clear and the count to stay unchanged 1.5 s, then re-reading).

## Test results (no email sent)
- 2026-09-29 on the server: 870/870 order numbers, 9 drivers complete (sum 599 — 271 orders had no driver yet at 21:04 Kuwait).
- 2026-09-28 full three-way run: screen 875/875 with all 9 drivers complete. Real findings reported by the check:
  order **29384** has no driver in Partner (not in Fleetbase); orders **28089** and **29311** were re-assigned in
  Partner after the last sync (Fleetbase still had the old driver); order **26262** (Arsad Ali) is in the Partner
  API but not on the legacy screen (screen 875 vs API 876) — needs a business answer [NC].

## Rollback
`systemctl disable --now nutreeze-legacy-screen-check.timer nutreeze-print-readiness.timer`, remove the four
unit files, `systemctl daemon-reload`; delete `/root/a68/legacy-admin.cred`. Sources in `ops/fleetbase/print-readiness/`
and `tools/e2e-staging/legacy/legacy-driver-orders.mjs`.

## Not done / next [NC]
- Hard print gate inside Batch Labels (block the print button itself on any mismatch) — offered, not requested.
- Owner answer: when are next-day drivers assigned in the legacy admin (271 unassigned for 09-29 at 21:04)?
