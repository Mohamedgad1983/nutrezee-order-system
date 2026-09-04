# A40 — driver color, vehicle number and phone on box labels

## Required behavior

- Every printable current-day Fleetbase order uses the immutable assigned-driver public id as
  identity. A display name is never used to choose the color or printed driver identity.
- All drivers in the authenticated company's current Fleetbase directory receive different
  colors. The mapping is deterministic for that complete directory and independent of orders,
  customers, areas and driver names.
- The box label (100 × 70 mm design, printed on 150 × 100 mm sticker stock at zoom 1.4286 since A52) prints one prominent color band/border with the current Fleetbase
  vehicle plate and driver phone. The customer Code 128 value and bars remain black and unchanged.
- A reassigned order is resolved again from Fleetbase on preview and therefore receives the new
  driver's color, vehicle and phone.
- An assigned driver without a public id, unique color, phone or vehicle plate blocks printing
  explicitly. No value is inferred from a name, internal id, vehicle description or local cache.
- Phone/vehicle values are returned only inside the authenticated Fleet-Ops label preview. They
  are not stored in Nutrezee tables, audit rows, Partner data, logs, QR/barcode payloads or public
  endpoints.

## Verified production-data prerequisite — 2026-08-18

The current Fleetbase company has 12 non-deleted driver records, including the 11-driver active
dispatch roster. All 11 active drivers have a phone. Under A41, operations used the supplied
driver workbook to create and link nine real Fleetbase vehicle plates through the supported API;
post-write reconciliation proved nine unique plates, nine distinct driver links, zero duplicate
plates and zero cross-company links. Phone was used only as a transient matching key and was not
stored in any vehicle field. Ahmed Al-Salem and Unit-01 remain unlinked because their workbook
plate cells are blank. A40 production deployment therefore remains blocked until those two real
plates are supplied and linked. No vehicle number may be invented.

## Predeclared implementation files

Recorded before source edits:

- `app/packages/shared/src/index.ts`
- `app/apps/api/src/modules/m25-label/fleetbase-identity.service.ts`
- `app/apps/api/src/modules/m25-label/label.service.ts`
- `app/apps/api/src/modules/m25-label/label.controller.ts`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/utils/normalize-label.js`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/order-label.hbs`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/batch-labels.hbs`
- `ops/fleetbase/extensions/nutrezee-labels-engine/addon/styles/addon.css`
- `ops/fleetbase/extensions/nutrezee-labels-engine/README.md`
- `app/tests/unit/ts-u-fleetbase-label-identity.test.ts`
- `app/tests/unit/ts-u-driver-location.test.ts`
- `app/tests/unit/ts-u-fleetops-label-extension.test.ts`
- `app/tests/integration/ts-i-label-barcode.test.ts`

No Fleetbase vendor source, Navigator source, Partner source, migration, secret, or live vehicle
record is modified by this unit.
