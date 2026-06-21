# 34 — Customer-Coverage Import (unblock orphan orders)

**Date:** 2026-06-21 · **Status: DONE (staging)** · Follows [33 — Phase 3](33_order_sync_phase3_apply_and_correction.md).
**Outcome:** imported the **6 genuinely-missing legacy customers**, which unblocked **22 orphan orders** (all verified-correct, 0 orphans). The "~434-order gap" was, on inspection, a handful of customers plus one **shared/test phone** carrying 364 orders — quarantined, not imported.

---

## 1. The gap, re-sized by evidence (a 4-way read-only investigation)

The headline "~434 blocked orders" decomposed to **only ~8 distinct phones**, and the distribution was extreme:

| phone | orders | distinct names on its pages | verdict |
|---|---:|---:|---|
| `+965650xxxx` | **364** | **20** (incl. "Test" ×125, "ms" ×149) | **shared/test placeholder → QUARANTINE** |
| 6 real numbers | 22 total | 1 each | genuine missing customers → import |
| `+965009xxxx` | 1 | 1 | invalid Kuwait mobile (starts 0) → quarantine |

So the real missing-customer population is **6 customers / 22 orders**, not 434. Importing the 364-order shared number would have created one fake customer owning 364 mixed/test orders and corrupted every downstream metric (subscription expiry, reports, the doctor's call-list). This is exactly the case the original 2026-06-14 import already blacklisted (phones shared by ≥10 customers).

## 2. Mechanism (existing governed path — no new importer)

The M19 `customer` importer is live and unblocked: `POST /imports/customer/dry-run` → `/imports/customer/apply` (super_admin perm `bridge.import.apply`; same-sourceHash dry-run gate; data-quality gates maxMergeReviewRate=0.10, maxErrorRate=0.02). Row schema `{ legacy_id, name (required), name_ar?, email?, dob?, phone }`. The whole system keys customers by **normalized +965 phone** (`sync_record` legacy_key) — there is no legacy customer-id in the new model — so the order→customer bridge is `active_plan.resolveCustomer → findActiveByPhone`. We set `legacy_id == phone` to match.

**Key gotchas respected:** legacy phones passed as explicit `+965…` (the `default_phone_country_code` setting is `+966`/Saudi, which would mis-normalize a bare local number); every imported row carries a parseable phone (an unparseable phone silently yields a phoneless customer that never resolves an order).

## 3. Execution
- `extract-missing-customers.mjs` — parses the customer **name** (`<b>Name</b> : …`) + **phone** (`Contact no :`, scoped to the `<address>` block — *not* the `notes` "second number") from each orphan order's `view_<internal_id>` page; groups by phone; **quarantines** phones with ≥2 distinct names or invalid Kuwait format. Output: 6 clean rows; 2 quarantined phones (364-order + invalid).
- Dry-run: `created 6, matched 0, merge_review 0, error 0` (gates clear).
- Snapshot `pre-customer-import-20260621-144923.dump` → `apply-customer-import.mjs` (ALLOW_APPLY=yes) → **6 created**.
- Re-ran `apply-order-sync.mjs` on the enriched extract → **22 orders created**; **correctness probe: stored customer phone == legacy page phone for 22/22**, 0 orphans.
- Order sync now idempotent: `would_create=0`. Meal-history `would_skip=0` open exceptions.

## 4. Final state (session cumulative)
`customer_order` 20,104 → **20,203** (+77 Phase 3, +22 here). `sync_record` customers 19,463 → **19,469**. Meal-history exceptions **0 open**. Orphan orders **0**.

## 5. Quarantine (documented, NOT imported) — manual disposition
`would_skip ≈ 412` orders remain un-syncable and are **correct to leave out**:
- **364** orders on `+965650xxxx` — a shared/test number (20 names incl. "Test"). Needs a business decision: is any subset real? They cannot be auto-attributed to one customer.
- **~26** orders with no phone on their page; **~18** with junk/malformed prefixes (`+123…`, `+003…`); **1** invalid Kuwait mobile.
These belong in a manual-exception review, not an automated link. Order_numbers are reproducible from `extract-missing-customers.mjs` (quarantine list) + the planner's `would_skip`.

**Owner decision (PM, 2026-06-21): leave the 364-order shared/test phone (and the no-phone/junk-prefix orders) QUARANTINED — do not import.** The evidence (20 names incl. "Test") indicates test/shared data; the order-sync line is considered closed for this pass. Revisit only if business confirms a real subset.

## 6. Artifacts
- `ops/sync/extract-missing-customers.mjs`, `ops/sync/apply-customer-import.mjs` (repo).
- VPS: `customers_missing.json`; snapshot `pre-customer-import-20260621-144923.dump`.
- The shared-phone quarantine guard (≥2 distinct names ⇒ exclude) mirrors the original import's ≥10-customer blacklist — keep it for any future customer backfill.
