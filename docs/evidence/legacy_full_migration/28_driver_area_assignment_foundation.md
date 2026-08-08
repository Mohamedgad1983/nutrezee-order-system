# 28 — Driver + Area Assignment Foundation (m21-delivery)

> **Status:** ✅ BUILT (schema + API + UI + tests). Staging-safe, additive, forward-only.
> **Track:** operational foundation (migration track). Module `m21-delivery`.
> Migration `app/db/migrations/0017_wave6_ops_delivery.sql`.

Picks up where packing hands off (doc 26): assign packed orders to **drivers by area / time /
capacity**, build **delivery routes**, and track **per-stop delivery status**. Preserves
`legacy_driver_id` when available. This is the foundation for the dormant M09-dispatch / M10-drivers
slots and the seeded-but-inactive fulfillment dispatch transitions `f9..f14`.

---

## 1. Schema (migration 0017)

| Table | Purpose | Key columns |
|---|---|---|
| `driver` | a delivery driver | `legacy_driver_id` (preserved, unique when present), `name`, `phone` (PII), `active`, `capacity_per_slot` |
| `driver_area` | areas a driver serves, with priority | `(driver_id, area)` UNIQUE, `priority` (lower = preferred), `active` |
| `driver_shift` | availability windows | `date`, `start_time`, `end_time`, `active` |
| `delivery_route` | a driver's run for a date/time/area-group | `status` (draft→assigned→out_for_delivery→completed/failed), `driver_id`, `delivery_date`, `area_group` |
| `delivery_route_order` | one **stop** on a route + frozen snapshot | `order_id`→`customer_order`, `area`, `delivery_{method,time}_frozen`, `stop_sequence`, `status` (assigned/picked_up/delivered/failed/returned), `delivered_at`, `failure_reason` |
| `driver_assignment_history` | append-only assignment/status trail | `forbid_mutation()` trigger |

**Integrity guards (DB-enforced):**
- `UNIQUE (route_id, order_id)` — no duplicate stop on a route.
- **Partial unique** `delivery_route_order_active_uq` on `order_id` WHERE `status IN ('assigned','picked_up')` — **an order can be in-flight on only ONE route** (no duplicate active assignment), enforced at the database, not just in code.
- `driver_assignment_history` append-only (trigger).

**Single write path:** writes only `driver` / `driver_area` / `driver_shift` / `delivery_route*` /
`driver_assignment_history` (registered → `m21-delivery`). Reads `customer_order` / `customer` to
freeze the stop snapshot; reads `packing_batch_order` (across the packing module) only to surface
packing status on the unassigned list.

---

## 2. API (RBAC-gated)

| Method + path | Permission | Action |
|---|---|---|
| `GET /drivers?active=&area=` | `delivery.driver.read` | list drivers (+ served areas); phone PII-masked |
| `POST /drivers` | `delivery.driver.manage` | create driver + served areas |
| `GET /delivery/unassigned?date=&time=&area=` | `delivery.route.read` | orders not on an active route (+ packing status); customer masked |
| `GET /delivery/suggest?area=&date=&time=` | `delivery.route.read` | drivers ranked by area priority then remaining capacity |
| `POST /delivery/assign` | `delivery.assign` | assign one order → finds/creates route, capacity guard |
| `POST /delivery/bulk-assign` | `delivery.assign` | assign all (or a list of) unassigned for date/area to a driver |
| `POST /delivery/routes` | `delivery.route.manage` | create a route (route builder) |
| `GET /delivery/routes?date=&status=&driver_id=` | `delivery.route.read` | list routes (+ stop/delivered counts) |
| `GET /delivery/routes/:id` | `delivery.route.read` | route + stops; driver phone + customer masked |
| `POST /delivery/routes/:id/status` | `delivery.status.update` | route status transition (completing delivers remaining stops) |
| `POST /delivery/routes/:id/stops/:orderId/status` | `delivery.status.update` | per-stop status (delivered/failed/returned) |
| `POST /delivery/routes/:id/reassign` | `delivery.assign` | move a route to another driver (capacity guard) |

RBAC `delivery.*` seeded in 0017, granted to `super_admin`, `admin`, `ops_manager`. Driver
read/manage carry `pii`. Dormant `driver` / `fleet_supervisor` roles are **left dormant** (not
granted) — promotion is part of the engine follow-up.

---

## 3. Assignment logic + guards

- **Capacity guard:** `capacity_per_slot` (0 = unlimited). On assign/bulk-assign/reassign, the
  count of the driver's active stops (`assigned`+`picked_up`) for that `delivery_date` must be
  `< capacity_per_slot`, else `conflict: capacity_exceeded`.
- **No duplicate assignment:** the partial-unique index rejects assigning an order already in flight;
  the service maps the `23505` to `conflict: order already assigned` (bulk-assign counts it as `skipped`).
- **Driver suggestion:** `driver_area` rows for the area, `active`, ordered by `priority` then current
  load — drives the "suggest driver by area & capacity" workflow.
- **Find-or-create route:** assigning reuses an open (`draft`/`assigned`) route for the same
  driver/date/time/area-group, else creates one (`assigned`).

### State model
```
delivery_route:        draft ──► assigned ──► out_for_delivery ──► completed
                          └──────────────► failed ◄──────────────┘
delivery_route_order:  assigned ──► picked_up ──► delivered
                          ├──► failed ──► returned ──► assigned (retry)
```
Each transition is guarded against an allowed-transition map, writes a **same-transaction audit row**
(`delivery.driver_created`, `delivery.route_created`, `delivery.order_assigned`,
`delivery.bulk_assigned`, `delivery.route_status_changed`, `delivery.stop_status_changed`,
`delivery.route_reassigned`), and an append-only `driver_assignment_history` record. As with packing,
the platform `TransitionEngine` is untouched; promotion into seeded `transition_config` (and alignment
with fulfillment `f9..f14`) is follow-up **A-OPS-01**.

---

## 4. Tests (`tests/integration/ts-i-delivery.test.ts` — 9, all green)

driver create with areas; **suggest by area** (priority order); **assign by area** (creates route +
stop); **capacity guard** (cap=1 → 2nd assign conflicts); **no duplicate assignment**;
DB-level active-assignment guard; route status transitions (valid path + invalid rejected);
**packing→driver handoff integration** (handed orders appear unassigned with
`packing_status='handed_to_driver'` and are assignable); append-only history rejects UPDATE/DELETE.

---

## 5. Scope

**In now:** drivers + served areas + capacity; unassigned list; suggest/assign/bulk-assign; route
build; route + per-stop status tracking; reassign; full audit; admin page (`/app/delivery`).

**Out now (follow-ups):** geo/route optimization + stop sequencing beyond insertion order; driver
mobile app / driver-role login (role stays dormant); engine-driven transitions + fulfillment-day
status linkage (A-OPS-01); SMS/WhatsApp driver dispatch (WhatsApp stays dry-run, doc 23/25).
