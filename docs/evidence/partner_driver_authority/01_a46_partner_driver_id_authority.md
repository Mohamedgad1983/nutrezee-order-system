# 01 — A46: Partner `driver.id` becomes the Fleetbase assignment authority

Date: 2026-09-03 · Branch: `build/wp-ops-05-partner-driver-authority` · Status: BUILT, NOT DEPLOYED

## Problem (Verified, read-only VPS trace 2026-09-03)

- The live importer `/opt/fleetbase/api/storage/app/integrations/nutreeze-orders.php`
  (md5 `9f0e3c06…`, identical to `ops/fleetbase/nutreeze-orders.php` on `main`) type-checked
  Partner's `driver.id` / `driver.name` and then **discarded them**. Nothing in Fleetbase
  `orders.meta` or `payloads.meta` recorded the Partner driver.
- `driver_assigned_uuid` was computed by **routing-area rendezvous hashing** over the 11-entry
  roster: `sha256(area + "\0" + driver.public_id)`, highest score wins, whole area to one driver.
- Partner's model is the opposite: each Partner driver owns areas; the order arrives already
  carrying its driver. Mohamed confirmed this on 2026-09-03 ("the areas come with the Partner
  API through driver id … Fleetbase choosing is wrong").
- Navigator's collection scan (`m25-label/collection.service.ts`) rejects `wrong_driver` whenever
  the scanned order is not in the signed-in driver's **Fleetbase** assigned list, so every hash
  disagreement with Partner surfaces as a driver-facing rejection.
- Kuwait 2026-09-03 MySQL (read-only): 589 dispatched orders, all `assignment_mode =
  routing_area_rendezvous_v1`. Two roster entries are the **example rows of the driver workbook**
  ("Unit-01 (or Driver-Salmiya)" +96550001234, "Ahmed Al-Salem" +96560005678) and received
  19 + 114 = 133 orders that no real driver can collect.
- Collection audit: only the 2026-07-27 probe scans exist (1 accepted, 2 duplicate,
  1 unknown_barcode, 1 wrong_driver). Zero scans on 2026-09-03.

## Change

`ops/fleetbase/nutreeze-orders.php` (daily mapping v3 → **v4**):

| Area | Before | After |
|---|---|---|
| Source contract | `driver.id` type-checked, dropped | `normalizePartnerDriverId()` → `partner_driver_id` (string) + `partner_driver_name` on every row; id joins `_identity_hash` and `_source_hash` |
| Config | `nutreeze-driver-roster.json` (hard-coded 11) | roster count ≥ 1 **plus** new protected `nutreeze-partner-driver-map.json` (`--partner-driver-map=`); map and roster must name the same Fleetbase drivers |
| Hold reasons | status → pin | status → **`no_partner_driver` / `unmapped_partner_driver`** → pin. Driver holds precede pin holds so a driverless row can never be call-dispatched |
| `allocateDailyDrivers()` | rendezvous hash by area | mirrors `partner_driver_uuid`; any routable row without a mapped driver aborts (`daily_allocation_driver`); routing area is not consulted |
| Order meta | `assignment_mode = routing_area_rendezvous_v1` | `partner_driver_id_v1` (+ `_call_required_v1`), `partner_driver_id`, `partner_driver_name`, `partner_driver_public_id`; verify pass checks the id and public id |
| Stats / dry-run summary | — | `orders_held_no_partner_driver`, `orders_held_unmapped_partner_driver`, `partner_driver_map_count`, `partner_driver_ids_unmapped` (ids only), `partner_driver_loads` per Fleetbase public id |
| run.sh | roster + pickup | + `--partner-driver-map=…/config/nutreeze-partner-driver-map.json` |

Self-tests added: id normalization and rejection, driverless/unmapped holds (not routable even
with address-call authorization), same-area orders to different drivers, foreign uuid and
duplicate-order rejection, map shape validation, delivery-row driver parsing, digest changes
on driver change but not on name change, group conflict when duplicate delivery rows disagree
on driver.

## Not changed

- Navigator, collection scan, labels, Fleetbase application/vendor source, systemd units.
- No Fleetbase, Partner, legacy or Nutrezee DB write. Nothing deployed.

## Before go-live (owner)

1. Fill `nutreeze-partner-driver-map.json` with the 9 real Partner `driver.id` values
   (template: `ops/fleetbase/nutreeze-partner-driver-map.example.json`); install it root-owned
   mode `0600` in the protected config directory.
2. Reduce `nutreeze-driver-roster.json` to the same 9 public ids (`expected_count: 9`), removing
   the two workbook example rows.
3. Deploy the importer + run.sh, then `run.sh --delivery-date=<tomorrow> --limit=1000 --dry-run`
   and check `partner_driver_ids_unmapped = []`, `orders_held_no_partner_driver`, and
   `partner_driver_loads` against Partner before any apply.
4. Deploy timing: every existing order's `daily_source_hash` changes (the id now joins the
   hash) and the mapping version moves to 4. The rolling timer targets only +1/+2 days, whose
   jobs are unstarted, so the first run reconciles them; do **not** run it manually against a
   date with started jobs or it aborts with `daily_started_snapshot_changed`.
5. Vehicle plates: Mohamed confirmed on 2026-09-03 that the color/vehicle workbook
   (`Nutrezee_Driver.xlsx`, the source of the current Fleetbase plates) is correct; the older
   phone-units workbook is stale. No plate correction needed.

## Verification (2026-09-03)

- `php -l`: no syntax errors.
- `--self-test` executed inside `fleetbase-application-1` from stdin (temporary copy under
  `/tmp`, deleted afterwards; no file under `/opt`, no DB access): **38/38 passed**.
  Two intermediate failures were fixed on the way: PHP int-coercion of numeric-string array
  keys (`"42"` → `42`) in the map/unmapped list, and `validateRow` pre-setting a null driver
  that the `$base + [...]` merge kept over the parsed id.
- Live importer untouched (md5 `9f0e3c06c0bdd0b9f3ed5dd3cf7707b5` before and after).
