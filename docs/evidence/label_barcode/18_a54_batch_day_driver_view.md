# 18 — A54: Batch Labels by delivery day, driver-first, every label shown as a view

Date: 2026-09-04 (Kuwait) · Owner directive: "فين اختيار السواقين… لما اختار السائق أشوف كل labels اليوم ده اللي أنا اختاره as a view"
PR [#68](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/68) · CI 29/29 · merged `a1e9051` · API `nutrezee-api:a54-ec027d0` · console `fleetbase-console:a54-ec027d0` (release `0.7.48-a54.1`, extension `0.3.10`)

## What was wrong (Verified)
The Fleet-Ops **Batch Labels** page was hard-wired to the server's *current* Kuwait day (`collection.currentDay()`), so on a
day without deliveries (Friday 2026-09-04) it showed 0 orders, no drivers to choose, and could not prepare tomorrow's run —
while dispatch prints Sunday's stickers on Saturday night. Grouping defaulted to *Area*, and labels only appeared after a
separate "Prepare" click.

## What changed
**API (`m25-label`)**
- `CollectionService.batchDay(requested?)` — server-anchored window around the Kuwait date: **yesterday … +7 days**
  (reprints of yesterday, a week ahead). Default = today. Outside the window → `403 forbidden /
  delivery_date_out_of_window` naming `from`/`to`; malformed or impossible dates → `400 validation_failed`.
  The driver-side collection endpoints keep `currentDay()` unchanged (still today-only).
- `GET /fleet-ops/labels/batch/options?delivery_date=` and `POST …/batch/preview|printed` (`delivery_date` in body)
  use `batchDay`; options now also return `today` and `window`.
- Selection ids already embed the delivery date, so a selection from one day can never be replayed on another.

**Console extension `@nutrezee/fleetops-labels-engine` 0.3.10**
- Delivery-day picker (`<input type=date>` bounded by the server window) + **Today / Tomorrow** buttons, weekday label.
- **Driver** is first in the grouping list and the default whenever any driver is assigned; Area remains for unassigned days.
- Choosing a day/driver/area loads **every label of that selection immediately as a view** (`showSelection()` →
  `POST …/batch/preview`). Nothing is recorded by viewing: Print → dialog → *Confirm printed* is unchanged (A48/A53 rules).
- Copy no longer says "today"/"current-day"; the empty state names the chosen date.

## Tests
- New TS-U `ts-u-label-batch-day` (5): default today + window, tomorrow and both edges, month/year rollover, out-of-window
  403 with window detail, malformed 400.
- TS-U extension boundary test: A54 assertions (date picker bounds, Today/Tomorrow, driver-first default, auto view,
  `delivery_date` in payload); console release pin `0.7.48-a54.1`.

## Deploy (staging, owner-authorized)
- API: source `/opt/nutrezee/a54-src-ec027d0`, `pg_dump` `backups/pre-a54-20260904-164210.sql.gz`, migrate (no new
  files), `up -d --no-deps api`, admin nginx restarted, health 200, running image == `a54-ec027d0`, bundle contains
  `delivery_date_out_of_window`.
- Console: 7-point gate on a temp container — production metadata ✓, theme alias 200 ✓, gzip 87,725→15,789 B ✓,
  `immutable` ✓, no Clear-Site-Data ✓, bundle carries `data-test-batch-date` ✓; extensions.json `0.3.10` ✓ (verified live
  after `up -d --no-build console`). Rollback tags: `fleetbase-console:a48.4`-era `latest` replaced; previous extension
  source kept at `/opt/fleetbase/backups/nutrezee-labels-engine-0.3.9-20260904-1627`, Dockerfile at
  `backups/console-Dockerfile-a48.4`.

## Owner verification still open [NC]
Open Fleet-Ops → Resources → Batch Labels, press **Tomorrow** (2026-09-05): expect 695 orders, driver list populated
(469 assigned), and the first driver's labels rendered on screen without pressing anything else.
