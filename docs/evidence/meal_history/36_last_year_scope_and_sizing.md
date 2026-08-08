# 36 — Last-Year Scope & Sizing

> **Stage 3. Decision: GO** — run last-year as one resumable, detached VPS scrape. Bounded (~8.5k new
> fetches, ~1.5 GB), well within disk/runtime limits. Not full-history.

## Window
- scope `last_year` → **2025-06-18 → 2026-06-18** (365 days, computed by the scraper).

## Candidate sizing (scraper dry-run, no fetch)
| window | candidates |
|---|---|
| last-90 (today) | 4,915 |
| **last-year** | **13,453** |
| all (full history) | 20,593 |

- already scraped (raw artifacts) = **4,927** — all within last-year (last-90 ⊆ last-year), so `--resume`
  skips them.
- **new last-year fetches ≈ 13,453 − 4,927 = ~8,526 orders.**

## Resource estimates
| dimension | estimate | basis |
|---|---|---|
| new raw storage | ~1.5 GB (≈8,526 × 178 KB avg) | last-90 = 858 MB / 4,927 files |
| total raw after | ~2.4 GB | 858 MB + ~1.5 GB |
| disk headroom | **172 GB free** — trivial | `df` |
| scrape runtime | ~45–60 min (conc 3, rate 1000 ms ≈ 3 fetch/s) + resume scan | detached/resumable |
| import parse/pass | ~25–35 min/pass × 3 passes (dry-run/apply/idempotency) | importer re-parses full corpus |
| apply DB writes | ~30–40 min | last-90 apply 4,549 orders/64k items = 19 min |
| exception rate (est.) | **2–8%** [Inferred] | last-90 = 1.55%; MER holds 1,272 non-deterministic across all history |

The exception estimate is **Inferred** — older orders are mostly below the order-sync watermark
(24,630) and already synced, but `migration_exception_review` holds 1,272 placeholder/duplicate-phone
orders scattered across history; any of those with meal-days in-window will land as `missing_order_link`
exceptions (archived, **not** silent drops).

## Safety confirmations
- **disk:** 172 GB free — ✓
- **rate-limit:** 1000 ms, concurrency 3 (gentle; last-90 saw only 5/4,549 transient 500s, all
  retryable) — ✓
- **resume:** `--resume` skips the 4,927 already-scraped; reruns re-fetch only missing — ✓
- **detached/resumable:** run via the reviewed wrapper under `nohup`; survives disconnect — ✓
- **no timer:** scrape stays manual; no timer enabled — ✓
- **raw outside git:** output under `/opt/nutrezee/legacy-meal-history/raw`; never committed — ✓
- **gate flag:** last-year exceeds the 100-day span cap, so it requires the deliberate
  `ALLOW_FULL_HISTORY_SCRAPE=1` (and the wrapper's matching guard) — applied consciously for last-year
  only, **not** full-history.

## Gate
Runtime/storage acceptable → **proceed to Stage 4** (last-year VPS scrape). Run as a single resumable
detached job (8.5k is bounded; no batching needed for last-year — batching is reserved for
full-history, Stage 10).
</content>
