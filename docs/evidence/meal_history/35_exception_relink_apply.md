# 35 — Deterministic Meal-History Relink

> **Stage 2.** Ran the deterministic relink **dry-run** on staging. **`resolvable = 0`** — no apply
> (correctly). The 77 `missing_order_link` exceptions are carried forward, blocked on order-sync
> completeness (Stage 1 / doc 34). Read-only; no name/phone linking; nothing fabricated or promoted.

## Relink DRY-RUN SUMMARY
| field | value |
|---|---|
| reason | `missing_order_link` |
| exceptions_seen | **77** |
| resolvable | **0** |
| unresolved (distinct orders) | **40** |
| would_promote_items | 0 |
| would_mark_resolved | 0 |
| still_missing_order_link | **77** |
| duplicate_clean_items | 0 |
| invalid_raw_payload | 0 |
| applied | false |
| ok | true |

## Why no apply
The relink promotes an exception **only** via the deterministic chain
`legacy_order_number → sync_record.legacy_key(order) → customer_order.id, customer_id`, and only when
**both** `order_id` and `customer_id` resolve. Per Stage 1 (doc 34), **0/40** of the exception orders
are in `sync_record`, and the order-sync dry-run reports `would_create = 0` (the extract has no phone
to deterministically link a customer). So there is nothing to promote, and an apply would be a no-op.
Running it would not be wrong, but `resolvable = 0` means it changes nothing — so none was run.

## Reconciliation (unchanged, as expected)
- resolved exceptions this stage: **0**
- remaining open exceptions: **77** (40 distinct orders)
- clean-item increase: **0**
- duplicate clean items: **0**
- unaccounted meal-days: **0** (every exception meal-day remains archived as an exception row)

## Carry-forward
The 77 exceptions remain durably archived and will be promoted automatically by this same relink (no
re-scrape needed) the moment their orders land in `sync_record` via the order-sync track + manual MER
review (doc 34). Idempotency of relink apply was already proven structurally (ON CONFLICT DO NOTHING,
resolution-trail, no deletes); with `resolvable=0` there was nothing to re-run here.
</content>
