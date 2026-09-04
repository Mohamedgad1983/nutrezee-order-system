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

## Staging deploy (Verified 2026-09-03)

PR #62 CI 29/29 → merged `a4acc65`. Source `releases/a50-src-061dfc6.tgz` (sha256 `a0689383…`), snapshot
`backups/pre-a50-20260903T120447Z.dump`.

| Step | Result |
|---|---|
| API | `nutrezee-api:a50-061dfc6`; migration **0032** applied (`import_batch.source_meta` present); `--no-deps` (Postgres untouched); admin nginx restarted; `/health` 200; `GET /fleet-ops/labels/freshness` answers 401 unauthenticated (route live) |
| Runner + timer | new `partner-daily-feed.mjs` / wrapper / units installed; `daemon-reload` + timer restarted: enabled, active, next elapse :20/:50 every hour (14:20 CEST first) |
| First run | 2026-09-03 (today): 795 rows → 146 created / 628 matched / 626 days created / 0 errors (**applied**); 2026-09-04: 0 rows → `partner_daily_unchanged` (apply skipped). `source_meta` recorded with `source_max_updated_at 2026-09-03T07:21:25+03:00` |
| Console | `fleetbase-console:a48.3-candidate` gate: production 10 / development 0, `/extensions.json` 10 incl. Nutrezee **v0.3.8**, theme `?v=a48.3` 200, gzip, immutable, no `Clear-Site-Data`, engine bundle carries the freshness call; swapped, other containers unchanged, restarts 0; live `/`, `/extensions.json`, `/nz/health` 200. Rollback `fleetbase-console:a48.2-rollback-20260903` |

Note: the first 30-minute run also mirrored **today's** Partner deliveries (795 rows), so labels can now print for
today's orders too; the same apply-on-change guard keeps the batch trail small.
