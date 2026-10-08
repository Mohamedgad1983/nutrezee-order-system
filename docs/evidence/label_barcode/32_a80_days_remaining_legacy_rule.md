# 32 — WP-OPS-A80: Days Remaining by the legacy rule (extended Partner API)

**Date:** 2026-10-08 · **API:** `nutrezee-api:a80-8215577` (rollback `pre-a80-20261008`)

## Trigger

The Partner developer announced the extended API (subscriptions, subscription-schedule, subscription-changes, preferences, financials, `?since=`). The owner asked to use it to finish what was still open on the labels.

## Finding (Verified)

Days Remaining was the count of mirrored future delivery days (A75). Partner lists only the days **already generated** — `daily-deliveries` and the new `subscription-schedule` alike (order 30694: 6 future rows of 26) — so the count was too low for most subscriptions and never the legacy figure.

The legacy rule, tested against the "N days remains" column read off the legacy Driver Orders screen in the owner's video (Thursday 2026-10-08, 20 orders):

> delivery days (weekdays not in the subscription's `off_weekdays`) from the date to `end_date`, **minus `frozen_days`**

| | orders |
|---|---|
| equal to the legacy screen | 19 of 20 (incl. 27067: 29 frozen days → **-19** on the screen and by the rule) |
| different | 1 — order 26708, a "Thursday double box" subscription ending that week (screen -21, rule -19) |

The label for 2026-10-07 of order 29203 (owner's photo) printed 4 = rule from the delivery date (from the print date it would be 5), so the label counts from the delivery date.

## Change

`partner-label-profile.ts` — `legacyDaysRemaining()` from the subscription already in the cached list (no extra request); label order: WhatsApp order's own value → Partner rule → mirrored count (fallback).

## Verification

- Unit 7/7 (rule cases are the screen's values), integration 27/27, typecheck, lint.
- Saturday 2026-10-10, 587 Partner labels, same service before/after:

| order | before | after | legacy screen on the 8th (one delivery day earlier) |
|---|---|---|---|
| 29949 | 4 | 16 | 17 |
| 29880 | 5 | 16 | 17 |
| 29850 | 12 | 10 | 11 |
| 29432 | 12 | 8 | 9 |
| 27097 | 7 | 20 | 21 |
| 27067 | 7 | -20 | -19 |

  28 of the 587 labels now carry a negative figure, as legacy does for heavily frozen subscriptions.

## Other facts from the extended API

- `preferences.special_requests` equals `daily-deliveries.driver_instructions` on 200/200 Saturday orders that have either — the label Notes field is the customer's "special requests".
- `subscription-schedule`: 103,104 rows (104 pages, 16 s), `box_count` 2 on 260 rows; date filters are ignored, `subscription_id` / `customer_ref` / `since` work. Not used by the label.
- Financial endpoints not used here.

## Open (Needs Confirmation)

- Negative Days Remaining on the sticker: mirrors legacy; the owner may prefer 0 or blank.
- Not yet compared on paper.
