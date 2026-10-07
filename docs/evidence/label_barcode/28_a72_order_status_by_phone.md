# 28 — A72: order status by customer phone in the Fleet-Ops console

Date: 2026-10-06 (Kuwait) · Owner directive: "في الادمن (ops.nutreeze.com) محتاج بحث عن حالة الطلب عن طريق تليفون
العميل… وقدامه قد ايه علشان يوصل للعميل تقريبا: مسافة ووقت وطلبات قبله".

## What it is
A read-only page `Order Status` in the console's Resources sidebar (same place as Batch Labels).

- **API** `GET /fleet-ops/order-status?phone=&delivery_date=` (`m25-label`): verified Fleetbase operator only; day
  window is the Batch Labels window (yesterday … +7, default today). The phone is matched on its last digits
  (`55123456`, `+965 5512 3456`, `0096555123456`, Arabic digits). The customer's orders are matched against the
  day's Fleetbase set with the same code Batch Labels uses, so Partner and WhatsApp-system customers both appear.
- **Per delivery**: customer name, order number, area, state (delivered / on the way / with the driver / not sent
  out), driver name, phone and plate, the driver's delivered count of the day, label printed or not.
- **Estimate** (pure rules in `order-status.ts`, TS-U `ts-u-order-status`): straight-line distance from the driver's
  last app position × 1.35, time at 28 km/h + 4 min per order before it; "orders before it" = the driver's other
  undelivered orders that are nearer to the driver than this customer. Given only when the position is ≤ 15 minutes
  old and the customer has a pin (exact Partner pin, else the area centre, stated on the page). Otherwise the page
  says why: app never sent a location / app not open now / customer has no location.

## Facts that limit it today (Verified on staging, 2026-10-06)
- No driver has an app position newer than 2026-10-05 13:11; today all 948 orders are `dispatched`, none started.
  So distance / time / orders-before will read "driver's app is not open" until the drivers use the app.
- Yesterday's orders are all `completed` by the 02:00 closing job, not by drivers: for a past day "delivered" means
  the day was closed. For today it is true only once drivers complete orders in the app.
- About 30% of Partner orders have no exact pin (area centre is used and labelled as such).

## Tests
TS-U `ts-u-order-status` 5/5, TS-I `ts-i-label-barcode` 25/25 (phone lookup, day pin, candidate status/pin),
TS-U extension boundary test (page registered, GET only, no `<select>`), all TS-U 199 passed; typecheck, lint,
no-GET-mutation scan clean.

## Deploy (staging, 2026-10-06, owner: "كمل ونزلها")
- CI 31/31 on PR #97.
- **API** `nutrezee-api:a72-d0c64b5` at 11:53 Kuwait (rollback `nutrezee-api:pre-a72-20261006`): env fingerprint
  identical, `/health` 200; label check unchanged (WhatsApp 34/34 with address, Partner sample identical); night check
  `[OK] … 944 = legacy screen 944 + WhatsApp 34`. `GET /nz/fleet-ops/order-status` without a token → 401.
- **Lookup on real data** (deployed code, day 2026-10-07, 978 candidates): 51 phones (40 random Partner, 10 WhatsApp,
  1 fake) → 50 customers found, 49 with a delivery that day (55 deliveries), fake number not found; pins: 37 exact,
  9 area centre, 9 none; 21 ms average per lookup; with no driver position the answer is `driver_position_missing`.
- **Console** `fleetbase-console:a72-1` (release `0.7.48-a72.1`, extension `0.3.17`), rollback
  `fleetbase-console:pre-a72-20261006`; previous extension source kept at
  `/opt/fleetbase/backups/nutrezee-labels-engine-0.3.16-20261006`. Isolated-container gate 10/10: nginx syntax,
  production metadata, 10 extensions with Nutrezee 0.3.17, theme alias, Order Status in the bundle, Batch Labels still
  in the bundle, page styles, gzip, immutable fingerprinted assets, no Clear-Site-Data. Only the console container was
  recreated; `ops.nutreeze.com`, `/extensions.json`, `/nz/health`, the fleet host and the app health all 200.
- **Not verified [NC → owner]**: the page rendered inside a signed-in console session (the assistant has no console
  login). Owner to open Fleet-Ops → Resources → Order Status and search one phone.

## A72 seen in a signed-in console + A74 map tiles (2026-10-07)
Through the owner's own signed-in browser (with permission):
- **Order Status renders and answers**: Resources → Nutrezee Order Status; one real phone → customer, order 30051,
  area, "with the driver, not delivered yet", driver name/phone/plate, 0 of 123 delivered, label "not printed yet",
  and "the driver's app has never sent a location". First search of the minute ≈ 15 s. Closes the [NC] above.
- **Finding**: `label_print_event` has no row since 2026-09-28 — the owner confirmed the nightly print still runs from
  the legacy admin. No real print from Batch Labels has happened yet; a one-driver paper trial was proposed.

**A74 — "API KEY REQUIRED" on the dashboard map, and "it shows Ukraine".** Fleet-Ops 0.6.56 hard-codes CARTO basemap
tiles; CARTO now stamps them without a paid key. The flag is Leaflet's attribution prefix, not the map position (the
map was on Kuwait). Fix in the extension only: CARTO basemap tile addresses are rewritten to the same z/x/y tile on
OpenStreetMap; the flag is hidden, credits stay. Extension 0.3.19, console `0.7.48-a74.2`.

**Incident (mine):** the first build (a74.1, extension 0.3.18) put the rewrite in `addon/utils/map-tiles.js` and imported
it from `extension.js`. Fleetbase copies `extension.js` alone into the Console app, so the import could not be
resolved and the Console stopped at "Starting up…" for every user. Live for under two minutes at 11:25 Kuwait; rolled
back to `fleetbase-console:pre-a74-20261007`. The 12 static gate checks had all passed — none of them loaded the app.

**Correction:** the rewrite lives inside `extension.js`; a unit test forbids relative imports there; the gate got a
static check for it (fails on a74.1, passes on a74.2) and is now in the repo as `ops/fleetbase/console/release-gate.sh`
with the rule to open the candidate in a real browser before the swap. Done for a74.2 over an SSH tunnel with a74.1
as the control: a74.1 → "Starting up…" + `Could not find module …/utils/map-tiles`; a74.2 → title "Nutreeze |
Fleet-Ops", no module error, and in that page a CARTO tile address resolves to `tile.openstreetmap.org` while another
image address is unchanged. After the swap, in the owner's browser: dashboard map shows Kuwait from OpenStreetMap with
no stamp and no flag; Batch Labels (977 orders, 9 drivers) and the Fleet-Ops live map load.
