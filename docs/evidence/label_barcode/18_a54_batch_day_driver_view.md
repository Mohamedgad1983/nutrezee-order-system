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

## A54.2 — first live use failed: `upstream_unavailable: fleetbase_transport_failure` (fixed, deployed)
PR [#69](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/69) · CI 29/29 · merged `167b64b` · API `nutrezee-api:a54-2-8bd3814`

**Cause (Verified on staging)** — Fleetbase serialises a full order document in ~0.2 s, so one 100-order page of
Saturday's set took **18.3 s** (1.64 MB) against the gateway's 15 s timeout; today's empty day answered in 0.18 s, which
is why every current-day run before A54 looked fine.

**Fix** — `HttpFleetbaseIdentityGateway.orders`: `columns[]=uuid,public_id,internal_id,scheduled_at,status,meta,
driver_assigned_uuid` (Fleetbase still attaches the assigned driver with vehicle/plate/phone to a column-limited row;
customer/payload are not read by the batch projection) → ~4.3 s per 100-order page (Fleetbase caps `limit` at 100);
timeout 45 s; pages after the first fetched in parallel waves of 4 until the first short page (duplicate/missing ids and
a non-terminating paginator still fail closed). `FleetbaseIdentityService.ordersForOperatorDate` memoises one operator
day per token (SHA-256 fingerprint, never the token) for 60 s so options → preview → printed reuse one fetch.

**Measured after deploy (inside the API container, public key, same code path)**
| date | Fleetbase orders returned | all with driver | wall time |
|---|---|---|---|
| 2026-09-05 | 512 | yes | 8.9 s |
| 2026-09-04 | 0 | – | 0.2 s |

**Observation, not part of this change [NC → owner]** — Fleetbase holds ~190 Partner orders per day
(`meta.dispatch_state = held_no_real_location_pin`, no `scheduled_at`, no driver, status `created`): 2026-09-01 189,
09-02 191, 09-03 191, 09-05 169 (+3 invalid pin, 1 no partner driver, 1 unapproved meal), 09-06 207. These never enter
the Batch Labels set (the page reads `scheduled_at = day`), so per-driver printing covers the dispatched 512 for Saturday
only; 127 of the 169 held orders already carry a Partner driver. This is the standing importer hold rule, unchanged
here — printing labels for held orders is an owner decision.

## A54.3 — selects rendered blank (fixed, deployed)
PR [#70](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/70) · CI 29/29 · merged `3656390` · console `fleetbase-console:a54-3-d3b57cc` (release `0.7.48-a54.3`, extension `0.3.11`)

With Saturday loaded (512 orders, 9 drivers, 90 areas) both controls showed no choice: Glimmer applies a `value`
bound on a `<select>` when the element is created, before its `<option>`s exist, so Chrome leaves `selectedIndex = -1`
(the old template only *looked* right because its first option happened to equal the default). Each option now carries
`selected` (`eq this.filterType "driver"`, `eq option.id this.filterValue`) and the list is keyed by id. Gate 7/7 on a
temp container (production metadata, extension 0.3.11, theme alias 200, gzip, immutable, no Clear-Site-Data, no
`select value=` left in the bundle); live `extensions.json` reports 0.3.11.
