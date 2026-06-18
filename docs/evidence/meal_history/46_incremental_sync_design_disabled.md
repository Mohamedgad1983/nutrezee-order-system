# 46 — Meal-History Incremental Sync (Design, DISABLED)

> **Stage 11.** Built a **read-only, dry-run, DISABLED** incremental meal-history sync — separate from
> the order sync, with its own run-history. It detects orders whose meal-history is not yet archived
> (vs the m22 raw watermark) and reports what a sync would do. It **never applies, never scrapes the
> legacy site, never sends WhatsApp, never touches per-dish ajax, never touches production.** No timer.

## Components (all in the repo; planner + wrapper deployed to the VPS, disabled)
| file | role |
|---|---|
| `tools/legacy-full-migration/meal-history-incremental-sync.mjs` | dry-run **planner** — diffs new orders vs the `legacy_meal_history_raw` watermark, reports counts |
| `ops/systemd/run-meal-history-sync.sh` | wrapper — staging, dry-run only, PG creds from VPS env (never printed), counts-only log, PID lock |
| `ops/systemd/nutrezee-meal-history-sync.service` | oneshot service, **no `[Install]`, no `.timer`** — manual `systemctl start` only |

## How it works (and what it deliberately does NOT do)
- **Watermark** = `max(source_record_id)` in `legacy_meal_history_raw` (highest legacy internal_id
  already archived). **Candidates** = orders in a bounded recent window (default 30 days,
  `SYNC_WINDOW_DAYS` 1..366) whose plan overlaps the window and are **not** yet archived.
- Reports `records_seen / already_archived / would_scrape / would_import / watermark / next_cursor`.
- **Separate trail:** its own `meal-history-sync-run-history.jsonl` (never mixed with the order sync).
- **No scrape, no apply here:** application is delegated to the already-gated tools, each with its own
  explicit token — `meal-history-scrape-job.mjs` (VPS GET scrape) then `meal-history-import.mjs`
  (`APPLY_LAST_*_STAGING` + `MEAL_IMPORT_SOURCE_VPS=1`). This planner only **diffs and reports**, so it
  is safe to schedule read-only.
- **No per-dish ajax** (never touches the secondary `getMeals`), **no WhatsApp**, **counts-only logs**.

## Guards (validated live on staging)
```
dry-run (staging, 30d): records_seen 2981 · already_archived 2967 · would_scrape 14 · would_import 14
                        watermark_internal_id 23720 · applied false · whatsapp_sent false · ok true
SYNC_MODE=apply        -> refused: apply is not permitted from this entrypoint (names the gated path + tokens)
SYNC_TARGET=production  -> refused: SYNC_TARGET must be 'staging' — no production
SYNC_WINDOW_DAYS<=0/>366-> refused: bounded window only (no unbounded incremental)
```
`would_scrape = 14` correctly identifies the recent orders past the current DB watermark (23720) that
the historical import has not yet archived — exactly the incremental gap an ongoing sync would close.

## Enablement status
- service **not enabled**, no timer exists (`systemctl is-enabled … → not-found`).
- **Do not enable** without a separate, signed-off decision. Even when enabled it stays **dry-run**;
  any apply goes through the gated scrape + import tools, never this scheduled job.

## Gate
Built + validated + disabled. No automatic enablement. ✓
</content>
