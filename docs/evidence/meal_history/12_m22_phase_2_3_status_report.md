# 12 — m22 Phase 2/3 Status Report

> Staging migration deployment + gated last-30-days apply + V1–V8 validation. Branch
> `migration/legacy-full-clone-reconciliation`. **NO bridge. No full/90/year/all import. No UI. No
> sync. No timer. No WhatsApp. No production.**

## STATUS: **PASS**

## 1. Staging migration
| Item | Value |
|---|---|
| pre-version | **0015** (15 applied) |
| applied | **0016, 0017, 0018** (in numeric order, each own transaction, tracked) |
| post-version | **0018** (18 applied) |
| m22 tables present | **yes** (5) |
| migration gap risk | **no** (contiguous 0015→0018) |
| destructive changes | **none** (independent 5-agent audit: all additive, skeptic `refuted=false → apply_in_order`) |
| existing data | **unchanged** (customer_order 20104, customer 19476; permission 67→82 additive) |
| backup | `pg_dump -Fc` → `/opt/nutrezee/backups/pre-m22-deploy-20260617T105055Z.dump` (18M) |

## 2. Dry-run after migration
seen 60 · candidate 52 · would_archive 60 · would_import_clean 211 · would_skip_duplicate 0 ·
would_exception 28 · missing_order_link 28 · missing_customer_link 0 · invalid_date 0 ·
duplicate_hash 0 · **dedup_checked true** · **ok true** · applied false. Materially identical to the
Phase-1 baseline; only `dedup_checked` flipped false→true.

## 3. Gated last-30-days apply (`01KVAKEJ81NY46128Z7CWZ1FEY`)
applied **true** · raw 60 · parent 60 · items 211 · exceptions 28 (`missing_order_link`) · ok true.
Wrote **only** m22 tables; order/customer read-only (counts unchanged). Idempotent rerun:
`would_skip_duplicate 60`, all inserts 0, DB unchanged.

## 4. Validation V1–V8 — **all PASS** (ground-truth reconciliation)
`60 parents = 34 linked (28 with-items + 6 zero-window) + 26 unlinked (24 with-exceptions + 2
zero-window)`; `239 in-window meal-days = 211 clean items + 28 exceptions` (exact); **0 silent drops**,
**0 orphan items**. Dates flush to window, 0 invalid/null. Idempotency proven. An adversarial 10-agent
panel forced this reconciliation (its V2/V3/V8 doubts resolved to missing bridging fields, not defects).

## 5. Exceptions
28 rows / 24 orders, all `missing_order_link`, ids-only (no PII). Deterministic split:
**Group A (23)** order_number > watermark 24630 = not-yet-synced new orders (self-heal via order-sync);
**Group B (1)** order 24629 ≤ watermark = upstream order-migration gap (**confirmed in
`migration_exception_review`**). Repair = a deterministic `meal-history-relink` pass off the raw
archive after order-sync advances (doc 11). Re-running the import alone cannot repair (raw_sha skip).

## 6. Tests / gates
node --check (lib + runner) ✅ · npm run typecheck ✅ · npm run lint ✅ · scanners (cross-module +
no-GET-mutation) ✅ · npm run build ✅ · **vitest 50 files / 241 tests** ✅ · migrations apply clean
**0001→0018** locally ✅ (+ deployed clean to staging).

## 7. Safety rules honored
no bridge ✅ · no full/90/year/all import ✅ (guards refuse) · no production apply ✅ (guard refuses) ·
no scheduled sync / timer ✅ · no UI ✅ · no WhatsApp ✅ · no destructive schema ✅ · no PII in logs ✅ ·
exceptions to exceptions table (never forced into clean) ✅ · meal-history separate from order sync ✅
(own runs/exceptions/validation trail).

## 8. Decision (per the rule)
V1–V8 pass and idempotency is proven ⇒ **prepare last-90-days as the next phase** — but execute it
**after** clearing the `missing_order_link` exceptions via order-sync + the relink pass (doc 11),
since widening before repair would accumulate the same order-link-dependency exceptions. Last-90-days
import is **not** run in this task.

## Next safest step
1. Run order incremental-sync (and repair order 24629's `migration_exception_review` entry) so the
   watermark passes 24631–24674. 2. Build + run the deterministic `meal-history-relink.mjs` pass
   (dry-run → gated apply) to promote the 24 exception orders. 3. **Then** dry-run last-90-days to size
   the candidate set before any wider apply. No full-history, no timer, no UI until samples validate.
