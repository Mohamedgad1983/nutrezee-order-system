# 09 — Sample DB Reconciliation (NOT RUN)

> Not run — no dish content was imported (docs 01/06/07). The reconciliation **method** is defined and
> ready; it will be executed once a dish source is captured.

## Reconciliation checks (to run after a real sample apply)
1. every captured raw response has a `legacy_dish_detail_raw` row (manifest-sha → DB-sha, missing = 0).
2. every parsed slot is a `customer_dish_day` (+ items) **or** a `dish_detail_exception` — zero unaccounted.
3. unknown parsed fields preserved in `extra_json` (count > 0 ⇒ preserved, not dropped).
4. duplicate raw hashes = 0; duplicate dish-days = 0; duplicate dish-items = 0.
5. idempotency rerun inserts 0 data rows.
6. result queryable from PostgreSQL; no PII/secret in logs.

These mirror the m22 reconciliation that was proven to zero silent drops; the m23 schema (`0020`) enforces
the dedup/no-dup constraints structurally.
</content>
