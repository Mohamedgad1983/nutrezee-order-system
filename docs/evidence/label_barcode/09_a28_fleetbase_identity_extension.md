# 09 — A28 Fleetbase identity and Fleet-Ops extension

> **Status:** fully deployed and browser-verified on 2026-07-28.
> A28 corrects A27 so `https://ops.nutreeze.com/` remains the only operations
> administration UI.

## 1. Corrected outcome

- The label is a tab inside the existing Fleet-Ops order-details panel.
- Fleetbase session identity is the only operations and driver identity.
- Navigator reuses its current Fleetbase bearer token; there is no second Nutrezee login.
- Driver collection authority is the verified Fleetbase driver plus that driver's
  Fleetbase-assigned orders for Kuwait today.
- The legacy label structure is retained and one permanent, non-PII Code 128 barcode is added
  in the lower strip.

The separate A27 `/nz-admin` operations shell and `/labels` redirect remain retired.
`/`, `/fleet-ops`, `/labels`, and `/nz-admin/app/labels` all serve Fleetbase Console, while
`/nz/*` remains the same-host JSON API gateway.

## 2. Independent review findings and closures

The read-only A28 audit found three release blockers. Each was reproduced and corrected:

| Finding | Closure |
|---|---|
| Console bundle did not expose a live Nutrezee tab | Local Ember engine added as a Console dependency, enabled through both build and runtime `EXTENSIONS`, and the version-keyed extension cache invalidated |
| Caller-selected past/future collection dates were accepted | `CollectionService.currentDay()` now derives Kuwait today from PostgreSQL and rejects any different client echo with `403 current_day_only` before Fleetbase access |
| A Fleetbase `user` was represented as fabricated `ops_manager` | Only verified Fleetbase `user`/`admin` sessions are accepted; their identity is preserved as `fleetbase_operator`/`fleetbase_admin`, and the same token must fetch the selected Fleetbase order |

The audit also confirmed the permanent barcode constraints, append-only collection evidence,
privacy masking, Navigator bearer reuse, and absence of a second login.

## 3. Safety and exact deployed state

Before A28 data or images changed:

| Artefact | Evidence |
|---|---|
| PostgreSQL dump | `/opt/nutrezee/backups/nutrezee-pre-a28-20260728T003619Z.sql.gz` |
| Dump integrity | 21,218,478 bytes; `gzip -t` passed; 86 `COPY` blocks |
| Dump sha256 | `26630715d5a09cd2c1108ed90a772967fcff6499477695d104be92cb1ea573c6` |
| API rollback | `nutrezee-api:pre-a28-20260728` → `f4ac4d488f7e…` |
| Admin rollback | `nutrezee-admin:pre-a28-gateway-20260728` → `63f4601a1d1f…` |
| Console source backup | `/opt/fleetbase/backups/a28-console-20260728T0315Z` |
| Console rollback | `fleetbase-console:pre-a28-20260728T0315Z` → `421cb421d93c…` |

Only additive migration `0028_fleetbase_collection_identity.sql` was applied for A28.
Migrations 0024–0026 remain unapplied and no routine migration runner was used.

Running images after the API/admin correction:

- API: `0ceb8fa3eff1…`
- Nutrezee admin gateway: `47abcc3c9267…`
- Fleetbase Console: `9bf50d8d817f…`

## 4. Fleet-Ops extension activation

The engine is `@nutrezee/fleetops-labels-engine` and uses Fleetbase's supported
`fleet-ops:component:order:details` menu registry with virtual route
`operations.orders.index.details.virtual`.

Two Fleetbase activation layers are required:

1. build-time `EXTENSIONS=@nutrezee/fleetops-labels-engine`; and
2. runtime `EXTENSIONS` in `fleetbase.config.json`.

Fleetbase also caches the indexed extension list. `/extensions.json` is therefore served with
`Cache-Control: no-cache, no-store, must-revalidate`, and the live manifest contains ten
extensions including the Nutrezee engine.

Follow-up batch-page verification on 2026-07-29 found that an operator browser could still reuse
the response cached under the manifest's **previous** response headers: Fleetbase's loader calls
`fetch('/extensions.json', { cache: 'default' })`, then stores the filtered list in a
version-keyed local cache. Console `0.7.48-a28.4` closes that deployment edge by bumping the
application version and returning `Clear-Site-Data: "cache"` on the new `index.html`. The header
clears HTTP cache only; cookies and local storage are not cleared. The next boot therefore
fetches the ten-entry no-store manifest and replaces the version-keyed nine-entry list.

