# 33 — Order-Sync Phase 3: Apply, Identifier Bug, Rollback, Correct Redo

**Date:** 2026-06-21 · **Status: DONE (staging)** · Follows [32 — scope](32_order_sync_full_detail_repull_scope.md).
**Outcome:** 77 missing legacy orders created with **verified-correct** customer links; all 77 meal-history `missing_order_link` exceptions resolved. A first attempt linked 435 orders to the **wrong** customers via an identifier bug — caught by verification and rolled back via snapshot before any further work built on it.

---

## 1. The legacy order identifier model (the crux)

Legacy orders carry **two disjoint identifier spaces**:

| id | what it is | where it appears |
|---|---|---|
| `order_number` | the order's business number | `orders_history.json.id`; `sync_record` order `legacy_key`; meal-history `legacy_order_id` |
| `internal_id` | the order's internal row id | detail URL `/orders/view/<internal_id>`; archived page filename `out/raw/view_<internal_id>.html.gz` |

They are **disjoint** — across 26,071 index rows, `order_number == internal_id` in **0** rows; any numeric overlap is coincidence. The authoritative map between them is **`out/orders_index.jsonl`** (each row carries both for the same order). Cross-check: every sampled `view_<internal_id>` page body contains its own `order_number` (200/200).

**The customer phone** (the order→customer link the sync needs) lives only on the detail page, as `Contact no : <8-digit>`. So the enrichment chain is:

```
order_number → (orders_index) → internal_id → view_<internal_id>.html.gz → "Contact no" → +965… → match customer by exact phone in sync_record
```

## 2. What went wrong (v1) and how it was caught

The first enrichment looked up `view_<order_number>` directly — but pages are keyed by `internal_id`. Because the two spaces are disjoint, each "hit" pulled **a different, unrelated customer's phone**. It *looked* fine (97% of the wrong phones still matched *some* real customer), so 557 candidates → 545 dry-run creates → **435 applied**.

**Caught by a correctness probe**, not by the apply succeeding: comparing the v1 phone (`view_<order_number>`) to the correct phone (`order_number→internal_id→view`) on 300 orders gave **285/285 different**. The 435 orders were linked to wrong customers.

## 3. Rollback (snapshot restore)

- A full DB snapshot was taken **before** the apply: `/opt/nutrezee/backups/pre-order-sync-apply-20260621-132432.dump` (TOC-validated, 78 table-data entries).
- Full-DB `pg_restore` is destructive on shared staging → it was **explicitly authorized by the owner** before running (the auto-classifier correctly blocked the unauthorized attempt).
- Restore: stop API → terminate connections → `pg_restore --clean --if-exists` → start API. One ignorable error (partitioned `audit_event_default` inherited pkey).
- **Verified back to baseline**: customer_order=20,104, sync_record=52,423, payment_record=11,539, meal-history exceptions open=77, items=67,908, analytics views=2, API `/health` ok.

## 4. Correct redo (v2)

Enrichment via `order_number → internal_id → view_<internal_id>` (ambiguous order_numbers with >1 internal_id — 19 of them — excluded). 25,999/26,071 enriched; 98% match an imported customer.

Supervised apply (`ops/sync/apply-order-sync.mjs`, dry-run→apply per chunk to satisfy the M19 same-sourceHash gate, idempotent via `sync_record`):
- **Created 77 orders, matched 23, 0 errors, 0 orphans.** customer_order 20,104 → 20,181.
- **End-to-end correctness verified: stored customer phone == legacy page phone for 77/77.**
- Idempotency: re-run dry-run `would_create=0, would_fail=0`.

Meal-history relink (`meal-history-relink.mjs`, with a `|| syncMap.get(legacy_order_id)` fallback added because order-sync keys `sync_record` by `order_number` which equals the meal-history `legacy_order_id`):
- **77/77 exceptions resolved, 75 items promoted, 0 errors.** Meal-history `customer_id` == its order's `customer_id` for **0 mismatches**.

## 5. Why only 77 (not the full backlog)

v2 only creates orders whose **actual** customer is already in `sync_record`. Of the ~557 not-yet-synced orders, only ~122 have a correct phone matching an imported customer. The remaining ~435 are blocked on **customer coverage** — their customers were never imported. Force-creating them (as v1 accidentally did) would fabricate wrong links. Closing that gap requires a **customer re-pull/import**, which is the ongoing-pipeline (Phase B) scope.

## 6. Guardrails reaffirmed
- Link strictly by the page's own `Contact no`, matched to an existing customer by exact normalized phone. Never name/fuzzy. Never fabricate.
- Every apply is snapshot-preceded, dry-run-gated, idempotent, and **correctness-probed** (stored phone == source phone) — the probe is now mandatory, not optional.
- Legacy login is **owner-run only** (production boundary + classifier).

## 7. Artifacts
- `ops/sync/apply-order-sync.mjs` (supervised apply, repo).
- Snapshots on VPS: `pre-order-sync-apply-20260621-132432.dump`, `pre-apply-v2-20260621-140037.dump`.
- VPS: `orders_history_enriched_v2.json`, `order_phone_map.json`; relink fallback in `/opt/nutrezee/legacy-meal-history/meal-history-lib.mjs` (+ `.bak-20260621-relink`).
