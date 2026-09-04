# 04 — WP-OPS-06 (A47) staging deploy + first dry-run

Date: 2026-09-03 (owner authorized "merge the PR and start installing on the server") · Lineage: `fix/a45-console-performance` @ `3dfc511`

## Pre-deploy finding (Verified)

The running staging API image (built 2026-08-24) was `b48606f` from `build/wp-loc-a30-driver-session-verification`,
carrying five WP-LOC-A30 driver-session fixes to `m25-label/fleetbase-identity.service.ts` that the ops lineage had
never received. Deploying WP-OPS-06 alone would have regressed the collection scan. Fixed by PR #58 (plain merge of
`b48606f`, 2 files, + the feed runner host wrapper), CI 29/29, merged before deploy. PR #57 (WP-OPS-06) CI 29/29, merged.

## Deploy steps (Verified on VPS)

| Step | Result |
|---|---|
| Source | `releases/a47-src-f94ac7b.tgz` (sha256 `7e9b6995…`) → `/opt/nutrezee/a47-src-f94ac7b/`; tree identical to merged `fix/a45-console-performance` |
| Snapshot | `backups/pre-a47-20260903T094231Z.dump` (pg_dump -Fc, 87 TABLE DATA entries, integrity-listed) |
| Build | `docker compose --env-file /opt/nutrezee/.env -f compose.yml -f compose.staging.yml --profile tools build api migrate` → `nutrezee-api:a47-f94ac7b`; rollback image `nutrezee-api:a30-date-b48606f` (= previously running `e291e251320e`) |
| Migrate | `--profile tools run --rm migrate` applied **0024, 0025, 0026, 0030** (0024–0026 were pending on staging; all additive: CREATE TABLE/INDEX, permission/role inserts, one settings UPDATE). `import_batch_type_check` now includes `partner_daily`. Side effect: compose recreated `nutrezee-postgres-1` (config drift a30→a47); data volume `nutrezee_pgdata` intact, 20,204 `customer_order` rows, healthy |
| API | `up -d --no-deps api` → running `87517ef0e96c`; `/health` ok; env carries `NUTREEZE_PARTNER_LABEL_API_KEY` (fallback used by the feed client, no new variable); `POST /imports/partner-daily/fetch/dry-run` answers 401 unauthenticated (route live) |
| Admin nginx | Returned 502 after the API recreate (cached upstream IP) → `docker restart nutrezee-admin-1`; `/health` 200, `/app/login` 200, `/auth/me` 401; KDS healthy, public 200 |
| Feed runner | `/opt/nutrezee/sync/partner-daily-feed.mjs` (640) + `run-partner-daily-feed.sh` (750, execs inside `nutrezee-api-1`); units installed, `nutrezee-partner-daily-feed.timer` **disabled**, next elapse would be 01:20 CEST = 02:20 Kuwait |

## First dry-run (Verified, no business writes)

| Date | Partner rows | created | matched | errors | without Partner driver | on hold |
|---|---|---|---|---|---|---|
| 2026-09-04 (Fri) | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-09-05 (Sat) | 692 | 678 | 14 | 0 | 226 | 1 |

Temp admin removed after the run (0 rows). Log: `/opt/nutrezee/sync/logs/partner-daily-feed.log`.

## Not done (owner decision)

- `FEED_MODE=apply` for 2026-09-05 (678 new customers/orders into Nutrezee Postgres).
- Timer enablement. Fleet-Ops label preview + emulator scan verification (needs apply first).

Note: the legacy nightly sync's in-container scripts (`/srv/apply-*.mjs`, `incremental-sync.mjs`) were already absent
before this deploy (container recreated 2026-08-24); that pipeline is frozen and its timers are not installed.

## Apply 2026-09-05 (Verified, owner said "طبّق" 2026-09-03)

Batch `01M1KB5V5MA4G555T07PSEEJWY`: 678 created / 14 matched / 0 errors (same-snapshot dry-run `01M1KB5J6F…`).
Postgres after: `fulfillment_day` 2026-09-05 = 694 scheduled + 1 skipped (691 Partner scheduled + 1 on-hold + 3
pre-existing legacy-plan days Partner no longer lists; those are not label candidates because the batch set comes from
Fleetbase). Max `order_number` 24675 → **28906**; 678 orders + 676 customers created today; temp admin removed.
Sample for the owner's single-label check: Fleetbase `order_gb3TV5SHHe` (NUTREEZE-PARTNER-DAY-20260905-ORDER-18526, RAVI).
Timer still disabled.

## Timer enabled (Verified 2026-09-03, owner: "تفعيل timer الـ 02:20")

`systemctl enable --now nutrezee-partner-daily-feed.timer` → enabled/active; next elapse Fri 2026-09-04 01:20 CEST
= 23:20 UTC = **02:20 Kuwait**, targets today + tomorrow (Fri 0 rows, Sat 692). Wrapper smoke dry-run for 09-05 after the
apply: 0 created / 691 matched / 0 errors. Timer order each night (Kuwait): 03:00 snapshot, 04:00 rolling +1/+2 (CEST
clocks shown by systemd), 02:00 Fleetbase same-day, 02:20 Nutrezee feed, ~03:00 driver collection.
