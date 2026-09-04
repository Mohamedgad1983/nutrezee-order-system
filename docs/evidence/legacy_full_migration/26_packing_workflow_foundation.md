# 26 — Packing Workflow Foundation (m20-packing)

> **Status:** ✅ BUILT (schema + API + UI + tests). Staging-safe, additive, forward-only.
> **Track:** operational foundation (migration track), parallel to the WP gating track.
> Module `m20-packing`. Migration `app/db/migrations/0016_wave6_ops_packing.sql`.

Packing is the step between kitchen "packed" and driver hand-off: an ops user batches orders by
**delivery date / time / area**, marks each order packed (or flags an issue), previews/prints a
label, then hands the whole batch to driver assignment (`m21-delivery`, doc 28).

---

## 1. Schema (migration 0016)

| Table | Purpose | Key columns |
|---|---|---|
| `packing_batch` | one batch per delivery date/time/area | `status` (draft→in_progress→packed→handed_to_driver / cancelled), `delivery_date`, `delivery_time`, `area`, `kitchen_id`, `branch_id` |
| `packing_batch_order` | one order in a batch + **frozen delivery snapshot** | `order_id`→`customer_order`, `customer_id`, `package_name`, `delivery_{method,time,area}_frozen`, `packing_status` (pending/packed/missing_item/issue/handed_to_driver), `packed_by/at`, `label_printed_at` |
| `packing_item` | per-order packing checklist line (meal/component) | `batch_order_id`, `product_id`, `item_name`, `qty`, `packed` |
| `packing_label` | printable label snapshot | `label_code` (UNIQUE), `customer_display_name`, `allergy_warning`, `printed_by/at` |
| `packing_status_history` | append-only status trail | `forbid_mutation()` trigger blocks UPDATE/DELETE |

**Integrity guards (DB-enforced):**
- `UNIQUE (batch_id, order_id)` — **no duplicate order in the same batch**.
- Partial unique on `(delivery_date, coalesce(delivery_time,''), coalesce(area,''))` WHERE `status <> 'cancelled'` — **one active batch per slot** (re-running batch-build is idempotent).
- `packing_status_history` append-only (trigger).

**Single write path:** the module writes only `packing_*` tables (registered in
`scan-cross-module-writes.mjs` → `m20-packing`). It *reads* `customer_order` / `customer` / `order_item`
to build the batch and freezes the delivery fields into its own table — no foreign-table writes.

---

## 2. API (`/packing`, all RBAC-gated)

| Method + path | Permission | Action |
|---|---|---|
| `GET /packing/batches?date=&status=` | `packing.batch.read` | list batches (+ order_count/packed_count) |
| `POST /packing/batches` | `packing.batch.create` | create batch + auto-include matching orders by date/time/area |
| `GET /packing/batches/:id` | `packing.batch.read` | batch + its orders (customer_name PII-masked) |
| `POST /packing/batches/:id/orders/:orderId/mark-packed` | `packing.batch.pack` | mark order packed (idempotent); batch draft→in_progress |
| `POST /packing/batches/:id/orders/:orderId/issue` | `packing.batch.issue` | flag missing_item / issue + reason/notes |
| `POST /packing/batches/:id/handoff` | `packing.batch.handoff` | guard: all orders packed → batch + orders `handed_to_driver` |
| `POST /packing/labels/:orderId/preview` | `packing.label.read` | build label preview (no persistence); display name masked |
| `POST /packing/labels/:orderId/mark-printed` | `packing.label.print` | persist printed label + stamp `label_printed_at` |

RBAC `packing.*` is seeded in 0016 and granted to `super_admin`, `admin`, `ops_manager`,
`kitchen_user`. Label permissions carry the `pii` visibility grant.

**Order inclusion rule:** active/approved orders whose plan window covers the batch's
`delivery_date`, matching `delivery_area_frozen` / `delivery_time_frozen` when supplied, and **not
already in a non-cancelled batch**. This uses the per-order frozen delivery data stored in Phase-1
(doc 17/18) — no per-day legacy meal data required (that stays out of scope, doc 27).

---

## 3. State model (guarded + audited, not yet engine-driven)

```
packing_batch:        draft ──(first order packed)──► in_progress ──(handoff)──► handed_to_driver
                        └────────────────── cancelled ──────────────────┘
packing_batch_order:  pending ──► packed ──► handed_to_driver
                        pending ──► missing_item / issue ──► packed (re-pack)
```

Each transition: a **guard** (e.g. handoff requires every order `packed`), a **same-transaction
audit row** (`packing.batch_created`, `packing.order_packed`, `packing.order_issue`,
`packing.batch_handoff`, `packing.label_printed`), and an append-only `packing_status_history`
record. The platform `TransitionEngine` is **not** used here — its `Machine` type is a closed union
(`order|fulfillment|payment|ticket|draft`); adding new machines would edit the frozen platform layer.
Promotion of `packing_batch` / `packing_batch_order` into seeded `transition_config` is the documented
follow-up (amendment **A-OPS-01**). Audit + history give an equivalent immutable trail today.

---

## 4. Tests (`tests/integration/ts-i-packing.test.ts` — 9, all green)

batch creation; **order inclusion by date/time/area** (matching orders only); duplicate-slot batch
rejected (conflict); mark-packed → batch in_progress; issue flag; **handoff guard** (blocked until all
packed, then succeeds → handed_to_driver); label preview (stable `NZ-…` code);
`UNIQUE(batch_id, order_id)` enforced at DB; append-only history rejects UPDATE/DELETE;
order already in an active batch is not re-included.

---

## 5. Scope

**In now:** batching by delivery date/time/area from stored per-order delivery data; pack/issue
tracking; label preview/print; hand-off to driver; full audit trail; admin page (`/app/packing`).

**Out now (follow-ups):** per-day meal line items on labels (doc 27 — needs the meal model, not
migrated); engine-driven transitions (A-OPS-01); barcode/PDF label rendering (label data is ready,
rendering is a UI concern); kitchen-section routing of packing items.
