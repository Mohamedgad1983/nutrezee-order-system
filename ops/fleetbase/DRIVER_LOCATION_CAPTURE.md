# A30 — assigned-driver missing-location recovery

Status: staging software deployed and Fleet-Ops browser proof green in draft PR #47. Android 14
emulator route/error-state proof is green in English and Arabic; the physical assigned-driver
capture flow remains pending. Production activation remains prohibited until explicit release
approval.

## Operating rule

Fleetbase identity plus the current Kuwait-day Fleetbase assignment is the only driver authority.
For an assigned order, location precedence is:

1. a valid authoritative Partner pin;
2. the latest Fleet-Ops-approved Nutrezee capture for the same stable Partner customer reference;
3. an explicitly labeled same-area known-stop anchor;
4. the configured area centroid, also explicitly labeled as fallback.

Fallback coordinates are navigation aids only. They are never stored or displayed as the
customer's exact pin, and the customer identity behind a known-stop anchor is never exposed.

## Driver flow

1. Navigator lists only the authenticated driver's current assigned orders that still lack an
   exact pin, including that order's own customer name, area and phone.
2. The driver navigates to the safe fallback anchor and calls the customer.
3. The driver captures either the phone's current GPS after reaching the customer or coordinates
   extracted from a customer-shared Google Maps link.
4. The API validates Kuwait bounds, the still-current Fleetbase assignment, stable customer
   reference, idempotency, and whether a valid Partner pin has appeared before accepting.
5. The accepted capture and audit row are committed in one transaction.

## Governance

- Captures are append-only. A driver cannot edit or replace an accepted location.
- Fleet-Ops may approve a correction only with a required reason; the prior capture remains in the
  ledger and the replacement links back to it.
- A valid Partner pin always wins and is never overwritten or written back.
- The daily bridge may read the latest approved capture only for a missing/invalid Partner pin.
- No unattended dispatch or production activation is part of the implementation unit.

## Staging proof — 2026-08-08

- Verified pre-deployment database and Fleet-Ops backups plus rollback image tags.
- Applied additive migration `0029_driver_customer_location.sql` only; blocked migrations
  `0024`–`0026` remain absent.
- Deployed the A30 API and supported Console extension. Local/public health, route registration,
  unauthenticated `401` boundaries and cache-busted extension discovery passed.
- Authenticated Fleet-Ops browser proof loaded the bilingual `Nutrezee Driver Locations` page,
  its append-only correction warning and the correct empty state with no console errors.
- No driver capture, Fleet-Ops correction, dispatch write or production activation was performed.
- Installed the exact green-CI debug artifact from run `31252463962` on an Android 14 emulator,
  reached the Driver Locations route in English and Arabic, and confirmed a clean fail-closed
  response for an authenticated account that Fleetbase did not verify as a driver. No assignment
  or customer data was returned and no capture request was submitted.
- Emulator QA exposed and closed two UI defects: the empty message could render beside an API
  error, and Fleetbase identity failures used a generic fallback. Navigator commit `e6c27b6`
  renders one explicit bilingual authorization error; focused A30 tests pass 10/10 and the full
  Jest suite passes 65 suites / 339 tests.
- Physical assigned-driver proof remains open. It needs one current eligible assignment to verify
  fallback navigation, calling that customer, GPS/shared-coordinate preview, explicit confirmation,
  accepted/idempotent persistence and Fleet-Ops visibility.
- The complete manual Partner dry-run read 3,210 meal rows and 739 orders, preserved 549
  authoritative Partner pins, identified 172 same-area known-stop anchors, loaded zero saved
  captures and completed with `fleetbase_written=false`. Database counts were unchanged and the
  unattended dispatch timer remained disabled/inactive.

## Predeclared implementation files

- `app/db/migrations/0029_driver_customer_location.sql`
- `app/apps/api/src/modules/m25-label/driver-location.service.ts`
- `app/apps/api/src/modules/m25-label/fleetbase-identity.service.ts`
- `app/apps/api/src/modules/m25-label/label.controller.ts`
- `app/apps/api/src/app.module.ts`
- `app/packages/shared/src/index.ts`
- `app/tests/integration/ts-i-driver-location.test.ts`
- `app/tests/unit/ts-u-driver-location.test.ts`
- `ops/fleetbase/nutreeze-orders.php`
- `ops/fleetbase/nutreeze-orders-run.sh`
- `ops/fleetbase/PARTNER_DAILY_DISPATCH_RUNBOOK.md`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/extension.js`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/driver-locations.js`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/driver-locations.hbs`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/styles/addon.css`
- `ops/fleetbase/extensions/nutrezee-labels-engine/README.md`

This list must be amended before any additional implementation file is edited.
