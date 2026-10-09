# 33 — WP-OPS-A82: orders waiting for a driver print without one

**Date:** 2026-10-08 · **API:** `nutrezee-api:a82-3a00b47` (rollback `pre-a82-20261008`) · check script backups `*.bak-a82`

## Trigger

Owner: the "day before" orders must print normally without a driver — the drivers' manager places them himself. This replaces the earlier rule (A70.12) that an order without a driver in legacy has no label.

State on Saturday 2026-10-10 at 18:20 Kuwait: 774 orders on the legacy screen, 187 without a driver → 587 labels.

## Findings (Verified)

1. `isHeldOrCancelled` dropped every Fleetbase order with a `hold_reason`, including `no_partner_driver`.
2. Lifting that alone changed nothing (still 587): the sync keeps a held order **unscheduled** (`scheduled_at` null) on purpose — Fleetbase's own minute scheduler dispatches due created orders — and the page reads the day with `scheduled_at=<day>`.

## Change

- The sync is not touched; held orders stay unscheduled and undispatched (no driver app sees them).
- API: `orders()` adds the day's `status=created`, `hold_reason=no_partner_driver`, unscheduled orders from a status read (about 200 created orders company-wide; a failure of this read never blocks the scheduled labels). `isHeldOrCancelled` lets only that hold through; `unmapped_partner_driver`, pin holds and cancels stay out.
- Such a label has no driver: it is under Area, Delivery time and Orders, not under a driver, and prints with an empty driver box. When legacy gets the driver, the next sync dispatches it and it moves under that driver.
- Night check: counts them the same way; subject `… Batch Labels N = legacy screen N (K without a driver yet)`.

## Verification

- Unit `ts-u-fleetbase-label-identity` 20/20 (2 new: hold filter; status read incl. its failure path), all TS-U green.
- Server, Saturday 2026-10-10, check run 18:26–18:29 Kuwait without email: **Batch Labels 773 = legacy screen 773 (187 without a driver yet) + WhatsApp 33**, difference 0 (one order left the legacy screen between the two runs and was removed by the repair round).

## Not verified

- The status read through the real Fleetbase HTTP API with an operator's session: no operator token is available to the assistant. The night check reads the same rows from the Fleetbase database. To be confirmed by opening Batch Labels for Saturday (summary should show 806 = 773 + 33).
- Not yet printed on paper. The driver box of such a label reads "Name unavailable".

## A83 — WhatsApp subscribers as their own group (same day)

Owner: "separate the WhatsApp orders from them". Driver, area and delivery-time batches now contain legacy orders only (their option lists and counts too); "Filter by" has a **WhatsApp subscribers** group (all of the day's, sorted by driver then area) and the summary shows their count on its own tile. API `filter_type: "source"`, console extension 0.3.23 (`fleetbase-console:a83-1`, API `nutrezee-api:a83-aa4ff49`, rollback tags `pre-a83-20261008`).

Checked: unit `ts-u-batch-label-filters` 14/14 (3 new), integration 27/27; release gate 13/13; candidate booted in a real browser before the swap; after the swap the Saturday check still reads `Batch Labels 773 = legacy screen 773 (187 without a driver yet) + WhatsApp 33`. The page itself has not been opened with an operator account by the assistant.

## A84 — evening follow-ups (2026-10-09)

Owner's video at 00:11 Kuwait on Friday: Batch Labels showed driver Salato Din Miya with 36 labels for Saturday 2026-10-10 while the legacy screen showed 48.

Cause (Verified): no check or sync for Saturday ran between 18:29 (a manual run) and 00:25–00:45 Kuwait. The hourly evening sync targets "tomorrow", which on Thursday evening is Friday (no deliveries); drivers were being assigned in legacy during that time. At 00:45 the check read 773 = 773, difference 0, all with a driver; by 02:32 that driver had 71 orders on the legacy screen and 71 labels.

Change: the follow-up runs every 15 minutes from 18:00 to 02:45 Kuwait (was 01:00–02:30) and prepares the next delivery day (Saturday when tomorrow is Friday). It never emails before the 00:45 email of that day. Installed by the assistant; the previous script is `print-status.py.bak-a84`.

Limit that remains: the page can be up to about 15 minutes behind legacy, and before 18:00 it is as old as the last sync.
