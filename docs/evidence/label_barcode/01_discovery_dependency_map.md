# 01 — Gate 1 Discovery & Dependency Map (WP-LBL-A27)

> **Status:** ✅ COMPLETE — no code written before this document.
> Evidence labels: **[V]** Verified against code/DB · **[I]** Inferred · **[A]** Assumed · **[NC]** Needs Confirmation.

---

## 1. Legacy label — exact transcription

Source: owner-supplied photograph `IMG_1529.HEIC` (2026-07-27), de-rotated and cropped.
Physical stock: white printed area on a **yellow/chartreuse label liner**. The yellow is the
**adhesive label stock itself, not printed ink** [V — visible outside the printed white area on all
four edges]. Orientation **landscape**. Sheet appears to be a die-cut sticker, ~10×7 cm [A].

### Header (centred)
Hexagon outline mark · wordmark **Nutreeze** · tagline *Stay Healthy*.

### Left column — customer & delivery block
Labels are *italic*, values upright. Thin horizontal rules separate groups.

```
Full Name        :  mariam khlaed almajed
Subscription     :  Tuesday 28th July 2026
Delivery Time    :  From 5 AM to 4 PM
Days Remaining   :  19
Delivery Method  :  Call upon arrival
────────────────────────────────────────
630 - 1730 calories (almost)  (Meal: 3)      ← package name bold-italic
(Snacks: 2)
────────────────────────────────────────
User ID 689        Driver ID A1        User ID
                                       26496   ← right-aligned, two lines
────────────────────────────────────────
Area: Abu Ftaira, Block: 5, Street: 20
Building: 61, Floor: -, Flat: -, Direction: -
Phone: 51712730
Notes: 90p - 110c
────────────────────────────────────────
```

### Right column — meals & nutrition table (bordered grid)

| Dish Name | Qty | Pro | Carb | Fat | Cal |
|---|---|---|---|---|---|
| Eye egg muffin sandwich | 1 | 16 | 24 | 12 | 268 |
| Chicken Maqluba (WL) | 1 | 21 | 34 | 11 | 319 |
| Italian pasta with vegetable | 1 | 9 | 24 | 6 | 186 |
| Quinoa And Vegetables Salad | 1 | 2 | 12 | 6 | 110 |
| Fruit Salad | 1 | 1 | 11 | 0 | 48 |

Below the grid, **unbordered** totals block with its own column captions:

```
                       Protein   Carb   Fat   Calories
Total Nutrition           49      105    35      931
```

Arithmetic check: 16+21+9+2+1 = **49** ✅ · 24+34+24+12+11 = **105** ✅ ·
12+11+6+6+0 = **35** ✅ · 268+319+186+110+48 = **931** ✅.
→ **Total Nutrition is a computed column sum, not a separately stored value** [V].

### Two findings that change the mapping

1. **The right-hand "User ID 26496" is the ORDER NUMBER, not a user id.** [V]
   Staging `customer_order.order_number` for orders created 2026-06-18/20 runs
   24644–24672; 26496 is the correct continuation for a late-July order. The left
   "User ID 689" is the legacy *customer* id. The legacy template reuses the caption
   "User ID" for two different entities. **We reproduce the caption verbatim (exact-label
   rule) but bind it to the correct source.**
2. **`630 - 1730 calories (almost)` is a literal `package.name_en` value.** [V]
   Exact string present in staging `package`. It is not a computed calorie range.

---

## 2. Field → authoritative source mapping

| # | Label field | Source | Verdict |
|---|---|---|---|
| 1 | Full Name | `customer.full_name_en` | ✅ [V] |
| 2 | Subscription (date) | the label's delivery date = `fulfillment_day.date` | ✅ [V] |
| 3 | Delivery Time | `customer_order.delivery_time_frozen` → `delivery_slot` | ✅ [V] |
| 4 | Days Remaining | `analytics.order_subscription_periods.days_remaining` (0021; `MAX(fulfillment_day.date) − today@Asia/Kuwait`) | ✅ [V] |
| 5 | Delivery Method | `customer_order.delivery_method_frozen` | ✅ [V] |
| 6 | Package name line | `customer_order.package_name_frozen_en` (fallback `package.name_en`) | ✅ [V] |
| 7 | (Meal: n) | `package.meals_per_day` | ✅ [V] |
| 8 | (Snacks: n) | **no column exists** | ⚠️ **[NC] — gap 1** |
| 9 | User ID (left) | legacy customer id | ⚠️ **[NC] — gap 2** |
| 10 | Driver ID | `driver.legacy_driver_id` via route assignment | ✅ [V] |
| 11 | User ID (right) | `customer_order.order_number` | ✅ [V] (caption is legacy-wrong, see §1) |
| 12 | Area | `area.name_en` via `address.area_id` | ✅ [V] |
| 13 | Block | `address.block` (0023) | ✅ [V] — 8 695 / 9 542 populated (91 %) |
| 14 | Street | `address.street` (0022) | ✅ [V] |
| 15 | Building | `address.building` (0022) | ✅ [V] |
| 16 | Floor | `address.block_floor_raw` is ambiguous; no clean floor column | ⚠️ **[NC] — gap 3** |
| 17 | Flat | `address.house_no` | ⚠️ [I] — gap 3 |
| 18 | Direction | `address.delivery_notes` | ⚠️ [I] — gap 3 |
| 19 | Phone | `customer_phone.phone_normalized` where `is_primary` | ✅ [V] |
| 20 | Notes | `customer.notes` / `address.delivery_notes` | ⚠️ [I] |
| 21 | Dish Name / Qty | `customer_dish_day_item.dish_name`, `.quantity` | ⛔ **BLOCKED — gap 4** |
| 22 | Pro / Carb / Fat / Cal | `customer_dish_day_item.{protein,carbs,fat,calories}`; catalog fallback `nutrition_facts` | ⛔ **BLOCKED — gap 4** |
| 23 | Total Nutrition | **computed** sum of the rendered rows | ✅ [V] (matches legacy arithmetic exactly) |

