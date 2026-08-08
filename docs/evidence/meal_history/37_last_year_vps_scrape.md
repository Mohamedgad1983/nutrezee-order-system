# 37 — Last-Year VPS Scrape (IN PROGRESS, resumable)

> **Stage 4. Status: RUNNING / resumable.** The last-year meal-history scrape is executing on the VPS
> (host `vmi3360590`), output under `/opt/nutrezee/legacy-meal-history/raw`, `--resume` enabled. It is
> bounded by legacy-server latency (~5 s/request at a polite rate) and will take **~5–6 h** wall-clock
> to fetch the ~8.5k new orders — longer than a single session. It is detached (`nohup`) and survives
> disconnect; on restart `--resume` skips everything already fetched. **No local scraping; no raw in
> git; no credentials printed; no per-dish ajax.**

## Command (reviewed wrapper, VPS-only)
```
ALLOW_FULL_HISTORY_SCRAPE=1 LIMIT=2000000 CONCURRENCY=3 RATE_MS=1000 WINDOW=last-year \
  /opt/nutrezee/legacy-meal-history/run-meal-history-scrape.sh
# -> SCRAPE_ON_VPS=1 node meal-history-scrape-job.mjs --mode scrape --target staging --window last-year
#    --limit 2000000 --concurrency 3 --rate-limit-ms 1000 --resume --no-local --orders-source extract
#    --output-dir /opt/nutrezee/legacy-meal-history/raw
```
- Window: **2025-06-18 → 2026-06-18** (365 days). The last-year span exceeds the 100-day cap, so it
  requires the deliberate `ALLOW_FULL_HISTORY_SCRAPE=1` (applied for last-year only, not full-history).
- Scraper SHA on the VPS = repo (`41da851f…`), byte-verified.

## Progress snapshot (interim — will be finalized on completion)
| metric | value |
|---|---|
| last-year candidates | 13,453 |
| already scraped (resume-skipped) | 4,927 |
| **new to fetch** | **~8,526** |
| fetched so far | ~413 (4.8%) [snapshot] |
| measured rate | ~0.47 fetch/s |
| transient `http_500` so far | 2 (retryable, manifest-recorded) |
| raw size | ~900 MB / 172 GB free |
| ETA | ~5.6 h from snapshot |

## Completion criteria (Stage 4 gate — not yet met)
- every last-year candidate has a manifest outcome (success raw artifact **or** a recorded retryable
  failure) — **no silent missing**;
- residual `http_500` failures retried via a `--resume` pass (as in Phase 6) until 0 or documented;
- final SUMMARY captured to `run-history.jsonl` (counts only); PII/secret scan = 0.

## How this completes (next step, automatic-resumable)
The scrape continues on the VPS to completion (~5–6 h). To resume after any interruption, re-run the
exact command above (idempotent via `--resume`). When `requests_failed=0` (or only documented
retryables remain) and every candidate has a manifest outcome, proceed to **Stage 5** (importer
dry-run, `MEAL_IMPORT_SCOPE=last_year`), then **Stage 7** gated apply (`APPLY_LAST_YEAR_STAGING`,
guard already shipped — doc 39), then **Stage 8** reconciliation + idempotency.

> This run intentionally does **not** block on the multi-hour scrape; all order-independent work
> (order-sync analysis, relink, apply guard, incremental-sync, full-history go/no-go) is complete and
> committed. Last-year import/apply/reconcile (docs 38, 40, 41) follow scrape completion.
</content>
