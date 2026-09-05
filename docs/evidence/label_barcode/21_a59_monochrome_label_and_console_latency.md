# A59 — Black-and-white label, and where the console's time goes

2026-09-05 · DONE + DEPLOYED · Owner request: "label printer only black and white, no need color; need only driver name, car number and telephone number" and "admin portal every page takes a lot of time loading data".

Note on ids: the code PR, commit and console tag carry `A58`/`a58.1` (chosen before the register showed A58 taken by the invitation-delivery unit). The register id for this unit is **A59**.

## 1. Monochrome label — Verified

- Driver colour band removed: the 16 `.nz-driver-color--*` rules, the `driverColorClass` bindings in both label templates and the `DRIVER_COLORS` token in the normalizer are gone. The API still returns `driver_color`; the extension ignores it.
- Driver box prints black text on white with a `0.45mm` solid black border. Contents unchanged and exactly three facts: car number, driver name, driver phone.
- Every label rule, the brand mark, the tagline and the empty-meal note are `#000` (were greys). `print-color-adjust: exact` kept so the black border survives print drivers.
- Extension `0.3.16`, console `0.7.48-a58.1` (Dockerfile ARG + pin test). TS-U extension boundary test rewritten for the monochrome contract (18/18 locally, CI 29/29 on PR [#78](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/78), merged `76ffbd0`).

### Release — Verified
- Source backup `/opt/fleetbase/backups/nutrezee-labels-engine-0.3.15-20260905-1840`, Dockerfile `backups/console-Dockerfile-a56.1-20260905-1840`.
- Image `fleetbase-console:a58.1` (`f1b301564ebb`) built on the VPS; gate on a temp container: production metadata ✓, theme alias 200 ✓, gzip 30,080→6,434 B ✓, fingerprinted engine CSS `immutable` ✓ (the alias is `no-cache` by design, same as live), no Clear-Site-Data ✓, engine CSS has 0 colour classes and carries the black border ✓, extensions.json `0.3.16` ✓.
- Tagged `latest`, `docker compose up -d --no-build console`; live `ops.nutreeze.com` serves extensions.json `0.3.16` and engine CSS with 0 colour classes.
- Rollback: `docker tag fleetbase-console:a56-1-6dbf641 fleetbase-console:latest && docker compose up -d --no-build console`.

## 2. "Every page loads slowly" — Verified findings, no fix applied

The owner's daily console is Fleetbase at `ops.nutreeze.com`. The Nutrezee admin SPA (`13-140-159-201.sslip.io/app`) has had no human traffic in 48 h (scanner bots only), so the complaint is about the Fleetbase console.

| Check | Result |
|---|---|
| VPS | load 1.8 on 8 cores, 13 GB RAM free, no swap; Fleetbase app 2% CPU idle |
| MySQL 8.0.46 | `skip_name_resolve` ON, buffer-pool hit 99.99 %, all past orders `completed` (12,833), 681 today, 5,777 future; live/* endpoints cached by LiveCacheService and small (≤ 56 KB) |
| DNS inside the Docker networks | 900 lookups, 0 slow |
| Console assets | gzip + immutable, vendor 1.9 MB compressed |
| `/v1/orders?limit=1` | 0.2 s |
| `/v1/orders?limit=25` | 1.5–2.1 s, steady across 80 back-to-back and 3×8 parallel requests |
| `/v1/orders?limit=100` | 9 s |
| Where the time goes (in-container timing, 25 orders) | query 7 ms · resource build 614 ms · JSON serialisation 962 ms; **~47 SQL statements per order** (Com_select +1,175 per request), each < 1 ms; DB busy < 5 % of the wall time |

So the cost is Fleetbase's own per-order serialisation (`Order` resource lazily loading payload, places, entities, tracking statuses, files, custom fields per order) — about 60–80 ms of PHP per order — not the server, the database or the network. The console's Orders page (25 rows) therefore waits ~2 s for `/int/v1/orders`, plus the dashboard widgets and 5-minute live polls.

The 5-second "spikes" (6.5–7 s) seen from the VPS itself were a measurement artifact: `time_connect` was 5.01 s only when the VPS dialled its own public IP (hairpin); via loopback and from inside the Docker networks 0 spikes in 100+ requests. Users in Kuwait do not take that path.

What would actually make pages faster (owner decision; none applied):
1. Eager-load the order relations in the vendor `OrderResource`/controller (Fleetbase source patch, contrary to the "vendor unchanged" rule — needs explicit authorisation) — expected 5–10× on list endpoints.
2. Upgrade Fleetbase (later releases moved the console lists to the lighter `OrderIndexResource`).
3. Smaller console page size (fewer rows per list page) — proportional gain.

Diagnostics were transient: slow-log and general-log switched back off (`slow_query_log=OFF`, `long_query_time=10`, `general_log=OFF`); performance_schema consumers left at their original values; temp files removed; images `curlimages/curl:8.10.1`, `busybox:1.36`, `python:3.12-alpine` pulled for probes.
