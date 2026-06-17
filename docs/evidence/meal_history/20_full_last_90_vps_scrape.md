# 20 — Full Last-90 VPS Scrape (checkpointed, resumable)

> **Status: PARTIAL scrape, clean checkpoint.** The full last-90 window is **4,927** candidate orders;
> the legacy meal grids are huge (median **13.7 MB/page**, ~5.3 s/fetch), so a full scrape is a
> ~2.7-hour / ~63 GB background batch. This sprint scraped **373** orders to a stable checkpoint and
> proves **100% DB storage of that set** (Parts 21–23). The remaining **4,554** are resumable (the
> `--resume` skip is proven). No local scraping. No secrets/PII in logs. Artifacts not committed.

## Scrape run (VPS host, GET-only, throttled)
```
node meal-history-scrape-job.mjs --mode scrape --target staging --window last-90 \
  --concurrency 3 --rate-limit-ms 1000 --resume --no-local --orders-source extract \
  --output-dir /opt/nutrezee/legacy-meal-history/raw       # creds sourced from VPS env, never printed
```
Launched detached (nohup), stopped at a checkpoint, then frozen for a stable apply.

| field | value |
|---|---|
| window | last-90 = 2026-03-19 → 2026-06-17 |
| candidate_orders | **4,927** |
| requests_attempted (this + prior Phase-4) | **374** (distinct internal_ids) |
| requests_success (http200 + parse ok) | **373** |
| requests_failed | **1** (http_500) |
| raw_files_written | **373** `meals_<internal>_<order>_<sha8>.html.gz` |
| parse_success / parse_failed | **373 / 0** |
| duplicate_skipped (resume) | proven (Phase-4: 10 skipped on re-run) |
| meal_days_found | thousands (3,361 in-window across the 373) |
| output_dir | `/opt/nutrezee/legacy-meal-history/raw` |
| run_history_path | `/opt/nutrezee/legacy-meal-history/run-history.jsonl` (counts-only) |

## Every candidate that was ATTEMPTED has an outcome (no silent drop)
Manifest (`raw/manifest.jsonl`, ids/counts only): **374 distinct internal_ids**, each with an outcome:
- **373** `http_200` + `parse_status=ok` (success)
- **1** `http_500` → `error_code=http_500`, internal_id **23214** / order **24174** — a transient
  legacy-server error, **retryable** (no file written, so `--resume` re-fetches it).
- **0** parse-failed among successful fetches.

> The **un-attempted** 4,554 candidates are explicitly **remaining-to-scrape**, not dropped — they are
> the resumable tail. The scraper resumes from the manifest without re-fetching the 373 already done.

## Safety verification
- artifacts NOT committed — `/opt/nutrezee/legacy-meal-history/raw` is outside any git repo.
- run-history + manifest: **counts/ids only**, no name/phone (proven: manifest keys =
  `internal_id, order_number, http_status, bytes, raw_sha, fetched_at, duration_ms, parse_status,
  meal_day_count, error_code`).
- credentials/cookies never printed; sourced from `/opt/nutrezee/legacy-migration.env`.
- output path VPS-approved; secondary `getMeals` per-dish endpoint NOT scraped (out of scope).
- disk: 59 MB used of 175 GB free at checkpoint.

## Resume / total coverage
To continue toward full coverage: re-run the same command (`--resume`) — it skips the 373 already
present and fetches the remaining 4,554, then the importer applies the new artifacts idempotently
(doc 21–22). The DB-storage proof in this sprint is **complete for the 373 scraped orders**; total
last-90 coverage is the documented next step.
