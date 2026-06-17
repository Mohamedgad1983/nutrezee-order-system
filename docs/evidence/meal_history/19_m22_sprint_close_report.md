# 19 — m22 Phase 4 Sprint Close Report

> Sprint: **VPS Meal-History Scrape Job + Exception Relink + Last-90 Readiness**. Branch
> `migration/legacy-full-clone-reconciliation`. **No bridge. No UI. No full/last-year/all import. No
> scheduled sync. No timer enablement. No production. No PII in logs.**

## Management-readable summary
We can now pull customer meal history from the legacy system **on the server, safely and
repeatably**, and load it into the new database in **controlled windows**. This sprint built and
proved (on staging) two tools: a **deterministic relink** that automatically attaches meal history to
the right order once that order is migrated, and a **VPS-only scraper** that fetches the legacy meal
grids read-only, rate-limited, with no customer names/phones in any log. We scraped a 50-order sample
live, confirmed it parses cleanly, and **sized the next window (last-90 days): ~199 clean meal-days
from 50 orders, ~1.5% exceptions, zero errors**. We deliberately did **not** import the last-90 set
yet (that is the next task) and did **not** schedule anything. The 28 existing exceptions remain
**explained and recoverable** — they are simply orders not yet migrated by order-sync.

## What was completed
- **Order-sync dependency analysis** (doc 13): 24 exception orders confirmed not in `sync_record`;
  #24629 is a non-deterministic placeholder-phone case (not repairable by rule).
- **Deterministic relink job** + migration **0019** (resolution columns) + tests (doc 14); **proven
  on staging** dry-run (doc 15).
- **VPS-only scraper** + systemd service + wrapper + 10 tests (doc 16); **hardened** after an
  adversarial security review (3 HIGH bypasses fixed).
- **Live VPS scrape proof** (doc 17): 50 real orders, GET-only, throttled, resume/idempotency proven,
  0 PII in manifest/run-history.
- **Last-90 dry-run sizing** (doc 18): 199 clean / 3 exceptions / ok, from scraped artifacts.
- Full gates green; commits pushed.

## What was intentionally NOT done
last-90/last-year/full **apply**; order-sync apply (dry-run only, not wired); #24629 repair (would
require non-deterministic customer resolution); any UI; any timer/scheduled scrape or sync; any
production touch; committing raw artifacts or any PII.

## Current DB state (staging, version 0019)
raw 60 · parent 60 · items 211 · exceptions 28 (all `open`, `missing_order_link`) · import_runs 2.
**Unchanged by this sprint** (relink dry-run + import dry-run wrote nothing). customer_order 20,104 /
customer 19,476 untouched. Backups: `pre-m22-deploy-…`, `pre-m22-0019-…`.

## Scraper status
Built, hardened, **proven live** on the VPS host (50 orders). systemd unit present but **disabled, no
timer**. Manual, rate-limited, resumable. Artifacts on `/opt/nutrezee/legacy-meal-history/raw` (50
files), not committed.

## Relink status
Built + tested + deployed (0019). Dry-run on staging: **resolvable 0 / 24** — **BLOCKED on order-sync
completeness** (orders not yet in `sync_record`). Will promote automatically once order-sync advances.

## Exception status
28 `missing_order_link` / 24 orders, all `open`. Group A (23) above watermark = not-yet-synced; Group
B (1, #24629) = placeholder-phone, manual. None forced into clean tables. Deterministic repair path
documented (doc 11/14).

## Last-90 readiness
**Sized and ready, not applied.** 50-order sample → 199 clean / 3 exceptions / 0 invalid / ok=true.
Full last-90 = 4,927 orders (scrape resumably first). Acceptance criteria met (doc 18).

## Risks
- Full last-90 scrape is ~100 min of throttled live GETs — run resumably, off-peak; legacy server load.
- Apply-scope for last-90 is code-locked to last_30_days — widening is a deliberate guarded change.
- #24629 and any placeholder-phone orders need an operations decision (manual customer resolution).
- Order-sync apply remains unwired — Group-A relink stays blocked until that lands.

## Exact next step
1. Complete the full **last-90 scrape** (resumable) on the VPS. 2. Importer **dry-run** over the full
set; confirm ok + low exceptions. 3. Widen the importer apply guard to allow `last_90_days` (keep
staging + explicit-confirm), then run the **gated last-90 apply**. 4. Advance order-sync, then run
`meal-history-relink` (gated apply) to absorb residual exceptions.

## Sprint close decision
**Closed: yes** — every key deliverable is built, proven on the VPS (or blocked only by order-sync
completeness, as anticipated), gates pass, docs written, commits pushed. No bridge, no UI, no full
import.
