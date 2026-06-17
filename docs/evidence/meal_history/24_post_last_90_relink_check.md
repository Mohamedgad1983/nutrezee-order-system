# 24 — Post-Last-90 Relink Check

> Relink dry-run after the last-90 apply. **Still BLOCKED on order-sync completeness** (resolvable 0).
> A count-inflation bug was found by this check and fixed.

## Relink dry-run (staging, after last-90 apply)
```
docker exec -e RELINK_MODE=dry-run -e SYNC_TARGET=staging nutrezee-api-1 node /srv/meal-history-relink.mjs
```
| field | value |
|---|---|
| exceptions_seen | **31** |
| resolvable | **0** |
| unresolved | **24** |
| still_missing_order_link | 31 |
| would_promote_items | 0 |
| would_mark_resolved | 0 |
| ok | **true** |

`resolvable=0` — none of the 24 exception orders are in `sync_record` yet (order-sync has not
advanced). The relink is correct and ready; it will promote automatically once those orders sync.
**Apply not run** (resolvable=0; not forced).

## Bug found + fixed (by this validation step)
The first relink run reported `exceptions_seen=36` while the DB had **31** open exceptions. Root cause:
the relink loaded exceptions with `LEFT JOIN legacy_meal_history_raw ON source_record_id`, and order
**24629** now has **multiple** raw archives (re-scrapes) — the join **multiplied** its exception rows.

Fix: replace the join with a **scalar subquery** (`(SELECT raw_sha … LIMIT 1)`) so the load returns
exactly one row per exception regardless of how many raw archives the order has. Re-run after the fix:
`exceptions_seen=31` (matches DB). Regression test added (`ts-i-relink`: join would double, scalar
keeps one). No data was affected (resolvable was 0; `ON CONFLICT` guards promotion anyway).

## Unblock path (unchanged, deterministic)
Advance order-sync so the 24 exception orders enter `sync_record`; resolve #24629's placeholder-phone
case (manual, operations). Then `meal-history-relink` (gated apply) promotes them idempotently and
marks the exceptions `resolved` (never deleted).