The first visual pass caught the missing runtime registration; the second caught the stale
extension-manifest cache. A final browser pass proved that the tenth engine loaded and registered
the order-details tab. None was accepted as complete merely because the engine files were present
in the image.

## 5. Label and permanent barcode

The template preserves the photographed legacy label's:

- Nutreeze mark, brand and `Stay Healthy` header;
- two-column information/meal layout;
- customer, subscription, delivery, remaining-day and delivery-method ordering;
- package, meal/snack, user/driver/order identifiers;
- address, phone and notes block;
- `Dish Name / Qty / Pro / Carb / Fat / Cal` table and total nutrition row; and
- dotted/dashed internal rules.

The Code 128 barcode is added below the legacy body. The synthetic customer's value remains
`NZC-GQ2W-Y271-CF` across repeated issuance/rendering; no second barcode was minted.
No customer PII is encoded in the value.

The synthetic order has no authoritative dish detail, so the live preview deliberately says
`No dish detail recorded for this date` and does not fabricate meals or nutrition.

## 6. Live synthetic proof

Only synthetic staging records were used:

- Fleetbase order `order_xn06VY2b1Q` / `A28-LABEL-PROBE`;
- pickup `A28 SYNTHETIC PICKUP`;
- dropoff `A28 SYNTHETIC DROPOFF`;
- local order `a27probe-order`; and
- current-day fulfillment `a28probe-day-20260728`, created by `a28-probe`.

This added exactly one synthetic fulfillment row. Current staging counts are:

| Table | Rows |
|---|---:|
| `customer` | 19,483 |
| `customer_order` | 20,204 |
| `fulfillment_day` | 530,540 |
| `address` | 9,542 |
| `box_collection` | 1 |

The one earlier synthetic collection is append-only and remains intentionally undeletable.
No real customer, order, route, driver, Partner, or legacy row was changed.

Visible browser result:

- Console footer shows `v0.7.48-a28.1`;
- synthetic order details show `Overview`, `Invoice`, and `Label & Barcode`;
- the active tab shows the legacy two-column label, explicit empty-meal state, one Code 128 image,
  and `NZC-GQ2W-Y271-CF`;
- `Print label` was not clicked, so the current-day proof created no print event; and
- the browser was left open on this verified label view.

[Synthetic-only browser screenshot](./a28_live_fleetops_label.png)

## 7. Verification

- Full application Vitest before final Console wiring: 69 files / 378 tests passed.
- Final extension boundary suite: 7/7 passed.
- Navigator collection suite: 17/17 passed.
- ESLint passed.
- API typecheck and build passed.
- PR #44 push and pull-request CI for commit `171c8df` passed the full duplicated 14-job matrix:
  lint, typecheck, build, docker validation, boundary scan, no-GET-mutation scan and
  TS-U/I/M/R/A/C/E/S.
- Commit `dda7270` passed the same duplicated matrix in push run `30322877208` and pull-request
  run `30322878954`.
- Live API probes: health `200`; missing Fleetbase token `401`; past/future date `403
  current_day_only`.
- Live route probes: `/`, `/fleet-ops`, `/labels`, and `/nz-admin/app/labels` all return the
  Fleetbase Console; `/nz/*` remains JSON.
- Live row counts remained 19,483 customers / 20,204 orders / 530,540 fulfillment days /
  9,542 addresses / 1 append-only collection after the Console deployment.

## 8. Remaining physical pilot

Browser layout and live Code 128 rendering can be verified in staging, but exact physical
printer scaling and a camera decode from paper require a real printer/device. The honest final
pilot is to print ten 100 × 70 mm labels, compare them beside the photographed legacy label, and
scan each from paper in Navigator. This is not replaced by a screen-only assertion.

## 9. Rollback

For code-only rollback, retag the three preserved `pre-a28` images and recreate only the affected
API/admin/Console containers. The A28 database migration is additive and may safely remain.
Restore `/opt/fleetbase/backups/a28-console-20260728T0315Z` to remove the extension dependency,
runtime activation and Console cache/version wiring. The full database dump is retained for
disaster recovery; routine rollback does not require restoring it.
