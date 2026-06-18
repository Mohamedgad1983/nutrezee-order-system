# 47 — m22 Master Closure Report

> **STATUS: PARTIAL.** Every order-independent closure stage is complete, gated, and committed. The
> **last-year scrape is in flight** on the VPS (resumable, ~5–6 h, bounded by legacy-server latency)
> and its import/apply/reconcile follow on completion. **Full-history is deferred** with a documented
> go/no-go gate. The 77 `missing_order_link` exceptions are **blocked on the order-sync track**
> (deterministic repair is impossible from meal-history — the order extract has no phone), not on any
> meal-history defect. No production, no UI, no timers enabled, no fabricated links.

## Commit
- branch `migration/legacy-full-clone-reconciliation`; latest `4e10be1` (+ doc commits).
- starting commit this run: `efe141f`.

## DB state (staging, current)
| table | rows |
|---|---|
| `legacy_meal_history_raw` | 4,987 |
| `customer_meal_history` | 4,955 |
| `customer_meal_history_items` | 67,908 |
| `customer_meal_history_exceptions` (open) | 77 |
| `customer_meal_history_import_runs` | 8 |
| distinct customers with meal history | 2,628 |

(Last-year import will add to these once the scrape completes.)

## Stage outcomes
| stage | outcome |
|---|---|
| 0 — baseline | ✅ staging confirmed (doc 33) |
| 1 — order-sync completeness | ⛔ **BLOCKED (deterministic)** — 77 exceptions / 40 orders; 0/40 in `sync_record`; order extract has no phone → `would_create=0`; 17 are MER placeholder/reversed, 23 are newer than watermark 24,630. No order-core mutation. (doc 34) |
| 2 — relink | ✅ dry-run `resolvable=0` (carried forward; doc 35) |
| 3 — last-year sizing | ✅ 13,453 candidates, ~8.5k new, GO (doc 36) |
| 4 — last-year scrape | 🔄 **IN PROGRESS** (resumable, ~5–6 h; doc 37) |
| 5 — last-year import dry-run | ⏳ pending scrape completion (doc 38) |
| 6 — last-year apply guard | ✅ widened + tested (`APPLY_LAST_YEAR_STAGING`; doc 39) |
| 7 — last-year gated apply | ⏳ pending dry-run (doc 40) |
| 8 — last-year reconciliation | ⏳ pending apply (doc 41) |
| 9 — full-history go/no-go | ✅ **DEFER** (documented gate; doc 42) |
| 10 — full-history batches | ⛔ not executed (deferred by Stage 9) |
| 11 — incremental sync | ✅ built + validated + **DISABLED** (doc 46) |
| 12 — closure | ✅ this report + gates + commit |

## Exceptions (unchanged this run)
- total **77**, all `missing_order_link`, 40 distinct orders.
- order-sync related: **40/40** (orders absent from `sync_record`).
- non-deterministic (MER): 16 `placeholder_phone` + 1 `reversed_dates` (incl. `#24629`).
- repair plan: order-sync track lands a **fresh full-detail order re-pull** (with phone/amount) →
  governed M19 import creates the deterministically-linkable orders in `sync_record` → meal-history
  **relink** (doc 35 tool) auto-promotes the archived meal-days. Manual MER review for placeholder/
  reversed cases. **No phone/name matching, ever.**

## What was intentionally NOT done (and why)
- **No order-core / customer-core mutation** — the only safe order-sync apply path is the gated M19
  import over a full-detail extract that does not yet exist; forcing creation would require
  phone/name guessing (forbidden).
- **No full-history transfer** — runtime ~14 h + poor link yield until order-sync improves (doc 42).
- **No timer enabled** — scrape and the new incremental-sync ship manual/disabled.
- **No per-dish ajax, no WhatsApp, no production, no UI.**

## Exact next steps (resumable)
1. **Finish last-year scrape** (auto-running): on interruption re-run
   `ALLOW_FULL_HISTORY_SCRAPE=1 LIMIT=2000000 CONCURRENCY=3 RATE_MS=1000 WINDOW=last-year /opt/nutrezee/legacy-meal-history/run-meal-history-scrape.sh`
   then a `--resume` pass to clear residual `http_500`s.
2. **Stage 5** importer dry-run `MEAL_IMPORT_SCOPE=last_year` (no token; reads VPS raw dir).
3. **Stage 7** gated apply with `MEAL_IMPORT_SCOPE=last_year` + `MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_YEAR_STAGING`
   + `MEAL_IMPORT_SOURCE_VPS=1` (re-upload the reviewed importer first; pre-apply backup).
4. **Stage 8** reconciliation + idempotency (docs 41).
5. Then re-evaluate **full-history** per doc 42 (precondition: order-sync completeness).

## Management summary
The recent-history meal data (last-90) is fully transferred, reconciled, and idempotent (Phase 6).
This run added the **why** behind the 77 unlinked records (they are orders the legacy system never gave
us valid customer phones for — a known data-quality reality, safely archived and recoverable, never
guessed), prepared and tested the **last-year** apply path, started the **last-year** bulk transfer
(running safely on the server, finishing on its own), built an **ongoing-sync** mechanism (kept off
until approved), and made a documented **defer** decision on the full multi-year backfill (too long to
run in one go and dependent on improving order data first). Nothing risky was done to live or core
data.
</content>