### Gap 4 is the material one — meal & nutrition data does not exist

Read-only counts taken from the **live staging DB** (`nutrezee-postgres-1`) on 2026-07-27:

| Table | Rows | Meaning |
|---|---:|---|
| `customer` | 19 482 | ✅ |
| `customer_order` | 20 203 | ✅ |
| `fulfillment_day` | 530 538 | ✅ per-day delivery spine is real |
| `address` | 9 542 (8 695 with block) | ✅ |
| `product` | 1 298 | ✅ |
| **`nutrition_facts`** | **1** | ⛔ catalog nutrition essentially unpopulated |
| **`order_item`** | **1** | ⛔ orders carry no line items |
| `customer_meal_history_items` | 67 983 | rows exist… |
| **…with `meal_name` set** | **0** | ⛔ …but every dish name is NULL |
| **`customer_dish_day` / `_item`** | **table absent** | ⛔ migration 0020 never applied to staging |
| `driver` / `delivery_route` / `delivery_route_order` / `packing_batch` | 0 / 0 / 0 / 0 | ⛔ operational layer unpopulated |

Staging `schema_migrations` stops at **0023**; 0020 and 0024–0026 are not applied there.

**Conclusion:** the per-customer, per-day dish list with protein/carb/fat/calories — the entire
right half of the legacy label — **has no authoritative source in the Nutrezee system today**, and
per the recorded m23 finding it is not extractable from legacy either (the legacy dish grid is an
ajax editor; 0 selected dishes were present in 40/40 captured pages).

Under the binding rule *"No fabricated nutrition values / every displayed field has an
authoritative data source"*, the only correct behaviour is: **render the meal table from the
authoritative model when rows exist, and render an explicit "no dish data" state when they do
not.** Inventing values, or back-filling from package averages, is prohibited and will not be done.

---

## 3. Dependency map

### 3.1 Data flow — label
```
customer ─┐
customer_phone (is_primary) ─┐
address (+area) ─────────────┼─→ LabelData ──→ label HTML/CSS ──→ browser print ──→ paper/PDF
customer_order (frozen pkg/time/method, order_number) ─┤
package (meals_per_day) ─────┤
analytics.order_subscription_periods (days_remaining) ─┤
fulfillment_day (the delivery date + status) ─┤
customer_dish_day(_item) → dish rows + nutrition ─┤     [gap 4: currently empty]
nutrition_facts (catalog fallback, via product) ──┘
customer_barcode (NEW) ──→ Code128 SVG + human-readable ref
```

