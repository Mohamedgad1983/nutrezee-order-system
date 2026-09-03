# 05 — WP-OPS-07 part 1: near-live Partner → Nutrezee mirror + freshness indicator

Date: 2026-09-03 · Owner: "وانت ليه مش live sync مع partner API وتعرف آخر update" → "ابدأ بالأول".
Branch `build/wp-ops-07-partner-feed-freshness` → `fix/a45-console-performance`.

## Scope (part 1 only — Nutrezee mirror; Fleetbase dispatch cadence is part 2, owner decision pending)

| Piece | Change |
|---|---|
| Timer | `nutrezee-partner-daily-feed.timer` → every 30 min at :20/:50 UTC (keeps the 02:20 Kuwait slot after the 02:00 Fleetbase same-day sync); still today + tomorrow |
| Runner | `partner-daily-feed.mjs` applies only when the dry-run shows a change (`created`, `day_created`, `day_updated`); otherwise logs `partner_daily_unchanged` (`FEED_FORCE_APPLY=yes` overrides) |
| M19 | migration `0032` adds `import_batch.source_meta jsonb` (+ partial index); `partner_daily` batches record `delivery_date`, `delivery_rows`, `distinct_orders`, newest Partner `updated_at`, `fetched_at`; `BatchRunner.sourceFreshness()` + `MigrationService.partnerDailyFreshness(date)` derive `last_checked_at` / `last_applied_at` / `last_change_at` from the batch trail (no new state table, no settings misuse) |
| API | `GET /fleet-ops/labels/freshness?delivery_date=` (verified Fleetbase operator; pure read through M19's service API) |
| Fleet-Ops ext v0.3.8 | both panels show "Partner data: checked HH:MM · last change HH:MM (Kuwait)"; a freshness failure never blocks the label. Console release `0.7.48-a48.3` |

Partner API is pull-only with cursor pagination (no webhook known — [NC]); "live" therefore means a 30-minute poll.
A full day-pair poll is one page (~700 rows) per date and completes in seconds; the same-snapshot apply gate is unchanged.

## Tests

TS-I partner-daily: freshness before/after dry-run/apply, unchanged re-run moves "checked" but not "last change"
(4 batches). TS-U extension/console strings. Full Vitest green; typecheck/lint/build/scans green.
