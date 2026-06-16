# Legacy Detail Re-Extraction (closing the P0 gaps)

Date: 2026-06-16 (same session as the reconciliation)

## Why

The reconciliation (`10_…`, `12_…`) found two P0 gaps: order **delivery** data and order **line items** were never migrated, and the **product catalog** was near-empty (2 vs an unknown legacy total). The sponsor then provided **live read-only legacy admin access** (`https://nutreeze.com/admin`), unblocking a targeted re-extraction of exactly those missing pieces.

## Access (this session)

- Logged in read-only to the live legacy admin (`POST /logincheck`, single auth POST; everything else GET). Credentials supplied by the sponsor at runtime — **not printed, not committed** (a gitignored env / inline only).
- Source class upgraded to **live read-only admin available**. Target unchanged (staging; no import this session — `MIGRATION_APPLY` unset, sponsor chose *extract + validate + dry-run only*).

## What the data model turned out to be (verified, read-only)

| Missing piece | Legacy source | Verdict |
| --- | --- | --- |
| **Product/meal catalog** | `/products` (one inline table) | **Extractable — 1,296 products** (No, Name EN, Name AR, Category, Associated Packages, Status). Staging had 2. |
| **Order delivery** | `/orders/view/<internal_id>` — inline `Delivery Method : … / Area : … / Delivery Time : … / Driver : …` | **Extractable.** Confirmed real values, e.g. `اترك الصندوق عند الباب` (Leave the box), `الاتصال عند الوصول` (Call upon arrival), areas (Jabriya, Al-Mutlaa), time slots. Closes MM-02. |
| **Order payment detail** | same view page (table) | **Extractable** — payment method (KNET/CC), payment date, transaction (amount needs parser refinement; raw captured). |
| **Per-order id mapping** | orders ajax row | display `order_number` (e.g. 24675) ≠ internal id (23720); detail pages key on the internal id, which the ajax provides. |
| **Per-day meal line items** | `/orders/getMealsDateWiseFilter/all/<id>` | **NOT cleanly extractable.** The grid is loaded by secondary ajax (`getMealsByType`…), not in static HTML — full extraction would be ~500k requests across 19,465 orders × ~26 days (infeasible + abusive). Also a **model question**: per-day meals are arguably kitchen/fulfillment-domain data, not the subscription `order_item`. Flagged for a product decision rather than scraped. |

## Live counts observed (drift note)

Active orders now read **1,026** at source (was 1,044 profiled / 1,054 staged) — the active set changes daily as plans start/expire, which explains the earlier ±10 reconciliation differences. Order statuses at source: Active 1,026 + Expire 17,213 + Pause/cancel/pending ≈ the 19,465 already in staging.

## Extractor

`tools/legacy-full-migration/legacy-detail-extract.mjs` — read-only, GET-only allowlist, throttled (1.2s), resumable, raw-HTML capture + structured parse. See the tool README for safety properties.

## Run status (this session)

- **Products: 1,296 — extracted and parsed.** ✅
- **Order index (all statuses): ~19,465 order_number↔internal_id pairs — extracted.** ✅
- **Order view detail (delivery + payment): running in the background** (active orders first, then history; ~6h at 1.2s throttle for all ~19,465). Output is written **outside the repo** (PII; never committed); meals page captured raw for a 30-order sample only.

## Next (after extraction completes)

Normalize (delivery method → reason/master mapping; area → `area` master; payment detail → `payment_record`), validate, and **dry-run** an import. **No staging apply** until the sponsor authorizes `MIGRATION_APPLY=true`. Then re-reconcile so MM-02 (deliveries) and MM-09 (products) can move from gap to closed, and decide the per-meal `order_item` question (MM-01).