### 3.2 Render / print flow
`GET /labels/:orderId?date=` → `LabelService.build()` → shared `LabelData` contract →
admin `LabelSheet` component → `window.print()` with an `@page landscape` stylesheet →
paper **or** "Save as PDF" (the browser's own print target — no PDF library needed).
Reprints require a reason → `label_print_event` row + audit.

### 3.3 Barcode flow
```
issue (idempotent)      : customer → customer_barcode(status='active')  — one per customer
render                  : barcode_value → Code128 SVG (self-written encoder, no new dependency)
scan                    : Code128 text → resolve → customer_id (follows 'alias' rows)
merge                   : m04 MergeService → m25.reassignOnMerge() → loser row becomes 'alias' → survivor
replace (admin, rare)   : old row → 'disabled' + reason; new row 'active'; both audited
```

### 3.4 Collection flow (WP-LBL-03)
```
driver app → POST /collection/scan { barcode, delivery_date, device } (Idempotency-Key)
  → resolve barcode ─────────────── none ──→ unknown_barcode
  → today's fulfillment_day rows for that customer
        none/none-active ─────────────────→ no_delivery_today
        all cancelled_day/skipped ────────→ cancelled
        >1 active ────────────────────────→ ambiguous_delivery
  → driver assignment for that order (delivery_route_order → delivery_route.driver_id)
        assigned to another driver ───────→ wrong_driver
  → existing box_collection (customer, date) ─→ duplicate
  → else INSERT box_collection + audit (same tx) ─→ accepted
```
Uniqueness enforced in the DB: `UNIQUE (customer_id, delivery_date)`.

---

## 4. Existing code — reuse verdicts

| Asset | Verdict |
|---|---|
| `platform/audit` `writeInTx(client, e)` | ✅ **reuse** — same-transaction audit, exact required pattern |
| `platform/idempotency` | ✅ **reuse** for the scan endpoint |
| `platform/rbac` + permission seeding in migrations | ✅ **reuse** pattern |
| `withTransaction(pool, fn)` (`platform/db`) | ✅ **reuse** |
| `m20-packing` `packing_status_history` append-only trigger `forbid_mutation()` | ✅ **reuse** pattern for collection trail |
| `m20-packing` `previewLabel()` | ⚠️ **do not extend** — see §5 |
| `m21-delivery` `delivery_route(_order)` | ✅ **reuse as read source** for driver assignment |
| `analytics.order_subscription_periods` (0021) | ✅ **reuse** for Days Remaining |
| `fulfillment_day` | ✅ **reuse** as the delivery-exists / cancelled authority |
| admin `api.ts`, `router.tsx`, `Packing.tsx` | ✅ **reuse** conventions |

### 5. M20 audit — reuse compliant parts, do not merge blindly

`m20-packing` is **built and green (9 integration tests) but has never been merged to `main`** — it
exists only on the build branch, exactly as the plan states [V].

Its `previewLabel()` returns **8 fields**: customer name, package, delivery time, area, allergy
warning, label code, printed_at/by. The legacy label needs **23**. `packing_label` has no address,
no phone, no dish rows, no nutrition, no barcode, and no `reprint reason`.

**Decision:** do **not** widen `packing_label` or `previewLabel()`. Reasons:
(a) `packing_label` is a *packing snapshot* keyed to a batch — labels must print without a packing
batch existing (staging has 0 batches); (b) widening it would force m20 to read customer/address/
dish data it has no business owning; (c) the reprint-reason and print-actor requirements need their
own audited table. The compliant parts that **are** reused are the append-only-history pattern, the
audit-in-transaction call shape, and the RBAC seeding style.

---

## 6. Risks

| # | Risk | Severity | Handling |
|---|---|---|---|
| R1 | Dish/nutrition data absent everywhere (gap 4) | **HIGH** | Render authoritative-or-empty. Never fabricate. Documented as a known limitation. |
| R2 | Pixel fidelity judged from a hand-held photo, not the legacy template | **HIGH** | Reproduce structure/order/typography faithfully; exact mm require a physical print comparison — an owner gate, recorded as [NC]. |
| R3 | Permanent barcode cannot prove the *date* of a physical label | MEDIUM | Accepted and documented by the plan (§11); mitigated by resolving against today's manifest + showing the matched delivery. |
| R4 | Floor / Flat / Direction / Snacks have no clean column | MEDIUM | Render from best-available column, blank when unknown — matching the legacy label, which itself prints `Floor: -, Flat: -, Direction: -`. |
| R5 | `driver`/`delivery_route` empty ⇒ every scan would return `wrong_driver`/`no_delivery_today` on staging | MEDIUM | Correct behaviour for empty data; tests seed their own fixtures. |
| R6 | Code128 needs a renderer; "no new npm dependencies" rule | LOW | Write a ~120-line Code128-B encoder in `packages/shared`. No dependency added. |
| R7 | Driver app is a separate AGPL Navigator fork with a dirty tree (untracked `… 2.tsx` duplicates) | MEDIUM | Predeclare every touched file; do not clean unrelated mess. |

---

## 7. Decisions taken

1. **New module `m25-label`** owning `customer_barcode`, `label_print_event`, `box_collection`,
   `box_collection_history`. Registered in `scan-cross-module-writes.mjs`. All other data is read
   through owning modules' tables read-only, never written.
2. **Barcode format** `NZC-XXXX-XXXX-CC` — 8 payload chars from a 32-symbol ambiguity-free
   alphabet (no I/L/O/U) + 2 check chars. Random, **not derived from any customer attribute**, so
   it carries no PII. Code128-B safe.
3. **Merge aliasing** via `m25.reassignOnMerge()` called from m04's `MergeService` (service API —
   not a foreign-table write), with the symmetric `undo` path.
4. **Label lives in a new admin route** `/app/labels`, printed with a dedicated `@media print`
   landscape stylesheet. "Save as PDF" is the browser print target — no PDF dependency.
5. **Meal rows come from `customer_dish_day_item`**, catalog `nutrition_facts` as the per-product
   fallback, and an explicit empty state otherwise.
