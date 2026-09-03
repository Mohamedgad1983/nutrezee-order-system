# 02 — Go-live readiness: Saturday 2026-09-05 (drivers collect ~03:00 Kuwait)

Assessed 2026-09-03 ~11:00Z, read-only checks on staging VPS + Fleetbase + Nutrezee Postgres.
Labels: **Verified / Inferred / Needs Confirmation [NC]**.

## Verdict

| Chain | Status | Notes |
|---|---|---|
| Partner → Fleetbase dispatch (A46) | **READY** (Verified) | 363 Saturday orders dispatched to the 9 Partner-mapped units, verification passed, 0 unmapped ids, Ramzi alias added |
| Nightly timers | **READY** (Verified) | 00:00 snapshot, 01:00 rolling (+1/+2), **02:00 same-day** (today/+1) enabled; next same-day run Fri 02:01 Kuwait |
| Driver accounts / Navigator | **READY** (Verified, [NC] on phones) | 9 real units: `available`, password set, vehicle plate linked; Arsad and Salato seen online this week. Fake "Unit-01", "Ahmed Al-Salem", "Demo Driver" still exist but receive no orders |
| Endpoints | **READY** (Verified) | ops.nutreeze.com, /nz/health, fleetapi, staging API all 200 |
| Partner assignments for Saturday | **OPEN** (Verified) | 226 of 694 orders have no driver in Partner yet → held until assigned; must be assigned **before 02:00 Sat** |
| Orders without location pin | **KNOWN GAP** (Verified) | 104 Saturday orders held for missing/invalid pin → not in Navigator; same as before A46 |
| Fleet-Ops label batch with NZC barcode | **NOT READY** (Verified) | Needs the order in Nutrezee Postgres (`customer_order` + `fulfillment_day`). Local data stops at order **24675 / 2026-07-27**; 0 of 10 sampled Saturday orders exist locally; only 5 `fulfillment_day` rows for 2026-09-05 (probe data). Batch is also **today-only** (server Kuwait date) |
| Driver barcode collection scan | **NOT READY** (Verified) | Same dependency (scan step 2 = local `fulfillment_day`); only 1 active barcode exists; box_collection has only the July-27 probe |

## What this means for Saturday

1. **Dispatch + navigation in the driver app works as of now** and will refresh at 01:00 and
   02:00. Drivers open Navigator, see their Partner-assigned stops with vehicle/phone identity.
2. **Barcode scanning at 03:00 cannot work on Saturday** unless the Nutrezee Postgres receives
   the current orders. The legacy refresh pipeline ([A] owner-run extract, hours; [C] guarded
   apply) is the only existing path; the Partner daily-deliveries API is not yet imported into
   `customer_order`/`fulfillment_day` (that would be a new, governed M19-style feed — a WP, not a
   same-day change).
3. Labels for Saturday therefore come from Partner's own "Print Delivery Sticker" as today. The
   NZC barcode label from Fleet-Ops is deferred until the data feed exists.

## Owner actions before Saturday (in order)

| # | When (Kuwait) | Action | Owner |
|---|---|---|---|
| 1 | Fri, before 02:00 Sat | Assign drivers in Partner for the 226 unassigned Saturday orders | Operations |
| 2 | Fri | Decide: scanning on Saturday = **no** (recommended) or run legacy refresh + apply first | Mohamed |
| 3 | Fri | Confirm each of the 9 units has the Navigator build (1.0.6) and can sign in (WhatsApp OTP) | Operations |
| 4 | Fri (optional) | Deactivate the 3 non-real Fleetbase drivers in Fleet-Ops (Unit-01, Ahmed Al-Salem, Demo) so operators never pick them | Mohamed |
| 5 | Sat 02:05 | Check the same-day run: `journalctl -u nutreeze-partner-sameday.service -n 40` → `horizon_complete … days_failed:0` | On-call |
| 6 | Sat 02:10 | Spot-check one driver's stop count in Fleet-Ops against Partner Driver Orders | On-call |

## Next WP (to make scanning possible): Partner-API → Nutrezee order feed

Import the daily-deliveries rows (order_number, customer ref/phone, area, date, meals) into
`customer_order` + `fulfillment_day` through M19 (dry-run → apply, idempotent by order_number +
date), keyed by normalized +965 phone. Then Fleet-Ops batch labels and the collection scan have
current data. Estimated: one work package with tests; not before Saturday.
