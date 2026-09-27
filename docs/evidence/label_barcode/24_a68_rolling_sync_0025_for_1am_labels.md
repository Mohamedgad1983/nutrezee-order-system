# 24 — A68: rolling Partner→Fleetbase sync moved to 00:25 Kuwait so D+1 labels are complete at 01:00

**Date:** 2026-09-27. **Owner:** "مدير السواقين بيطبع ملصقات يوم ٢٩ يوم ٢٨ الساعه ١ صباحا لان بيبعتهم للمطبخ"
→ approved "طبّق تقديم المزامنة لـ 12:25 من الليلة".

## Problem — Verified
The owner opened Batch Labels for **2026-09-29** on 09-27 and saw "Batch printing is blocked: 1 of 608"
while the legacy Partner admin (`/driverOrders`) listed **870** orders for that day.

| Day | Partner source | Fleetbase | Last Fleetbase refresh |
|---|---|---|---|
| 09-27 | 834 | 833 (+1 held) | closed |
| 09-28 | 876 | 875 (+1 held) | 09-27 20:05 Kuwait (evening) |
| 09-29 | 870 (legacy screen) | **608** | 09-27 ~01:27 Kuwait (rolling run, as +2 day) |

- The single unmapped order is Partner **28789** (`order_n2jQf6CzGZ`): present in Fleetbase, no
  `customer_order` yet. The Nutrezee label feed (`nutrezee-partner-daily-feed`, :20/:50 UTC) covers
  only today and tomorrow; a manual dry-run for 09-29 returned `partner_daily_unavailable` (the
  Partner API does not serve +2 days). It enters the feed after Kuwait midnight.
- Fleetbase refreshes D+1 in the night only via the **rolling** run at 01:00 Kuwait, which finished
  D+1 at **01:16–01:25** on each of the last four nights (journal). The evening runs after midnight
  target *today*, and the 02:00 same-day run is later still.
- **Risk:** at 01:00, once 28789 is fed at 00:20, the page could show 608/608 "ready" and print a
  stale partial set (~262 missing) with no warning — `ready` compares Fleetbase against the label
  DB, not against the Partner source count.
- Batch Labels has not been used for real prints yet: `label_print_event` holds only 9 test rows
  from 2026-09-05. The driver manager still prints from the legacy admin.

## Change (VPS + repo mirror)
- `nutreeze-partner-daily.timer`: **added** `OnCalendar=*-*-* 21:25:00 UTC` (00:25 Kuwait, +≤120 s
  random delay). The original `22:00 UTC` (01:00 Kuwait) run is **kept** as a fallback, so a failed
  or colliding early run can never leave the night worse than before.
- `daily-sync.sh` rolling guard window `00:45-01:45` → **`00:20-01:45`** Kuwait. No other logic changed.
- 00:25 is after the 00:05 evening run (targets *today*, ~14 min) to avoid `integration_lock_busy`.
- Expected nightly timeline (Kuwait): 00:20 feed adds D+1 to the label DB → 00:25–00:45 Fleetbase
  D+1 refreshed → 00:45–00:55 D+2 → 00:50 feed re-check → **01:00 print sees the complete set**.

## Verification
- `ops/fleetbase/test-daily-sync.sh` on the VPS: **33/33 passed**, including new A68 cases
  (00:25 runs, 00:15 still rejected).
- Installed diff vs the previous live script = exactly the comment + window line; live SHA-256
  `68c39dfc32e073cbc016f0ccbc317f14fc067a93004ba190422cd751d8d98f29` (repo copy identical).
- `systemctl`: timer carries both calendars; next elapse **2026-09-28 00:26:42 Kuwait**.
- [NC] First real night to be confirmed after 00:50 Kuwait 09-28: 09-29 Fleetbase count ≈ Partner
  count, 28789 mapped, Batch Labels `ready`.

## Rollback
Backups in `/root/a68/` (`daily-sync.sh.bak-20260927T181409Z`, `nutreeze-partner-daily.timer.bak-…`):
copy both back, `systemctl daemon-reload && systemctl restart nutreeze-partner-daily.timer`.

## Follow-up (not done) [NC]
- Label-side safety gate: block batch print when Fleetbase count < the Partner feed's declared
  count for that date (from `import_batch.source_meta`), so a stale set can never print. Code change → WP.
- Proposal left by another session in `/opt/fleetbase/integrations/nutreeze-orders/proposed/evening-no-overlap/`
  (stop the 01:05/02:05 evening runs that collide with 01:00/02:00) is independent and not installed here.
