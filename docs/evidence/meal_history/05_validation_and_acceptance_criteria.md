# 05 — Validation & Acceptance Criteria (m22 last-30-days sample)

> Validation to run **before** widening beyond last-30-days and **before** any UI. The clean tables
> must be deployed to staging and a last-30 apply performed first; this doc defines what "good" means
> and the queries that prove it.

## Acceptance gate (all must hold on the last-30-days sample)
| # | Criterion | How to validate | Pass condition |
|---|---|---|---|
| V1 | **Sample customers old vs new** | for N sample orders, `customer_meal_history.customer_id` resolves to the same customer the order belongs to (`customer_order.customer_id`) | 100% match for linked rows |
| V2 | **Sample orders old vs new** | `customer_meal_history.order_id` = `sync_record(order, legacy_key=legacy_order_number).new_ref` | 100% match |
| V3 | **Date ranges** | `min/max(meal_date)` per order ⊆ `[customer_order.start_date, end_date]`; all items within the 30-day window | no item outside window or plan range |
| V4 | **No duplicate meal days** | `SELECT legacy_order_id, meal_date, meal_type, count(*) … HAVING count(*)>1` | **0 rows** (also DB-enforced by `cmh_items_no_dup_meal_day`) |
| V5 | **No wrong customer mapping** | join items→history→customer_order; `cmh.customer_id = co.customer_id` | **0 mismatches** |
| V6 | **No wrong order mapping** | `cmh.order_id` present ⇒ `legacy_order_number` matches `sync_record.legacy_key` for that `new_ref` | **0 mismatches** |
| V7 | **Exceptions are real & contained** | every unmapped grid is a row in `customer_meal_history_exceptions` with a valid `reason`; none leaked into clean tables | counts reconcile: `would_exception` == exceptions rows |
| V8 | **Idempotency** | re-run apply ⇒ `would_skip_duplicate` rises, no new clean rows | second run inserts 0 clean rows |

## Reconciliation of the dry-run (already observed, 2026-06-17)
- `records_seen 60` = `would_archive 60` + `would_skip_duplicate 0` (nothing archived yet).
- `would_import_clean 211` + `would_exception 28` = total in-window meal-days classified.
- `would_exception 28` == `missing_order_link 28` (every exception is an unmapped order) ⇒ V7 shape holds.
- `invalid_date 0`, `missing_customer_link 0` ⇒ no date or customer-link defects in the sample.

## Exceptions report (to produce on apply)
`SELECT reason, count(*) FROM customer_meal_history_exceptions WHERE import_run_id=$run GROUP BY reason;`
plus a per-order list (`legacy_order_id`, `meal_date`, `reason`) — **ids + reason only, no PII**.

## Acceptance decision
Proceed to last-90 → last-year → full **only after** V1–V8 pass on the last-30-days apply, and only
then build the read-only meal-history UI. Until then: dry-run + this validation define done.
