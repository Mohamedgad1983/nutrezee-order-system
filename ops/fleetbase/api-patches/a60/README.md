# A60 — Fleetbase list endpoints: eager-load order relations

Owner-authorized vendor patch (2026-09-05): "نفّذ الحل الأول عدّل كود Fleetbase".
Fleetbase `fleetbase/fleetbase-api:v0.7.48`, packages `fleetops-api 0.6.56` / `core-api 1.6.53`.

## Why
The console's Orders list (`GET /int/v1/orders`) and the public list (`GET /v1/orders`) serialised
every order with ~4 (index resource) to ~45 (full resource) lazy relation queries per order, plus one
full `files` table scan per place for avatar options. A 25-row console page cost 108 queries.

## What changes (5 files, see `a60.diff`)
| File | Change |
|---|---|
| `Models/Order.php` | new `Order::apiListRelations()` — the eager-load list (payload places/markers, tracking number + owner, tracking statuses, purchase rate, transaction, company, comments, files, custom fields, driver, vehicle, facilitator, customer with Contact photo/user or Vendor place). `orderConfig` deliberately excluded so the index resource output stays unchanged. |
| `Http/Controllers/Internal/v1/OrderController.php` | `onQueryRecord` hook (core `getControllerCallback`) applies the list to the console list query. |
| `Http/Controllers/Api/v1/OrderController.php` | public `query()` uses the same list (superset of the previous five relations). |
| `Models/Place.php` | `getAvatarOptions()` memoised 60 s per worker (in-process static). |
| `Http/Resources/v1/Index/Payload.php` | `entities_count` / `waypoints_count` defaults become closures so loaded relations are not re-counted. |

Single-record, write and job paths are untouched. Output equality was verified byte-for-byte on
`/v1/orders?limit=25&sort=-created_at` and key-for-key on the console list (only `order_config`
now carries the lightweight object the index resource already emits when the relation is loaded;
the detail endpoint returns the same object, so the console serializer handles it).

## Measured (kernel replay as the company owner, CLI opcache, 25 orders)
| Path | Before | After |
|---|---|---|
| `/int/v1/orders` (console list) | 108 queries, 306–394 ms | 8 queries, 116–207 ms |
| `/v1/orders` HTTP (public, full resource) | 315 serialisation queries, ~1.5–2.6 s | body identical; time unchanged (CPU-bound sub-resources) |

## Install / rollback
- `install.sh [image]` rebuilds `/opt/fleetbase/patches/a60` from the stock image + `a60.diff` and verifies
  both checksum sets in `checksums.md5`.
- The files are bind-mounted read-only via `compose.fragment.yml` (merged into
  `/opt/fleetbase/docker-compose.override.yml` for application/queue/scheduler and into
  `docker-compose.application-queue.json`). Recreate the containers after any change — a bind-mounted
  file keeps its old inode if edited in place.
- Rollback: remove the volume lines (backups `backups/docker-compose.override.yml.pre-a60-*`,
  `backups/docker-compose.application-queue.json.pre-a60-*`) and `docker compose up -d application queue scheduler`.
- Originals: `/opt/fleetbase/backups/a60-vendor-orig/`.
