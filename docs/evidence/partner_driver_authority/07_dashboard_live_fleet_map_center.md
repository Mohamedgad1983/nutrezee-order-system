# 07 — Fleet-Ops Default Dashboard "Live Fleet Map" centred on California (data fix)

Date: 2026-09-04 (Kuwait) · Environment: staging Fleetbase 0.7.48 (`ops.nutreeze.com`) · Owner request: "اظبطها تكون live وصحيحة زي ما بيقول الكتاب"

## Symptom
The Default Dashboard's **Live Fleet Map** widget (`@fleetbase/fleetops-engine` `widget/live-fleet`) opened on the USA
instead of Kuwait.

## Root cause — Verified
- The widget centres on the **first driver returned** by `GET /int/v1/fleet-ops/analytics/live-fleet`
  (`Support/Analytics/LiveFleet.php`): drivers with a non-null location that are **online OR have `current_job_uuid`**.
- `driver_vlN0wrDmSn` ("Demo Driver - Salmiya", dummy, no vehicle) still carried `current_job_uuid =
  796e0598-…` → order `order_l58zMwmpyo`, status `started`, **soft-deleted on 2026-07-12**. Its stored location is
  `POINT(-122.084 37.4219983)` — the Android-emulator default GPS (Mountain View, CA) from app testing.
- So the only "active" marker sat in California and the map centred there.
- Tile layer is CARTO `basemaps.cartocdn.com` (no API key involved). Tiles fetched from the VPS with the console's
  Referer are clean map tiles; no "API KEY REQUIRED" string exists anywhere in the built console bundle.
  → the watermark the owner saw could not be reproduced server-side [NC — owner to re-check after the fix].

## Fix applied (Fleetbase MySQL, staging)
Backup first: `/opt/fleetbase/backups/drivers-rows-20260904-152422.sql` (mysqldump of `drivers` rows).

```sql
UPDATE drivers SET current_job_uuid = NULL
 WHERE public_id = 'driver_vlN0wrDmSn'
   AND current_job_uuid = '796e0598-6d1a-4af0-994c-d7b3520c5be0';   -- 1 row
```

Also ran `redis-cli FLUSHDB` on the Fleetbase `cache` container (Laravel cache + queue share it; `SESSION_DRIVER=file`).
Keyspace was empty afterwards and the queue worker shows no pending/lost jobs (last job 01:00 UTC, DONE) — but this was
a broader action than needed; note for the record.

## Result — Verified via the same SQL predicate LiveFleet uses
Remaining live markers: `Salato Din Miya` (48.0509, 29.2020) and `Arsad Ali` (48.0244, 29.3053) — both Kuwait, both
online. The widget now centres on Kuwait.

## Left as-is (owner decisions)
- 10 non-deleted drivers still store garbage positions (Mountain View ×5, `0 0` ×6 incl. real drivers). They are hidden
  from the Live Fleet map while offline and will be overwritten by the Navigator app on next GPS report. `drivers.location`
  is NOT NULL, so they cannot be blanked without inventing a point.
- The 3 dummy drivers (`driver_vlN0wrDmSn`, `driver_fpQEqYNGVG` "Unit-01", `driver_tSx1jTOyTV` "Ahmed Al-Salem") remain;
  deletion is the owner's call (they have no vehicle, so they never enter the label colour pool).

## Follow-up 2026-09-04 13:31 UTC — owner ordered the 3 dummy drivers deleted
Pre-checks (Verified): none of the three is referenced in `nutreeze-partner-driver-map.json` or the roster; none had an
order for 2026-09-04/05 or any non-completed order. They did carry **historic completed** orders from the pre-A46
fallback era (Unit-01: 489, Ahmed Al-Salem: 2,411, 2026-07-19 → 2026-09-03); those rows keep their
`driver_assigned_uuid` and now resolve to a soft-deleted driver in the console.

```sql
UPDATE drivers SET deleted_at = NOW()
 WHERE deleted_at IS NULL
   AND public_id IN ('driver_vlN0wrDmSn','driver_fpQEqYNGVG','driver_tSx1jTOyTV')
   AND NOT EXISTS (<order for 20260904/20260905 or status not completed/cancelled>);   -- 3 rows
```
Soft delete only (Fleetbase `SoftDeletes`), reversible with `deleted_at = NULL`; backup
`backups/drivers-rows-20260904-152422.sql` predates both changes. `GET /v1/drivers?limit=-1` now returns the 9 real
plated drivers, so the label colour pool (A49) is unchanged in membership and order.

## Follow-up 2026-09-04 — dashboard currency "$" → Kuwaiti dinar (owner order)
Root cause (Verified): every money widget/metric resolves `company->currency ?? 'USD'`
(`Support/Metrics/MoneyMetric.php`, `Analytics/AbstractAnalytics.php`); the Nutreeze company row had
`currency`, `country` and `timezone` all NULL, so the console fell back to USD and "$".

Fix = the Organization settings Fleetbase expects, written to the company row (backup
`backups/companies-rows-20260904-153637.sql`):

```sql
UPDATE companies SET currency='KWD', country='KW', timezone=COALESCE(timezone,'Asia/Kuwait')
 WHERE public_id='company_oPu7DV8lU5' AND currency IS NULL;   -- 1 row
```
Company cache keys cleared in Redis. Console renders KWD with Fleetbase's built-in definition: symbol **K.D.**,
3 decimals, symbol before the amount.

Side effect (Inferred): revenue/AOV metrics filter transactions by the company currency; the only 16 existing
transactions are USD test rows, so money tiles now read 0 K.D. until real KWD transactions exist. Partner orders carry
no transactions today.
