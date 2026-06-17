# 31 — Post-Retry Relink Dry-Run

> **Phase 6 / Part F.** Ran the deterministic meal-history relink in **dry-run** after the retry
> import. **Resolvable = 0** — the retry added no new exceptions (all 5 orders were already
> order-linked), and the 77 open `missing_order_link` exceptions remain **blocked on order-sync
> completeness**, not on anything this sprint changed. Read-only; no name/phone/guess linking; nothing
> fabricated; nothing promoted.

## Execution (VPS host, read-only)
The relink script was uploaded to the VPS (it was not previously deployed there) and verified
byte-identical to the repo before running:
```
sha256  meal-history-relink.mjs = b7c0ad3cb2c504862d19ded4d80de474a1f247bc5e17b88ddb86440419b4a00e  (repo == VPS)
node --check … OK
RELINK_MODE=dry-run SYNC_TARGET=staging  node meal-history-relink.mjs   # PG* env from /opt/nutrezee/.env
```

## Relink DRY-RUN SUMMARY
| field | value |
|---|---|
| mode | dry-run |
| reason | `missing_order_link` |
| exceptions_seen | **77** |
| resolvable | **0** |
| unresolved (distinct orders) | **40** |
| would_promote_items | 0 |
| would_mark_resolved | 0 |
| still_missing_order_link | **77** |
| applied | false |
| ok | true |

## Why resolvable = 0 (still blocked, by design)
Relink promotes a `missing_order_link` exception **only** via the deterministic chain
`legacy_order_number → sync_record.legacy_key(order) → customer_order.id, customer_id`, and only when
**both** `order_id` and `customer_id` resolve. None of the 40 distinct exception orders are present in
`sync_record` yet, so there is no deterministic link to promote. Per the binding rules we do **not**
link by name or phone and do **not** fabricate links — so the correct, safe outcome is to promote
nothing.

This is an **order-sync completeness** dependency, not a meal-history defect: the meal-days are safely
archived (raw + parent + exception rows) and will be promoted automatically by a future relink run once
the owning orders land in `sync_record` (e.g. via continued order import / the known
`#24629 placeholder_phone` case in `migration_exception_review`, which is not deterministically
repairable without manual matching).

## Effect of the retry on relink readiness
The 5 retried orders were **fully order-linked** (0 new exceptions — see docs 28–30), so the open
exception set is **unchanged at 77** and relink readiness is exactly as before the retry. No apply was
run (correctly), because `resolvable = 0`.
</content>
