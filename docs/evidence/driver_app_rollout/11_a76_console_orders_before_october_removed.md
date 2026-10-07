# A76 — Fleetbase console: orders before 1 October 2026 removed

Date: 2026-10-07 (Kuwait) · Owner: "امسح الطلبات القديمة، أنا محتاج فقط من 01/10 علشان الداتا تكون خفيفة" → shown the
numbers and the consequences → "اه نفّذ المسح وخليها ثابتة من 1 أكتوبر".

## Scope
Fleetbase console database only (`ops.nutreeze.com`). Not touched: the legacy admin, ERPNext, the label database
(print history, barcodes), drivers, vehicles, WhatsApp-subscriber orders, any order dated 2026-10-01 or later.
Fixed cut-off, no recurring job (owner's choice).

## Before
| Month | Orders |
|---|---|
| Jul 2026 | 1,900 |
| Aug 2026 | 12,522 |
| Sep 2026 | 18,913 |
| from 1 Oct 2026 | 6,367 |
plus 70 WhatsApp-subscriber orders and 83 demo/test/July-probe orders.

## How
1. Full dump first: `/opt/fleetbase/backups/pre-a76-prune-20261007-093305.sql.gz` (70 MB, 125 tables, gzip verified,
   "Dump completed"). An old order can be restored from it.
2. `ops/fleetbase/maintenance/prune-orders-before.py apply` — one delivery day per transaction, selected by the Partner
   day prefix (`NUTREEZE-PARTNER-DAY-YYYYMMDD`, day < 20261001): the day's orders, their payloads, tracking numbers and
   statuses, the day's own places and customer contacts; `drivers.current_job_uuid` / `positions.order_uuid` are set to
   NULL where they pointed at a removed order. A foreign-key error rolls back that day only.
3. `prune-test-orders.sql` — the 83 demo/test orders.
4. `OPTIMIZE TABLE` on the six tables, response cache cleared.

One day (2026-09-07) was refused and rolled back on the first pass: three test orders' payloads still pointed at its
places. After step 3 it went through.

## After
| | before | after |
|---|---|---|
| orders | 39,853 | 6,437 (6,367 from 1 Oct + 70 WhatsApp) |
| payloads / places / contacts | 39,857 / 39,912 / 39,626 | 6,441 / 6,538 / 6,440 |
| tracking numbers / statuses | 39,872 / 118,484 | 6,456 / 19,226 |
| six tables on disk | 669 MB | 103 MB |
| drivers / vehicles | 18 / 9 | 18 / 9 |

Integrity of what was kept: orders without a payload row 0, without a tracking row 0, without a customer contact 0;
payloads without a dropoff place 0; oldest remaining Partner day 2026-10-01.
Checks after: night check `[OK] Labels 2026-10-08: Batch Labels 910 = legacy screen 910 + WhatsApp 32`; WhatsApp
sync run `success`; Partner sync dry-run for 2026-10-08 reads 927 deliveries without error; console and API 200.

Left in place on purpose: a few orphan rows (4 payloads, 19 tracking numbers, about 100 demo/July places and contacts).
