# A77 — move an area from one driver to another for one delivery day

Date: 2026-10-07 (Kuwait) · Owner, relaying the drivers' manager: a driver with many orders and another with few —
"عايز ينقل area من سواق الى سواق اخر". Offered: (1) keep doing it in the legacy admin, (2) a "Move Area" page in the
console that overrides the legacy driver for that day. Owner: "2، وبيقرر بالليل قبل الطباعة".

## Rule this amends (A-id for the register)
Since 2026-09-29 the legacy "Orders Driver Wise" screen decides the driver of every order. From A77 an **active row in
`delivery_area_move`** overrides it for that area on that day only; everything else, and every other day, still follows
the legacy screen. In legacy itself the area keeps its old driver, so a label printed from legacy shows the old driver.

## Parts
| Part | What it does |
|---|---|
| `0033_delivery_area_move.sql`, `m25-label/area-move.service.ts` | Decision ledger; one live row per (day, area); a second move replaces the first; cancel keeps history; HIGH audit row in the same transaction. Target must have a phone and a vehicle plate (a label needs both). |
| `GET/POST /fleet-ops/area-moves`, `POST …/:id/cancel` | Operator's Fleetbase bearer. Overview = drivers with orders per area from the day's Batch Labels set, plus each move's progress. |
| `nutreeze-orders.php --area-moves=<file>` | After the Partner digest: every delivery of a moved area gets the manager's driver; the legacy driver is kept in `meta.legacy_partner_driver_id`, the move in `meta.area_move_id`. A bad file or an unmapped target is logged and ignored — the day follows legacy as before. An order legacy left without a driver gets none. Self-test 44/44. |
| `nutreeze-orders-run.sh` | Read-only export of the day's active moves; no rows / no table / any error → the option is not passed. |
| `nutreeze-print-status.py` | Compares the legacy screen with the legacy driver of a moved order; lists moved areas in the email. |
| `area-moves-apply.py` + `nutreeze-area-moves.timer` (every minute) | Re-syncs only a day whose moves changed, with the screen reading already on disk, then the WhatsApp subscribers of that day. |
| Console `Move Area` page | Extension 0.3.20, console `0.7.48-a77.1`; needs `fleet-ops update order`. |

WhatsApp-subscriber orders need no change: they take the driver most Partner orders of their area have that day.

## Verification on staging
- CI 31/31 (PR #103). TS-I `ts-i-area-move` 4/4; extension boundary test; typecheck, lint, both scans.
- **Sync dry-run on tomorrow's real data, test moves file** (nothing written): `area_moves_applied {TESTMOVE1: 38}`,
  unmapped target skipped; Partner digest identical with and without moves and identical to the installed script.
- **Deploy**: `pg_dump` `/opt/nutrezee/backups/pre-a77-20261007-112229.sql.gz`; migration 0033 applied; API
  `nutrezee-api:a77-233c193` (rollback `pre-a77-20261007`), env fingerprint identical, health 200, both new routes 401
  without a token; sync, wrapper and night check installed (previous kept as `*.bak-a76`); real sync for 2026-10-08 with
  no moves: 908 assigned, verified. Console gate 13/13 + real-browser boot test of the candidate before the swap
  (rollback `fleetbase-console:pre-a77-20261007`).
- **Page in the owner's signed-in browser** (read-only clicks): nine drivers with their loads for today and tomorrow;
  choosing a driver lists his areas with counts.
- **End to end, through the module's own service with a test actor (no operator identity used)**, day 2026-10-08:

| Step | Result |
|---|---|
| Before | Fahad Al Ahmed: 15 orders (14 Partner + 1 WhatsApp), all with driver A; loads A 167 … I 64 |
| Move recorded 14:28:46 | applied by the timer at 14:30:30 (1 min 44 s): 14 Partner orders moved by the sync, the WhatsApp order followed; loads A 152, I 79; orders carry the legacy driver and the move id |
| Night check | no "different driver"; email lists `Fahad Al Ahmed (14)` as moved |
| Undo 14:30:52 | applied 14:32:30: all 15 back with A, loads 167 / 64, no order still marked as moved |
| Audit | `delivery.area_moved` and `delivery.area_move_cancelled`, both HIGH |
| Full night check afterwards (fresh legacy reading, no email) | `[OK] Labels 2026-10-08: Batch Labels 908 = legacy screen 908 + WhatsApp 32` |

## Limits [told to the owner]
- A move takes up to about 5 minutes to show (1-minute timer + ~1.5-minute sync); longer if the scheduled sync is running.
- Labels printed before a move keep the old driver; the area must be reprinted.
- A move after a driver has started an order does not take that order (the sync never reassigns a started order).
