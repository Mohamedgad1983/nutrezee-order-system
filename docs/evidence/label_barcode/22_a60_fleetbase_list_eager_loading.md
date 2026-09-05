# A60 — Fleetbase vendor patch: list endpoints eager-load order relations

2026-09-05 · DONE + LIVE · Owner directive: "نفّذ الحل الأول عدّل كود Fleetbase" (explicitly authorizes modifying Fleetbase vendor code; supersedes the "vendor unchanged" rule for this unit only).

Follow-up to `21_a59_monochrome_label_and_console_latency.md`, which found the console's slowness in Fleetbase's own per-order serialisation.

## What was measured before touching anything — Verified
- The console's Orders list is `GET /int/v1/orders` served by the lightweight index resource (not the public `/v1/orders` I had timed earlier). Replayed through the HTTP kernel as the company owner (CLI, opcache): **108 queries, 306–394 ms** per 25 rows — per order: 2 `files` scans (place avatar options), 1 `entities` count, 1 `places` lookup.
- Public `/v1/orders` (full resource): 315 serialisation queries per 25 orders; time dominated by PHP in nested resources (payload 668 ms, tracking statuses 415 ms, customer 476 ms per 25).
- A lazy-loading census (`Model::preventLazyLoading` handler) listed the exact relations touched: payload pickup/dropoff/return/currentWaypoint, trackingNumber(+owner), trackingStatuses, purchaseRate, transaction, company, comments, files, custom fields, driver, vehicle, facilitator, customer (Contact photo/user).

## The patch (5 vendor files, `ops/fleetbase/api-patches/a60/a60.diff`) — Verified
| File | Change |
|---|---|
| `Models/Order.php` | `Order::apiListRelations()` — the eager-load list. `orderConfig` excluded on purpose (it flipped the index resource's `order_config` from null to an object). |
| `Controllers/Internal/v1/OrderController.php` | `onQueryRecord` hook → console list query eager-loads the list. |
| `Controllers/Api/v1/OrderController.php` | public `query()` uses the same list (superset of its previous five). |
| `Models/Place.php` | `getAvatarOptions()` memoised 60 s per worker (was a full `files` scan per place). |
| `Resources/v1/Index/Payload.php` | count defaults become closures (no re-count when loaded). |

No write, job or single-record path touched. Syntax-checked with `php -l`; behaviour tested on a throw-away container (`a60-test`, same image + env, patched files bind-mounted) before touching live.

## Equivalence and gain — Verified
| Path | Before | After (a60-test, then live) |
|---|---|---|
| `/int/v1/orders?limit=25&sort=-created_at&layout=map` | 108 queries, 306–394 ms | **8 queries, 116–207 ms** (live after deploy: 8 queries, 166 ms) |
| `/v1/orders?limit=25&sort=-created_at` HTTP | 2.5–3.0 s, 332,882 B | body **byte-identical**; time unchanged (CPU-bound nested resources) |
| `/v1/orders?limit=1` | 0.20 s | 0.15 s |
| Console list JSON | — | key-for-key identical except `order_config`: was null, now the 4-field object the index resource emits when the relation is loaded; the detail endpoint already returns the full `order_config` object, so the console serializer handles it. (Then `orderConfig` was removed from the list; the relation is still loaded by the kernel path itself, so the object remains.) |

After the deploy: the labels/importer read path (`/v1/orders?scheduled_at=2026-09-06&limit=100&columns[]=…`) answers 100 orders in 2.2 s with `driver_assigned` + `vehicle` attached as before (A54.2 contract intact); the importer dry-run for 2026-09-06 (Partner source only — it does not walk Fleetbase in dry-run mode) reports 836 rows / 834 orders as before; the application log is free of errors. The write path (PUT by the evening importer) is unpatched code and will be exercised by the 20:05 Kuwait run.

## Deploy — Verified (staging Fleetbase, owner-authorized)
- Originals: `/opt/fleetbase/backups/a60-vendor-orig/` (md5 in `checksums.md5`); patched files `/opt/fleetbase/patches/a60/`; diff `/opt/fleetbase/patches/a60.diff`.
- Bind mounts (read-only) added to `docker-compose.override.yml` (application, queue, scheduler) and `docker-compose.application-queue.json` (application-queue); backups `backups/docker-compose.override.yml.pre-a60-*`, `backups/docker-compose.application-queue.json.pre-a60-*`.
- Recreated at 17:22 UTC (20:22 Kuwait), outside the :05 importer window; all four containers healthy; console 200; v1 list 200 and identical.
- Rollback: drop the volume blocks, `docker compose up -d application queue scheduler` (+ the application-queue command with its three compose files).
- Repo: PR [#79](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/79) CI 29/29, merged `f65bfd3`; TS-U guard `ts-u-fleetbase-api-patches` (4).

## Caveats — Inferred
- A bind-mounted file keeps its old inode when edited in place: always recreate the container after changing a patch file (bit me on `a60-test`).
- The public `/v1/orders` full resource stays CPU-bound; the labels/importer paths already use the `columns[]` projection (A54.2) and are unaffected.
- Other console lists (drivers: 256 queries for 9 rows, mostly permissions/roles) were not patched.
