# 06 — WP-OPS-07 part 2 (A50): evening hourly Fleetbase refresh + daytime cancel-only

Date: 2026-09-03 · Owner: "ابدأ الجزء التاني، بعد 03:00 الإلغاءات فقط" + "عامل الـ on hold زي الإلغاء لأن ممكن
العميل يغيّر رأيه وياكل من مطعم اليوم ده". Branch `build/wp-ops-07-fleetbase-cadence` → `fix/a45-console-performance`.

## Why (Verified on staging before the change)

Fleetbase took Partner's state only at 00:00 / 01:00 / 02:00 Kuwait. A driver assigned in Partner after
02:00 or a cancellation during the day never reached Navigator; the full sync cannot run mid-day because
`guardDailyOperationalRows` rightly refuses to touch started/changed dispatched jobs. Live state 2026-09-03
(today): 589 dispatched, 0 started, 191 held no-pin, 10 tombstoned; Saturday: 363 dispatched / 226 no driver.

## Change

- `nutreeze-orders.php`: `dailyWithdrawalReason()` (pure: `cancel` → `source_order_canceled`, `is_on_hold` →
  `unapproved_meal_status`, anything else → null); `DailyDispatchWriter::withdrawOnly()` — one transaction,
  locks the day's integration orders, withdraws only withdrawn rows (driver null, `scheduled_at` null,
  undispatched, status `canceled` / `created`, `held_<reason>` meta, `daytime_withdrawn_at`, payload meta,
  address-call artifacts cleared, `CANCELED` / `ON_HOLD` tracking via `ensureHeldTracking`), skips started jobs
  (reported), ignores missing rows and other status changes, verifies every withdrawn order in-transaction,
  refuses any activity-log write, invalidates Fleet-Ops caches. CLI `--cancel-only=<date>` (manifest gate
  kept, exclusive with the full-sync confirmations, no address-call). Self-test 38 → **43/43** (container).
- `nutreeze-daily-sync.sh`: modes `evening` (20:00–02:45 wrap-around window, single target = next
  collection day) and `daytime` (03:00–19:59, today, `--cancel-only`, zero-day skipped). `run.sh`
  whitelists `--cancel-only=*`. `test-daily-sync.sh` 14 → **33/33** (VPS, Linux `date`).
- Units: `nutreeze-partner-evening.{service,timer}` (`17..23:05 UTC`), `nutreeze-partner-daytime.{service,timer}`
  (`00..16:15,45 UTC`), both with the existing healthcheck `ExecStartPre`.

## Not changed

Nightly 00:00 snapshot / 01:00 rolling / 02:00 same-day timers; A46 Partner driver authority; pin/hold rules.
Tomorrow's orders (evening mode) still go through the full guarded sync — nobody has started them.
