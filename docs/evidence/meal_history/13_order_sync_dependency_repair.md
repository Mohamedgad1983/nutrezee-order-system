# 13 — Order-Sync Dependency & #24629 Repair Analysis (m22)

> The 28 last-30 meal-history exceptions are **`missing_order_link`** — caused by orders absent from
> `sync_record`, **not** by meal-history parsing. This doc determines what (if anything) can be made
> available **deterministically** this sprint. **Outcome: nothing — relink is BLOCKED on order-sync
> completeness.** No bypass, no phone/name/guess linking.

## Baseline (staging, 2026-06-17, read-only)
| metric | value |
|---|---|
| staging version | 0018 |
| order watermark (`max sync_record order legacy_key`) | **24630** |
| `sync_record` orders | 20,103 |
| `customer_order` | 20,104 |
| `migration_exception_review` | 1,272 |
| meal exceptions | 28 `missing_order_link` / 24 distinct orders |
| exception orders now in `sync_record` | **0 / 24** (unchanged — order-sync has not advanced) |

## Group A — 23 orders, order_number 24631–24674 (> watermark)
**Status: BLOCKED on order-sync apply (not wired).** These are new orders above the sync watermark.
- The order incremental-sync is **dry-run only** and **refuses apply** (`refused: SYNC_MODE=apply is
  not permitted from the scheduled dry-run entrypoint`). No order-sync apply path exists by design
  (prior-sprint decision; the 30-min timer also stays disabled).
- Order-sync **dry-run** (fresh, this sprint): `watermark 24630, next_cursor 24675, records_seen 26071,
  would_create 0, would_skip 639, ok true`. The 24631–24674 orders are **`would_skip`** — the on-disk
  `orders_index` extract carries no customer phone, so they are **not creatable** without a full-shape
  legacy re-pull.
- **Action taken: none** (correctly). Making these available requires (a) a full-shape order pull with
  phone + (b) a gated order-sync apply — both out of m22 scope and not permitted here. Not bypassed.

## Group B — order #24629 (≤ watermark) — investigated, NOT deterministically repairable
**Status: BLOCKED on manual customer resolution (placeholder phone).**
- `migration_exception_review` record (non-PII fields): `reason=placeholder_phone`,
  `repairability=review`, `recommended_action="order on a shared/junk phone; resolve customer
  manually"`, `risk=high`, `status=pending`.
- It maps in the extract (`order_number 24629 → internal_id 23673`), so the *order* identity is known,
  but the **customer** cannot be resolved deterministically — the order sits on a shared/placeholder
  phone. The only documented path is **manual** customer resolution.
- The single allowed deterministic chain is `order_number/internal_id → sync_record → customer_order →
  customer`. That chain **cannot complete** here because no `sync_record`/`customer_order` row exists
  and the customer is ambiguous. **Repair by name, phone, or guesswork is forbidden — not done.**

## Decision
**0 of 24 exception orders can be made available deterministically this sprint.** Therefore the relink
job (doc 14) will report `resolvable=0` and its apply is **BLOCKED on order-sync completeness**. This
is the expected, documented state — the relink job is built and proven so it promotes automatically
once order-sync advances. No order-sync apply was run (not permitted/not safe); #24629 was not repaired
by non-deterministic means.

## What unblocks this later (deterministic, future)
1. Full-shape order re-pull (with phone) + gated order-sync **apply** so 24631–24674 enter
   `sync_record` → Group A self-heals via the relink pass.
2. Manual customer resolution of #24629's placeholder phone (operations decision) → then its order
   syncs → relink promotes it. Until then it remains an honest exception.
