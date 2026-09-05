# 08 — A57: standing call-customer dispatch for Partner orders without a real pin

Date: 2026-09-05 (Kuwait) · Owner decision: "execute 1 and 2, this best solution" (print labels for held orders with a Partner driver + stop holding them, dispatch on an approximate pin flagged "call customer")
PR [#75](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/75) · CI 29/29 · merged `2653ce1` · installed on staging 2026-09-05 12:18 UTC

## What was happening (Verified)
The importer held every Partner order whose customer has no real map pin: `dispatch_state = held_no_real_location_pin`,
status `created`, no driver, no `scheduled_at`. Daily counts: 09-01 189, 09-02 191, 09-03 191, 09-05 169, 09-06 207 — on top
of ~600 dispatched. Held orders never reached the driver app nor the Batch Labels page (which reads
`scheduled_at = day`), even when Partner had already assigned a driver (127 of Saturday's 169).

The "address call" mechanism (A19, 2026-07-20) already existed — dispatch on the area centroid, place named
"CALL CUSTOMER FIRST", `call_customer_required = true` — but it was locked to a single authorized date and to a
manual per-run confirmation that the unattended timers deliberately never supplied.

## Change (`ops/fleetbase/nutreeze-orders.php`, `nutreeze-daily-sync.sh`, `test-daily-sync.sh`)
- `ADDRESS_CALL_STANDING_FROM = '2026-09-05'`, authorization label `A57`: any delivery date from then on is authorized;
  the per-date confirmation (`--confirm-address-call-dispatch=<date>`) stays mandatory and must equal the delivery date.
- `rowRequiresCustomerCall`: fallback scope `country` (areas missing from `AREA_FALLBACK_CENTROIDS`) is accepted and
  flagged `fallback_scope = 'country'`; the run no longer aborts with `daily_address_call_unknown_area` — it logs the
  areas so the map can be extended. A customer phone is still required (nobody can be called otherwise); the written
  address is no longer required (it is printed on the label regardless).
- Every full sync from the timers (rolling 00:45, same-day 01:45, evening hourly 20:00–02:45) passes the confirmation.
  Daytime cancel-only runs never do; the importer's `daily_cancel_only_no_address_call` guard is unchanged.
- Self-test 43/43 (new cases: standing dates authorized, 2026-09-04 not, confirmation mismatch rejected, country scope
  call-dispatched, missing address ok, missing phone held). `test-daily-sync.sh` 33/33 with three new assertions.

## Projection before applying (dry-run with the new policy)
| date | source | dispatchable | real pin | call-customer | unmapped-area (country) | still held |
|---|---|---|---|---|---|---|
| 2026-09-05 | 683 | 681 | 510 | 171 | 8 | 2 (1 no driver, 1 unapproved meal) |
| 2026-09-06 | 835 | 834 | 625 | 209 | 13 | 1 (no driver) |
Unmapped areas logged: abraq khaitan, al ahmadi, ali sabah al salem, faiha, mubarak al abdullah - west mishrif, naeem,
nahda, rehab, sharq, sulaibiya → candidates for `AREA_FALLBACK_CENTROIDS`.

## Install + first apply (staging, owner-authorized)
- Backups: `/opt/fleetbase/backups/a57-20260905-1216/{nutreeze-orders.php,daily-sync.sh}`; full Fleetbase MySQL dump
  `backups/fleetbase-pre-a57-20260905-121824.sql.gz` (33 MB).
- Installed `nutreeze-orders.php` (md5 `af624321b83d…`, identical host/container) and `daily-sync.sh` (0700 root);
  self-test 43/43 from the installed path; healthcheck ok.
- Applied **2026-09-06** (Sunday) manually with the same arguments the evening timer will use:
  `complete: source 835, assigned 834, held 1, verified true`. Fleetbase now: 625 `dispatched`, 209
  `dispatched_call_customer_required` (driver + scheduled_at set), 6 cancelled tombstones, 1 held (no Partner driver).
- Batch Labels gateway probe for 2026-09-06: **834 orders, 209 call-customer, 0 with hold_reason, 7.6 s** — every
  order with a Partner driver is now printable per driver (owner option 1 satisfied by option 2).

## Not applied: 2026-09-05 (today) [owner call]
Today's run is mid-delivery; the A50 daytime rule allows cancellations only. Applying the new policy to today would push
171 additional orders to drivers at ~15:00 Kuwait. Left untouched pending an explicit owner instruction; the projection
above shows what it would do.
