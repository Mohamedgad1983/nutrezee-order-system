# 29 — Packing ↔ Driver Integration Flow

> **Status:** ✅ BUILT + tested (the handoff path is covered by `ts-i-delivery` and `ts-i-packing`).
> Connects `m20-packing` (doc 26) and `m21-delivery` (doc 28) into one operational pipeline.

---

## 1. End-to-end flow

```
[1] Orders imported / synced            (M19 import; incremental sync dry-run, doc 25)
        │   customer_order rows exist, with frozen delivery method/time/area (docs 14/17/18)
        ▼
[2] Delivery method/time/area stored    (per-order frozen snapshot)
        ▼
[3] Packing batch created               POST /packing/batches {delivery_date, delivery_time?, area?}
        │   auto-includes matching active orders → packing_batch_order (pending)
        ▼
[4] Orders packed                       POST /packing/batches/:id/orders/:orderId/mark-packed
        │   pending → packed ; batch draft → in_progress
        │   (issues: → missing_item / issue, must be re-packed before handoff)
        ▼
[5] Batch handed off                    POST /packing/batches/:id/handoff
        │   GUARD: every order packed → orders + batch → handed_to_driver
        ▼
[6] Order appears UNASSIGNED            GET /delivery/unassigned?date=&area=
        │   surfaces packing_status='handed_to_driver' (not yet on an active route)
        ▼
[7] Driver assigned by area/time/cap    POST /delivery/assign | /delivery/bulk-assign
        │   capacity guard + no-duplicate-active-assignment guard
        ▼
[8] Route created/extended              delivery_route (assigned) + delivery_route_order stop (assigned)
        ▼
[9] Delivery status tracked             POST /delivery/routes/:id/status         (route lifecycle)
                                        POST /delivery/routes/:id/stops/:orderId/status  (per stop)
```

The seam is steps **[5]→[6]**: packing marks orders `handed_to_driver`; the delivery *unassigned*
query reads that status (across the packing module, read-only) so ops can prefer handed-off orders.
The two modules stay **write-isolated** (each writes only its own tables); they meet at a read.

---

## 2. Status transitions (the two state machines)

```
packing_batch:        draft → in_progress → packed* → handed_to_driver        (cancelled from draft/in_progress)
packing_batch_order:  pending → packed → handed_to_driver
                      pending → missing_item|issue → packed
delivery_route:       draft → assigned → out_for_delivery → completed | failed
delivery_route_order: assigned → picked_up → delivered
                      assigned|picked_up → failed → returned → assigned
```
*`packed` at the batch level is implicit — represented by all orders packed; handoff is the explicit
batch transition to `handed_to_driver`.

---

## 3. Required guards

| # | Guard | Where | Effect |
|---|---|---|---|
| G1 | one active batch per (date,time,area) | DB partial-unique + service | re-running batch-build is idempotent |
| G2 | no duplicate order in a batch | `UNIQUE(batch_id,order_id)` | include is idempotent |
| G3 | order not in two active batches | service `NOT EXISTS` on include | an order packs in one place |
| G4 | handoff requires all orders packed | service (`packing.handoff`) | no half-packed batch reaches a driver |
| G5 | no duplicate active assignment | DB partial-unique `delivery_route_order_active_uq` | an order is in-flight on one route only |
| G6 | driver capacity per slot | service (`assertCapacity`) | a driver is not overloaded for a date |
| G7 | driver active | service (`assertDriver`) | inactive drivers can't be assigned |
| G8 | allowed status transitions only | service transition maps | no illegal state jumps |

---

## 4. Audit events (same-transaction, immutable)

Packing: `packing.batch_created`, `packing.order_packed`, `packing.order_issue`,
`packing.batch_handoff`, `packing.label_printed`.
Delivery: `delivery.driver_created`, `delivery.route_created`, `delivery.order_assigned`,
`delivery.bulk_assigned`, `delivery.route_status_changed`, `delivery.stop_status_changed`,
`delivery.route_reassigned`.

Each is written via `AuditService.writeInTx` in the same transaction as the change, **and** mirrored
in the module's append-only history table (`packing_status_history` / `driver_assignment_history`).
This is the equivalent-of-the-transition-engine immutable trail until A-OPS-01 promotes these machines
into seeded `transition_config`.

---

## 5. Failure cases & handling

| Case | Behavior |
|---|---|
| Handoff with an unpacked / issue order | `conflict: not all orders packed` (G4); ops must pack or resolve first. |
| Assign an order already on a route | `conflict: order already assigned` (G5); bulk-assign counts it `skipped` and continues. |
| Driver at capacity | `conflict: capacity_exceeded` (G6); pick another driver (suggest ranks by remaining capacity). |
| Assign to inactive driver | `conflict: driver inactive` (G7). |
| Illegal status jump (e.g. completed→assigned) | `conflict: transition not allowed` (G8). |
| Stop failed | per-stop `failed` + `failure_reason`; can be `returned` then re-`assigned`. |
| Route failed | `delivery.route_status_changed` severity `warn`; stops left as-is for triage. |
| Duplicate batch for a slot | `conflict` (G1); the existing active batch is reused operationally. |

---

## 6. What this proves

The operational spine **import → delivery-data → packing → handoff → driver → delivery-status** is
real and test-covered end to end, on data we already store, with DB-level + service-level guards and a
complete immutable audit trail — **without** WhatsApp sending, production access, or the per-day meal
model (doc 27).
