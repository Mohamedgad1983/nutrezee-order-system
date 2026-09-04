# 27 — Retry Failed Last-90 Scrape Orders (http_500) on the VPS

> **Phase 6 / Part B.** Retried the remaining retryable `http_500` legacy meal-history fetch
> failures on the VPS with `--resume`. **All remaining failures succeeded on retry: 0 failures left.**
> Last-90 scrape coverage is now **4,927 / 4,927 = 100%**. Ran on the VPS host only; no local scrape;
> no raw artifacts in git; no credentials/PII printed.

## Correction to the doc-26 failure count (5, not 6)

Doc 26 narrated **6** retryable failures and listed `19667, 20275, 20975, 22234, 22403, 23214`. The
**live manifest** (source of truth) showed only **5** still-failing at the start of this sprint:
`19667, 20275, 20975, 22234, 22403`. Order **23214** had already recovered to `http_200` during the
prior session's resumed run — it has a raw artifact and a success manifest line — so it was already one
of the 4,922 successes. Reconciliation: 4,922 successes + 5 failures = 4,927 candidates (the doc-26
"6" double-counted 23214). The retry below therefore correctly targeted exactly the **5** orders that
had no raw artifact.

## VPS execution proof (the required proofs)
| # | Requirement | Evidence |
|---|---|---|
| Host | Ran on the VPS | host `vmi3360590` (Linux x86_64); `node v24.16.0`; launched via the reviewed wrapper `run-meal-history-scrape.sh` |
| Output path | `/opt/nutrezee/legacy-meal-history/raw` | wrapper `OUTPUT_DIR` default = approved VPS raw path; 5 new `meals_*.html.gz` written there |
| Credentials | From VPS env, not printed | `set -a; source /opt/nutrezee/legacy-migration.env; set +a` (holds `LEGACY_*`); cookie never logged |
| No raw in git | `/opt/nutrezee` is **not** a git repo | `test -d /opt/nutrezee/.git` → not a repo; nothing committed |
| Resume skipped completes | 4,922 already-scraped skipped | `duplicate_skipped = 4922`; `requests_attempted = 5` (only the missing 5 fetched) |
| Only failures targeted | The 5 ids each had 0 raw files before | resume's `existingFor()` skips any id with a `meals_<id>_*` file → only the 5 fetched |
| No local scraping | scraper VPS-context guard | requires `/opt/nutrezee` present **AND** `SCRAPE_ON_VPS=1`; refuses off-VPS |

The reviewed scraper/lib on the VPS are **byte-identical** to the repo (`sha256` match for
`meal-history-scrape-job.mjs` `41da851f…`, `meal-history-lib.mjs` `d06e3f47…`).

## Retry command (VPS wrapper, resume, all candidates considered)
```
LIMIT=1000000 CONCURRENCY=1 RATE_MS=1500 WINDOW=last-90 \
  /opt/nutrezee/legacy-meal-history/run-meal-history-scrape.sh
# wrapper → SCRAPE_ON_VPS=1 node meal-history-scrape-job.mjs --mode scrape --target staging
#   --window last-90 --limit 1000000 --concurrency 1 --rate-limit-ms 1500 --resume --no-local
#   --orders-source extract --output-dir /opt/nutrezee/legacy-meal-history/raw
```
`LIMIT` was raised above the candidate count so `--resume` would scan **all** 4,927 candidates (the
wrapper's default `LIMIT=10` would only see the first 10, all already scraped, and never reach the 5).

## Scrape SUMMARY (counts only; wrapper rc=0)
| field | value |
|---|---|
| records_candidate | 4,927 |
| requests_attempted | **5** (resume skipped the rest) |
| requests_success | **5** |
| requests_failed | **0** |
| raw_files_written | **5** |
| parse_success / parse_failed | **5 / 0** |
| meal_days_found (parsed, all dates) | **84** |
| duplicate_skipped (resume) | **4,922** |
| concurrency / rate_limit_ms | 1 / 1500 |
| window | last-90 (`2026-03-19` → `2026-06-17`) |
| duration_ms | 68,465 (~68 s) |
| ok | **true** |

## Per-retried-order outcome (was http_500 → now http_200, parse ok)
| internal_id | before | after | parse | meal_days (parsed) | bytes |
|---|---|---|---|---|---|
| 19667 | http_500 | http_200 | ok | 31 | 26,370,760 |
| 20275 | http_500 | http_200 | ok | 2 | 54,012 |
| 20975 | http_500 | http_200 | ok | 21 | 21,371,505 |
| 22234 | http_500 | http_200 | ok | 28 | 26,126,020 |
| 22403 | http_500 | http_200 | ok | 2 | 54,012 |

Sum of parsed meal-days = **84** (matches `meal_days_found`). In-window (last-90) subset = **72**
(see doc 28 / 29). The 12 out-of-window days are older plan dates, correctly excluded by the importer.

## Coverage before → after
| metric | before | after |
|---|---|---|
| raw `.html.gz` artifacts | 4,922 | **4,927** (+5) |
| manifest lines | 4,928 | **4,933** (+5 success lines) |
| distinct candidates with a manifest outcome | 4,927 | 4,927 (no silent missing) |
| latest-per-id `http_500` failures | 5 | **0** |

## PII / secret leak check (logs)
```
cookie/set-cookie/password/session hits in scrape.log : 0
cookie/password hits in run-history.jsonl             : 0
email-like strings in scrape.log                      : 0
```
Raw artifacts (which contain PII) remain on the VPS only; the manifest and run-history carry
ids/counts only.

## Result
The last-90 retry gap is **closed at the scrape layer**: 4,927/4,927 candidates scraped, **0**
remaining `http_500` failures, 0 silent drops. Newly scraped artifacts are archived into PostgreSQL in
docs 28–30.
</content>
