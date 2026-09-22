# 06 — A64: driver roster reconciled against the owner's SUBSCRIPTION DRIVER sheet (pre go-live)

**Date:** 2026-09-22 (Kuwait evening). **Owner directive:** "ده تحدثت ارقام تليفونات السواقين … يرجي تحديث لان بكره راح اطلع live".
**Input:** `SUBSCRIPTION DRIVER (1).xlsx` (one sheet, 9 rows: Emp. ID, name, car no., contact no., car model). Not committed (contains phone numbers).
**Scope:** config/data only in Fleetbase (the driver-app backend). No code, no console, no Partner writes.

## Result — Verified

| # | Sheet name | Fleetbase driver | Phone (sheet) | Phone (before) | Plate (sheet) | Plate (before) | Action |
|---|---|---|---|---|---|---|---|
| 1 | NASEER AHMED | driver_z31exReMHy | 55838056 | same | 21-79114 | same | none |
| 2 | SHAIK FEROZ | driver_fpQEqYBGVG | 55088972 | same | 21/79959 | 21-79959 | none |
| 3 | AMANDEEP | driver_eVMKykp6nG | 57550236 | same | 21/56792 | 21-56792 | none |
| 4 | VINEESH THANDUTHIYIL | driver_aCmTB03tMY | 55126995 | same | 21/79872 | 21-79872 | none |
| 5 | ARSAD ALI | driver_mW76oeHnja | 56617830 | same | 24-40452 | same | none |
| 6 | IBRAHIM KHALEELULLA | driver_l58j0Bwpyo | 57550243 | same | **21/21412** | **23-21231** | vehicle_lNYcckxiRc plate → `21-21412` |
| 7 | SALATO DIN MIYA | driver_ks697fB5LP | 60363234 | same | 24-40125 | same | none |
| 8 | NICHOLAS MOMANYI | driver_1OyMcZZ71a | 57550235 | same | 21-79349 | same | none |
| 9 | RAVI BHARDWAJ | driver_ioPJGOyvvu | **50133727** | **65820384** | 24-40149 | same | user_pQRwTjFkI5 phone → `+96550133727` |

- Post-change re-diff: **9/9 match** on phone (+965 prefix) and plate (dash normalised, matching the 8 existing plates).
- Fleetbase stores the driver phone on `users.phone` only (`drivers` has no phone column); the new number collided with no other user or contact.
- Driver login = WhatsApp OTP to `users.phone` (A-series, live since 2026-07-18), so Ravi's OTP now goes to 50133727.
- Nutrezee m21 `driver` table holds only the two A27 probe rows; the operational roster lives in Fleetbase, nothing to mirror.

## How
- Backup: `/opt/fleetbase/backups/a64-pre/users_vehicles-20260922T1741Z.sql` (mysqldump users + vehicles).
- Writes via the Fleetbase REST API (Bearer key from `integration.env`, never printed):
  `PUT /v1/drivers/driver_ioPJGOyvvu {"phone":"+96550133727"}` and `PUT /v1/vehicles/vehicle_lNYcckxiRc {"plate_number":"21-21412"}`.
- DB verify: `users.updated_at 2026-09-22 17:41:17Z`, `vehicles.updated_at 17:41:18Z`. No container restart needed.
- Rollback: restore the two rows from the backup, or PUT the previous values back.

## Left for the owner [NC]
- Ibrahim's sheet plate `21/21412` differs from the previous record `23-21231` in more than format; I took the sheet as authoritative. Confirm with the fleet office if the car actually changed.
- Car model (`Toyota Liteace-2023` / `CMC 2026`) is not stored in Fleetbase vehicles today (make/model/year all null); not added, out of the directive.
