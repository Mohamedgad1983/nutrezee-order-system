# Proposal: Minimal Safe Schema Extension for Legacy Per-Order Delivery

Date: 2026-06-16 · Status: **PROPOSED — not applied.** (Sponsor authorized proposing; no schema change made.)

## Problem

The first-migration scope requires **delivery method** and **delivery time** to be stored and reconciled. They are fully extracted (20,637 orders; methods: Call-on-arrival 8,659 / Leave-the-box 6,039 / Ring-the-bell 5,145 / Deliver-1-day 73; delivery_time 96.3% coverage; 114 areas). But the current staging schema has **nowhere to store them per order**:

- `customer_order` columns: only `site_ref text` (no delivery fields).
- `address` columns: `area_id`, `address_text`, `delivery_notes` — **no delivery_method / delivery_time**.
- `delivery_method` / `delivery_slot` / `area` exist only as **master lists**.

So per-order delivery cannot be stored without either a schema change or enabling the dormant fulfillment module (the latter is forbidden by the project rules).

## Option A — Accepted exception (no schema change)

Document per-order delivery method/time as **out of scope for phase 1**, deferred to the later kitchen/fulfillment migration. Store only the master lists (4 methods, slots, 114 areas) and `area` frozen on the order. WhatsApp renewal is unaffected (segments are date/status/phone-based).

- **Pros:** zero schema risk; respects "dormant modules stay stubs."
- **Cons:** "delivery method/time stored per order" never reaches 100% this phase.

## Option B — Minimal safe extension (recommended)

Add three **nullable, additive, frozen-snapshot** columns to `customer_order`, mirroring the existing `package_name_frozen_en` pattern (frozen legacy text, no FK, no behavior change):

```sql
-- NNNN_waveN_order_delivery_frozen.sql (forward-only; additive; nullable)
ALTER TABLE customer_order
  ADD COLUMN delivery_method_frozen text,   -- legacy delivery method (e.g. اترك الصندوق عند الباب)
  ADD COLUMN delivery_time_frozen   text,   -- legacy delivery time/slot label
  ADD COLUMN delivery_area_frozen   text;   -- legacy area name (also available via address.area_id)
```

Then extend the M19 `active_plans` importer (M03 owns `customer_order`, so the single-write-path rule is preserved) to populate them from the extracted `order_detail.jsonl`, keyed by `order_number`/legacy id.

- **Why safe:** nullable + additive (no migration backfill, no NOT NULL, no FK); matches the established "frozen legacy snapshot" convention; written only by the owning module (M03); no dormant module enabled; reversible (drop columns).
- **Reconciliation after apply:** `count(*) FROM customer_order WHERE origin='legacy' AND delivery_method_frozen IS NOT NULL` vs the 19,916 extracted; per-method distribution vs the extraction summary.
- **Scope guard:** this is a **migration-snapshot** field, not an operational delivery model. The real delivery/fulfillment model stays for the kitchen phase.

## Recommendation

Adopt **Option B** if "delivery method/time stored per order" must be part of phase-1 completeness — it is the smallest change that makes the data reconcilable in the DB. It needs: (1) a new forward-only migration, (2) a small importer change, (3) a dry-run → reviewed apply. All gated on your approval; **no schema change or apply was performed in this session.**

Until delivery method/time are stored and reconciled (Option B applied, or accepted as Option A exception), **`VERIFIED_DB_STORED_100_PERCENT` is not claimed.**
