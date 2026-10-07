# 29 — A75: "Days Remaining" on the label was 1 for almost everyone

Date: 2026-10-07 (Kuwait) · Owner, after the first paper print from Batch Labels (one driver, trial): "صلّح Days Remaining".

## What was wrong (Verified)
The label prints `analytics.order_subscription_periods.days_remaining` = last scheduled `fulfillment_day` − today. The
30-minute Partner feed mirrors only today and tomorrow, so the last known day was always tomorrow: on 2026-10-07,
945 of 947 labels for 2026-10-08 would print "Days Remaining 1". Nothing compared this field before; the night check
compares order numbers and drivers.

## Source of the right value
Partner `daily-deliveries` lists scheduled deliveries about 29 days ahead (window 2026-08-05 … 2026-11-05 on the day;
per-date counts fall from 927 to 25). Neither that feed nor `/orders` carries an end date or a remaining-days field.

## Change (no API code, no schema)
- `ops/sync/run-partner-window-feed.sh`: the same governed M19 path (`partner-daily/fetch` dry-run → apply) for Kuwait
  today+2 … today+30, Fridays skipped. Own temporary admin (`FEED_TEMP_EMAIL`), own script copy in the container and
  own log, so it never collides with the 30-minute feed. A date past Partner's window is simply empty.
- `nutrezee-partner-window-feed.timer`: every 2 hours (the 20:35 UTC run is 23:35 Kuwait, before the night check).
- `pg_dump` before the first apply: `/opt/nutrezee/backups/pre-a75-window-feed-20261007-092204.sql.gz` (98 MB, gzip ok).

## Result on staging
| | |
|---|---|
| First load | 24 dates applied, 0 failed, 0 row errors; 77 future orders and about 5,000 future days created |
| Tomorrow's labels by days remaining, before | 945 × "1" |
| after | 0–1: 78 · 2–7: 513 · 8–14: 216 · 15–21: 58 · 22+: 48 |
| Probe, all of tomorrow's Partner labels vs Partner's own last delivery day (read again from the feed) | 910 equal, 0 different, 3 not in Partner's window |
| Labels built with the deployed `LabelService` (60 Partner sample) with days > 1 | 0 → 51 |
| Night check after the load | `[OK] Labels 2026-10-08: Batch Labels 910 = legacy screen 910 + WhatsApp 32` |

The label photographed in the trial (order 20975, "Days Remaining 0") was in fact right: Partner's last delivery for
that order is 2026-10-07.

## Limits [told to the owner]
- Definition is calendar days from today to the last scheduled delivery. Whether the legacy label counts the same way
  is **not verified** — it needs one legacy label of the same customer and day.
- 15 of tomorrow's orders have a delivery on the feed's last day; their true end may be later, so they print 29 at most.
- The feed never removes a day. If a subscription is shortened in legacy while still active, its label can overstate
  the remaining days until the removed days pass.
