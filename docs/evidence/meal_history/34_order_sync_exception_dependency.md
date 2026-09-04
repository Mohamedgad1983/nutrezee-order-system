# 34 — Order-Sync Completeness for the 77 Meal-History Exceptions

> **Stage 1. Determination: deterministic repair is BLOCKED within m22 scope — by design, not by
> defect.** The 77 open `missing_order_link` exceptions (40 distinct orders) cannot be deterministically
> linked because their owning orders are absent from `sync_record`, and the available order extract
> **carries no phone/customer data** to create them deterministically. No order-core mutation was
> performed (correctly). The meal-days are safely archived as exceptions and will auto-promote (Stage 2
> relink) once the order-sync track lands these orders. **No name/phone/guess linking; nothing
> fabricated.**

## What the 77 exceptions actually are
- 77 open exceptions, all `missing_order_link`, across **40 distinct legacy orders**.
- **0 / 40** order_numbers are present in `sync_record` (any object_type) — genuinely absent.
- The meal-days themselves parsed fine; the only gap is the order link.

## Why the 40 orders are missing from `sync_record` — two distinct causes
Order-sync watermark = **24,630** (max synced order legacy_key). Splitting the 40 by order_number:

| group | count | meaning |
|---|---|---|
| **≤ watermark (24,630)** | **17** | In the order-sync's processed range but **deliberately not synced** — held in `migration_exception_review`: **16 `placeholder_phone/review`**, **1 `reversed_dates/review`**. Non-deterministic by design. |
| **> watermark (24,630)** | **23** | Order numbers `24,631–24,674`, start dates **17–20 Jun 2026** — **newer** than the synced set; not yet processed. (23 of these are not in MER.) |

`migration_exception_review` join (by order_number): 16 `placeholder_phone`, 1 `reversed_dates`,
23 not-yet-reviewed. Known case **#24629 = `placeholder_phone/review/pending`** — non-deterministic,
must **not** be repaired by name/phone (per the binding rules and prior memory).

## Why order-sync cannot create them deterministically (the hard blocker)
The order extract on the VPS (`/opt/nutrezee/sync/orders_history.json`, 26,071 records) has fields
**`id, start_date, end_date, package, status` only — no `phone`, no amount, no customer**. The governed
order-sync (`incremental-sync.mjs`) creates an order **only** when it has a *valid phone matching an
already-synced customer* (`validPhone(o.phone) && storedCust.has(o.phone)`) — the deterministic
customer link. With no phone in the extract, every candidate is skipped:

```
order-sync DRY-RUN (staging, wrapper run-legacy-sync.sh):
records_seen 26071 · would_create 0 · would_update 0 · would_skip 639 · would_fail 0
watermark 24630 · next_cursor 24675 · ok true
```
`would_create = 0` — **none** of the 639 unsynced candidates (which include the 23 above-watermark
exception orders) are deterministically creatable from the current extract. The 17 below-watermark
orders are already classified non-deterministic in MER.

## What a safe repair would require (deferred to the order-sync track, separately gated)
1. A **fresh full-detail legacy order re-pull** that includes phone + amount + customer for orders
   ≥ 24,631 (the order-sync/extract track's job — not meal-history; it is a legacy read-only scrape
   with its own gates), **then** the governed **M19 import apply** to create those orders +
   `sync_record` rows where a deterministic customer link exists.
2. **Manual review** of the 16 `placeholder_phone` + 1 `reversed_dates` MER cases (human decision;
   forbidden to auto-link by phone/name).

Neither is an m22 meal-history operation, and neither may mutate order-core from here. The
`incremental-sync.mjs` apply path is **explicitly refused** (dry-run only, line 38) — so there is no
in-scope, guarded order-core apply to invoke.

## Action taken
- Ran the order-sync **dry-run** (read-only; `bootstrapTemp` skipped because `would_create=0`, so no
  temp staff_user was created) → confirmed `would_create=0`.
- **No** order-core / customer-core mutation. **No** fabricated links.
- Proceed to Stage 2 relink **dry-run** (expected `resolvable=0`) and carry the 77 exceptions forward.

## Conclusion
The 77 exceptions are blocked on **order-sync completeness + manual MER review**, not on meal history.
The meal-days are durably archived and reconcilable; they will be promoted automatically by the
deterministic relink the moment their orders appear in `sync_record`. This is the correct, safe
outcome — the alternative (phone/name matching) is explicitly forbidden.
</content>
