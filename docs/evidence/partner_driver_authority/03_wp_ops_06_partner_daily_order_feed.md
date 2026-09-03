# 03 — WP-OPS-06 (A47): Partner daily-deliveries → Nutrezee order feed

Date: 2026-09-03 · Branch: `build/wp-ops-06-partner-daily-order-feed` (parent `fix/a45-console-performance`)
Status: BUILT + tested locally; NOT deployed; owner decision on 2026-09-03 after the Saturday readiness review (02_*.md).

## Why

Fleet-Ops barcode labels and the Navigator collection scan both look up the order in Nutrezee
Postgres (`customer_order` + `fulfillment_day`, joined by `order_number` / `(order_id, date)`).
That data stopped at order 24675 (2026-07-27) when the legacy scraper was frozen, so neither
feature can work on current orders. Partner's `/integration/daily-deliveries` feed — already
the Fleetbase dispatch authority (A36/A46) — carries everything the lookups need.

## What was built (Verified locally)

| Piece | File | Notes |
|---|---|---|
| Feed client + contract | `app/apps/api/src/modules/m19-migration/partner-daily-feed.ts` | Same validation as the PHP bridge (`validateDailyDeliveryRow`), cursor pagination, `mode=live`, per-date completeness check, key only in `X-Api-Key`, nutreeze.com-only base URL. `canonicalizeDailyDeliveries()` collapses repeated rows per order (latest `updated_at`), unions delivery ids, rejects conflicting identities |
| Importer | `importers.ts` → `partnerDailyImporter()` | Order by `sync_record('order', order_number)` → `customer_order.order_number`; customer by normalized phone (`+965` default from `default_phone_country_code`), created via `CustomerService.createImported` when new; order via `OrderService.createImportedActivePlanInTx` (`channel=partner`, `currency=KWD`, `start=end=delivery_date`, frozen address/area/time/method) |
| Day mirror | `order.service.ts` → `ensureImportedDayInTx()` | Creates the `(order, date)` day; widens the order's date range; moves a day only between `scheduled` / `skipped` (Partner on-hold) / `cancelled_day` (Partner cancel); returns `locked` and leaves kitchen/delivery-progress days untouched; writes `order_status_history` |
| Batch type | `batch-runner.ts`, migration `0030_partner_daily_import_type.sql` | `partner_daily` with gate `maxErrorRate 0.02`; dry-run → apply same-snapshot rule, audit + outbox `bridge.import_run` as for every M19 batch |
| API | `migration.controller.ts` | `POST /imports/partner-daily/fetch/dry-run` and `/apply` `{delivery_date}` (perms `bridge.import.run` / `.apply`); the API fetches Partner itself with the server-held key (`NUTREEZE_PARTNER_DAILY_API_KEY`, falling back to the existing `NUTREEZE_PARTNER_LABEL_API_KEY`); `partner_daily` also accepted as a rows-based `:type` for tests/ops |
| Wiring | `app.module.ts` | `PARTNER_DAILY_FEED` provider (`fromEnv()`, `null` when no key → endpoints answer `partner_daily_not_configured`) injected into `MigrationService` |
| Runner + timer | `ops/sync/partner-daily-feed.mjs`, `ops/systemd/nutrezee-partner-daily-feed.{service,timer}` | Same guards/temp-admin pattern as `apply-order-sync.mjs`; `FEED_MODE=dry-run|apply`, `ALLOW_APPLY=yes`, `SYNC_TARGET=staging`; timer 23:20 UTC = **02:20 Kuwait** (after the 02:00 Fleetbase same-day sync, before 03:00 collection), targets today + tomorrow. Units ship **disabled**; owner installs/enables |

Report fields added for operations: `source.delivery_rows / distinct_orders / completeness /
orders_without_partner_driver / cancelled / on_hold`, per-row messages
`day_created | day_updated | day_unchanged | day_locked`, `customer: created | exact phone match`.

## Tests

- TS-U `tests/unit/ts-u-partner-daily-feed.test.ts` (7): contract normalization, driver id string
  form, rejection matrix, canonicalization (latest wins, id union, cancel flag), conflicting
  identities, paginated client with `X-Api-Key`, zero-day handling, completeness mismatch, 401,
  base-URL/key refusal.
- TS-I `tests/integration/ts-i-partner-daily-import.test.ts` (4): dry-run has no business writes;
  apply creates 2 customers (shared phone → one customer) + 3 orders + days with frozen
  address/area/time, `+965` phone, `sync_record` keys, 2 audit rows; re-run all `matched` /
  `day_unchanged`; next date adds days and widens ranges; Partner cancel → `cancelled_day`,
  un-hold → `scheduled` (`day_updated`), a `delivered` day stays `locked`; **end-to-end**: issued
  NZC barcode of an imported customer scans `accepted` for the Fleetbase-assigned order,
  `wrong_driver` for another driver, and a phone shared by two same-day orders is
  `ambiguous_delivery` by design; contradictory feed rejected; apply without same-snapshot dry-run
  refused.
- Full local gate 2026-09-03: typecheck ✅, lint ✅, build ✅, both CI scans ✅, **full Vitest 75 files / 423 tests ✅** (local Postgres 16).

## Binding-constraint notes

- Single write path kept: M19 never writes `customer_order` / `fulfillment_day` / `customer`; it
  calls M03/M04 import APIs (cross-module-write scan green).
- Transition engine bypass is limited to the three mirror states and to the M19 import path, as
  the existing `createImportedActivePlanInTx` already does; recorded as amendment **A47**.
- PII: Partner names/phones/addresses pass through the batch transaction only; the ops runner
  logs counts and error messages, never rows.
- Rollback of a `partner_daily` batch deletes the customers/orders it created (owner ports);
  days added to pre-existing orders are not stamped with a batch id and are not rolled back.

## Deployment plan (owner)

1. Merge PR; deploy API image with migration `0030` (gated migrate step).
2. Set `NUTREEZE_PARTNER_DAILY_API_KEY` (or rely on the label key) in the API env.
3. Copy `partner-daily-feed.mjs` to `/opt/nutrezee/sync/`, install the two units, **do not enable yet**.
4. Manual `FEED_MODE=dry-run` for tomorrow; review `errors`, `orders_without_partner_driver`,
   `locked_days`; then `FEED_MODE=apply ALLOW_APPLY=yes` once; verify a Fleet-Ops batch label
   preview and one driver scan on the emulator.
5. Enable the 02:20 timer.
