# 15 — Relink VPS Execution (staging)

> **Status: relink job PROVEN on staging (dry-run); apply BLOCKED on order-sync completeness.**
> 0 of 24 exception orders are deterministically resolvable yet — exactly as analysed in doc 13.
> Nothing forced. No production. No PII in logs (counts/ids only).

## 0019 deployed to staging
| item | result |
|---|---|
| pre-0019 backup | `/opt/nutrezee/backups/pre-m22-0019-20260617T112920Z.dump` (18M) |
| applied | `0019_wave6_meal_history_exception_resolution.sql` (only pending) |
| post version | **0019** |
| resolution columns | **4** (`resolution_status`, `resolved_at`, `resolved_by_run_id`, `resolution_note`) |
| existing 28 exceptions | backfilled to `resolution_status='open'` (additive, non-destructive) |

## Relink dry-run (staging)
```
docker exec -e RELINK_MODE=dry-run -e SYNC_TARGET=staging nutrezee-api-1 node /srv/meal-history-relink.mjs
```
| field | value |
|---|---|
| exceptions_seen | **28** |
| resolvable | **0** |
| unresolved | **24** |
| would_promote_items | 0 |
| would_mark_resolved | 0 |
| still_missing_order_link | 28 |
| duplicate_clean_items | 0 |
| invalid_raw_payload | 0 |
| applied | false |
| **ok** | **true** |

## Interpretation
The relink job reads all 28 open `missing_order_link` exceptions (24 orders) and deterministically
resolves **0** — none of the 24 order_numbers exist in `sync_record` (order-sync has not advanced;
doc 13). The job is correct and ready: it will promote automatically once the orders appear.

**Apply not run** — `resolvable=0`, so there is nothing to apply, and forcing is forbidden. This is the
documented **BLOCKED on order-sync completeness** state, not a relink defect.

## DB counts (unchanged — dry-run wrote nothing)
clean items 211 (before) = 211 (after) · exceptions 28 (open) before = 28 (open) after · resolved
exceptions 0. No duplicates. No PII in the summary (ids/counts only).

## Unblock path (deterministic, future)
Advance order-sync so 24631–24674 enter `sync_record` (full-shape order pull + gated order-sync
apply), and resolve #24629's placeholder-phone exception manually (doc 13). Then re-run
`meal-history-relink` (dry-run → gated apply with `RELINK_APPLY_CONFIRM=APPLY_RELINK_STAGING`) — the 23
Group-A orders (and #24629 once admitted) promote idempotently, exceptions marked `resolved` (not
deleted).
