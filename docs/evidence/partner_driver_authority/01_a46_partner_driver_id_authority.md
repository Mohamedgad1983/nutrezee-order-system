# 01 — A46: Partner `driver.id` becomes the Fleetbase assignment authority

Date: 2026-09-03 · Branch: `build/wp-ops-05-partner-driver-authority` · Status: PR #56 open (base `fix/a45-console-performance`); **installed on staging VPS 2026-09-03 10:15Z, dry-run only, no apply yet**

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

1. Install `ops/fleetbase/nutreeze-partner-driver-map.2026-09-03.json` as
   `config/nutreeze-partner-driver-map.json` (root-owned, mode `0600`).
2. Replace `config/nutreeze-driver-roster.json` with `nutreeze-driver-roster.2026-09-03.json`
   (the same 9 public ids; the two workbook example rows are dropped).
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

## Partner driver identities (read from nutreeze.com admin screen, 2026-09-03)

Mohamed opened `Users → Drivers` and each driver's edit page in his own signed-in Chrome; the
assistant only read the screen. Partner exposes two identifiers per driver: the numeric user id in
the edit URL (`users/addUser/2/<id>`) and the `Unique user id` field (`A1`…`A9`), which equals the
phone-unit number. Both are installed as aliases in `nutreeze-partner-driver-map.2026-09-03.json`.

| Unique ID | Numeric id | Partner username | Unit | Fleetbase |
|---|---|---|---|---|
| A1 | 122 | Salato Din | Area-1 | `driver_ks697fB5LP` |
| A2 | 123 | Vineesh | Area-2 | `driver_aCmTB03tMY` |
| A3 | 124 | AMAN (Amandeep Nit Pal) | Area-3 | `driver_eVMKykp6nG` |
| A4 | 125 | Nicholas Momanyi | Area-4 | `driver_1OyMcZZ71a` |
| A5 | 126 | Naseer ahmad | Area-5 | `driver_z31exReMHy` |
| A6 | 9286 | IBRAHIM Khaleelulla | Area-6 | `driver_l58j0Bwpyo` |
| A7 | 17214 | Arsad Ali | Area-7 | `driver_mW76oeHnja` |
| A8 | 17770 | fairoz (Shaik Feroz) | Area-8 | `driver_fpQEqYBGVG` |
| A9 | 19033 | RAVI Bhardwaj Gurdeep | Area-9 | `driver_ioPJGOyvvu` |

Excluded: `142` عبدالعزيز, `8416` Mustafa S, `8301` driver last (inactive), and **RAMZI AL QADRI**,
who also carries Unique ID `A6` (duplicate of IBRAHIM). Any order Partner sends with an excluded
driver is held as `unmapped_partner_driver` and listed in the dry-run summary — nothing is guessed.
[NC] Which of the two `A6` accounts Partner actually uses for Area-6; Ramzi's numeric id was not
read. Each driver's Partner *Service Area* list was recorded in the session notes and matches the
per-driver Driver Orders export (Ravi: Rawda, Kaifan, Dasma, Yarmouk, Khaldiya …), confirming that
Partner areas are driver-owned.

Ravi cross-check (read-only MySQL, Kuwait 2026-09-03): of his 73 Partner orders, 47 exist in
Fleetbase for the date and only 7 are assigned to him; 40 sit with six other drivers under the
retired hash.

## Verification (2026-09-03)

- `php -l`: no syntax errors.
- `--self-test` executed inside `fleetbase-application-1` from stdin (temporary copy under
  `/tmp`, deleted afterwards; no file under `/opt`, no DB access): **38/38 passed**.
  Two intermediate failures were fixed on the way: PHP int-coercion of numeric-string array
  keys (`"42"` → `42`) in the map/unmapped list, and `validateRow` pre-setting a null driver
  that the `$base + [...]` merge kept over the parsed id.
- Live importer untouched (md5 `9f0e3c06c0bdd0b9f3ed5dd3cf7707b5` before and after).

## Staging install + dry-run (2026-09-03, owner-directed)

Backups: `/opt/fleetbase/backups/a46-20260903T0814Z/` (importer, run.sh, 11-entry roster) plus
`nutreeze-orders.php.rollback-a46-20260903T0814Z` beside the live file. Live `run.sh` matched the
repo's previous version byte-for-byte before overwrite.

Installed (root, 0600/0700): importer `d1799f4a…`, `run.sh`, `config/nutreeze-partner-driver-map.json`
(18 aliases → 9 drivers), `config/nutreeze-driver-roster.json` (9 public ids). Container `php -l`
clean, `--self-test` 38/38. Timers untouched (next run 00:00 Kuwait targets +1/+2 days).

Dry-run results (`run.sh --delivery-date=… --limit=1000 --dry-run`, `fleetbase_written:false`):

| date | Partner orders | dispatchable | held: no Partner driver | unmapped ids | held: missing/invalid pin |
|---|---|---|---|---|---|
| 2026-09-03 (today) | 777 | 585 | 1 | none | 189 / 2 |
| 2026-09-04 (Fri) | 0 | – | – | – | – |
| 2026-09-05 (Sat) | 694 | 363 | **226** | none | 102 / 2 |

Per-driver loads today (Partner authority): Nicholas 83, Amandeep 75, Salato 68, Arsad 67,
Ibrahim 66, Vineesh 65, Shaik Feroz 59, Naseer 55, Ravi 47. Ravi's 47 equals the 47 of his
Partner export that exist in Fleetbase, confirming the mapping end to end. All nine mapped ids
were seen in the feed; `partner_driver_ids_unmapped = []`.

Observation: for Saturday, Partner has not yet assigned a driver on 226 orders. Under A46 those
stay held until Partner assigns one; the nightly run picks them up the following night. Under the
old hash they were already dispatched to invented drivers, so the first A46 apply for 2026-09-05
will demote them to held/unassigned. Operations should assign Saturday drivers in Partner before
the 00:00 run, or accept that those orders appear in Navigator only after the next sync.
