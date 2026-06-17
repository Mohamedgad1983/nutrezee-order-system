# 25 — m22 Phase 5 Sprint Close Report

> Sprint: **Full Last-90 VPS Scrape + PostgreSQL DB Storage + Gated Apply + Validation**. Branch
> `migration/legacy-full-clone-reconciliation`. **No bridge. No UI. No full/last-year/all import. No
> timer. No production. No PII in logs.**

## Management-readable summary
The customer meal-history transfer now lands in the database, not just in files. We scraped real
last-90 meal grids from the legacy system on the server, loaded them into PostgreSQL through the
governed pipeline, and **proved that every successfully scraped record is stored** — as a raw archive
row, a clean meal-history row, or an exception — with **zero silent drops**, and that re-running
changes nothing (idempotent). The last-90 window is large (4,927 orders, ~2.7 hours of throttled
scraping); we completed a stable **373-order checkpoint** and proved 100% DB storage of it. The rest
is queued to resume. The data is now queryable from PostgreSQL by customer, order, and date.

## What was completed
- Full-last-90 scrape **initiated** on the VPS; checkpointed at **373/4,927** (resumable) — doc 20.
- Importer **dry-run** over the 373 artifacts: ok, dedup_checked, 0 invalid/dup — doc 21.
- Apply guard **widened** to `last_90_days` (gated; per-scope token + VPS-source + version≥0019) + tests.
- **Gated last-90 apply** to PostgreSQL (run `01KVATTQ6YF7GMD555STHYZZM2`) — doc 22.
- **DB storage proven 100%** for the 373 scraped orders (raw 373/373, clean+exception accounts for
  every parsed in-window meal-day, 0 silent drops, idempotent) — doc 22.
- **Validation V1–V10 all PASS**, adversarially re-verified — doc 23.
- Relink dry-run (still blocked on order-sync) + a count-bug found & fixed — doc 24.
- Full gates green; commits pushed.

## Scrape totals
candidate 4,927 · attempted 374 · success 373 · failed 1 (http_500, retryable) · raw files 373 ·
parse 373/0 · remaining 4,554 (resumable).

## DB storage totals (before → after)
raw 60→**433** · parents 60→**431** · clean items 211→**3565** · exceptions 28→**31** (all open) ·
import_runs 2→4. This run: raw 373 / clean items 3354 (+4 existing = 3358) / exceptions 3.

## Validation result
V1–V10 all PASS. Reconciliation: `parsed_in_window (3363) = clean (3358) + exceptions (5)`; raw
coverage 373/373 (0 missing); dup raw 0; dup meal-days 0; idempotent. **DB storage confirmed: YES**
(for the in-scope 373 scraped orders).

## DB storage confirmed?
**Yes — 100% for the in-scope (successfully scraped) records.** Not file-only: queryable from
PostgreSQL. The 4,554 un-scraped candidates are an explicit resumable tail, not silent drops.

## Remaining exceptions
31 `missing_order_link` (all open). 24 distinct orders — all not in `sync_record`: 23 above watermark
(not-yet-synced) + #24629 (placeholder-phone, manual). Repair = the deterministic relink pass after
order-sync advances (doc 14/24). None forced into clean tables.

## Is last-90 accepted?
**The 373-order checkpoint is ACCEPTED as stored in DB.** Full last-90 acceptance awaits completing
the resumable scrape of the remaining 4,554 and the (idempotent) apply over them.

## What was intentionally NOT done
full / last-year / all-history scrape or import; the remaining 4,554 last-90 orders (resumable);
order-sync apply (unwired); #24629 repair (non-deterministic); secondary per-dish `getMeals` scrape;
any UI; any timer/scheduled scrape; any production touch; committing raw artifacts.

## Risks
- Full last-90 scrape is a multi-hour / ~63 GB live batch — run resumably, off-peak.
- Group-A/#24629 exceptions wait on order-sync completeness (separate track).
- 13 MB median pages make scraping bandwidth-bound, not throttle-bound.

## Next safe step
1. **Resume the scrape** (`--resume`) to fetch the remaining 4,554 last-90 orders (idempotent, skips
   the 373 done). 2. Importer **dry-run** then **gated last-90 apply** over the new artifacts
   (idempotent). 3. Re-run V1–V10 reconciliation for full coverage. 4. Advance order-sync, then the
   relink **apply** to absorb the 31 exceptions. No full-history, no UI, no timer.
