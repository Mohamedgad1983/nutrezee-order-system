# 23 — A67: Fleetbase console/API slowness — root cause packet loss, fixed with TCP BBR

**Date:** 2026-09-27. **Owner order:** "صلح البطء الشديد fleetbase as professional", then "solve it A to Z".
**Numbering:** this is **A35 in the driver-app repo** (`nutreeze-driver-app` PLAN.md / CLAUDE.md,
merged via [nutreeze-driver-app#12](https://github.com/Mohamedgad1983/nutreeze-driver-app/pull/12),
merge `75faab4`). In this repo A35 is already the KDS amendment and A66 is the MDM runbook,
so the register id here is **A67**. Full raw measurements: driver-app repo `evidence/a35/`
(`baseline`, `phase1`, `phase2`, `network`, `bbr`). Probes/backups on the VPS: `/root/a35/`.
Continues the console-latency work of A59 (doc 21) and A60 (doc 22).

## Result — Verified
| What the owner feels | Before | After |
|---|---|---|
| Console first load (all 7 JS/CSS, cold, from the owner's Mac) | not finished after 50 s | **4.2 s** |
| Same 2 MB console asset, 3 fresh downloads | 32.2 / 48.9 / 14.2 s | **2.6 / 2.5 / 3.7 s** |
| Console Orders list, cold (cache miss) | 1.65 s | 1.23 s |
| Console Orders list, warm | 0.17 s, warm for 5 min | 0.14–0.21 s, warm for 30 min |
| `/v1/orders` limit=50 (API path) | 3.5 s | 3.2 s |

Control: the same Mac downloaded from Cloudflare at 7.7 MB/s before and 6.1 MB/s after, so the
gain is the server path, not the owner's connection.

## Root cause — Verified
1. **Network, not PHP.** From the owner's Mac the VPS delivered **55 KB/s** while Cloudflare
   delivered 6.3 MB/s. `ss -tin` inside the Caddy netns on live flows to the Mac: rtt ≈147 ms,
   **10–20 % of bytes retransmitted**, `cubic` cwnd collapsed to 2–12 segments. Every public
   byte (console, API, driver app, ERPNext) crosses this lossy long path.
2. **Cold console list = one DB query.** The console calls `/int/v1/orders` (never `/v1`), which
   Fleetbase already caches natively (`ApiModelCache`, Redis tags). The cold cost was the
   paginator `count(*)` over all ~32.5 k company orders with 5 nested EXISTS (1.36 s of 1.9 s),
   on an InnoDB buffer pool left at the 128 MB default against ~550 MB of hot tables
   (242 M lifetime misses, 15.8 k `wait_free` stalls). Every index was used (EXPLAIN ANALYZE).

## Changes on the VPS (config only; vendor tree checksum unchanged `4b3d2d83…05e3ec1`)
| # | Change | Where | Rollback |
|---|---|---|---|
| 1 | **TCP BBR + fq** (owner-approved) | `/etc/sysctl.d/99-a35-bbr.conf`, `/etc/modules-load.d/a35-tcp-bbr.conf`, `eth0` root qdisc `fq`, and the `nutrezee-caddy-1` netns set live via `nsenter` (new container netns inherit the host default) | Delete both files; `sysctl -w net.ipv4.tcp_congestion_control=cubic net.core.default_qdisc=fq_codel`; `tc qdisc replace dev eth0 root fq_codel`; nsenter the Caddy netns back to cubic |
| 2 | MySQL `innodb_buffer_pool_size` 128 MB → 1 GB, online | `SET PERSIST` (datadir `mysqld-auto.cnf`), no restart | `SET PERSIST innodb_buffer_pool_size = 134217728;` |
| 3 | `API_CACHE_QUERY_TTL` 300 → 1800 s | `application` env in `/opt/fleetbase/docker-compose.override.yml` | Remove the line; `docker compose up -d --no-deps application` |
| 4 | OPcache 256 MB + tracing JIT 128 M | `/opt/fleetbase/infra/a35/zz-a35-opcache.ini` mounted `:ro` into `application` | Remove the volume line; recreate `application` |

Change 3 is safe for freshness: Eloquent saves flush the cache tags, and both raw-SQL bulk
writers invalidate explicitly — `nutreeze-orders.php` and `nutreeze-complete-past-orders.php`
call `ApiModelCache::invalidateModelCache` + `ResponseCache::clear` (verified in source).
Change 4 gave no measurable single-request gain (median −3 %, noise); kept because it is stable
(0 crashes) and helps parallel throughput (−21…−34 % wall, Inferred from one sample).
While 4 is on, `validate_timestamps=0`: any PHP file change (e.g. A60 patch mounts) needs an
`application` restart — Octane already required that.

Health after every step: ops / erp / staging / fleet console 200, `/nz/health` 200, all
containers Up, 0 segfault/fatal lines. API interruptions: two `application` recreates of ~3 s each.

## Planned items that were not applied, and why — Verified
- **Caddy `encode`**: compression was already on upstream (nginx gzip + FrankenPHP zstd).
- **php-fpm workers**: the API runs on Octane/FrankenPHP with 16 workers (= 2 × vCPU) and scales.
- **Console page size 25**: the default is already 30; the cost is the count, not the page.
- **`/v1/orders` response cache for the driver app** (owner-approved, then paused): the httpd
  log 2026-09-21..27 shows **zero** driver-app `/v1/orders` requests — one device
  (`driver_mW76oeHnja`) sending only `POST /v1/drivers/:id/track` (2,637). Revisit with real
  traffic once drivers load orders in the app (then ~90 ms/order `/v1` serialization is the target).

## Corrections and repo-state notes
- **Correction:** the driver-app evidence (`phase2.txt`, `network.txt`) calls the console a
  "dev-mode bundle". That is wrong. The live console is a **production** build per A45
  (`ops/fleetbase/CONSOLE_PERFORMANCE.md`); all 10 engine `config/environment` meta tags report
  `production`. Its ~3.4 MB-gzip first load is simply Fleetbase's size, cached as immutable afterwards.
- `ops/fleetbase/docker-compose.override.yml` in this repo is **stale**: it predates A60 and the
  ops.nutreeze.com host. The VPS file `/opt/fleetbase/docker-compose.override.yml` is the
  deployed source of truth (A60 + A67 lines). It was not synced here because that is outside this unit's scope. [NC] owner to decide.

## Not done / follow-ups [NC]
- Packet loss itself lives on the provider/transit path; BBR tolerates it but does not remove
  it. A CDN in front of the static console assets would cut first-load further (DNS decision).
- Re-measure from a driver phone on mobile data once the fleet actually uses the Orders tab.
