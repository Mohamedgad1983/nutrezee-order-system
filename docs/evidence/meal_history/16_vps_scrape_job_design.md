# 16 — VPS Meal-History Scrape Job (design)

> `tools/legacy-full-migration/meal-history-scrape-job.mjs` — VPS-ONLY GET scraper for the legacy
> date-wise meal grid. Stores raw compressed artifacts + a counts-only manifest on a VPS-approved
> path. NEVER runs locally, NEVER writes legacy, NEVER scrapes the secondary per-dish endpoint, NEVER
> logs credentials/cookies/PII. Archiving raw into the m22 DB is a separate step (importer, doc 18).

## Source
`GET /orders/getMealsDateWiseFilter/all/<internal_id>` — the only allowlisted URL (regex
`^/orders/getMealsDateWiseFilter/all/\d+$`). Mutation endpoints (`editMeal`/`deletemeal`/`assignDriver`)
and the secondary `getMeals` per-dish ajax are **never** called.

## CLI
`--mode dry-run|scrape|archive-only` · `--target staging` · `--window last-30|last-90|custom` ·
`--limit N` · `--since YYYY-MM-DD` · `--until YYYY-MM-DD` · `--concurrency N` · `--rate-limit-ms N` ·
`--resume` · `--no-local` · `--orders-source extract|db` · `--output-dir <approved>` · `--summary-json`.

## Guards (refuse, exit 2 — proven by tests)
| guard | rule |
|---|---|
| no production | `--target` required and must be `staging` |
| no full-history | `--window last-year/full/all` refused unless `ALLOW_FULL_HISTORY_SCRAPE=1` |
| concurrency cap | refuse `--concurrency > 4` |
| approved path | scrape/archive `--output-dir` must be under `/opt/nutrezee/legacy-meal-history` |
| no local scrape | scrape/archive require `--no-local` **and** VPS context (`/opt/nutrezee` present **and** `SCRAPE_ON_VPS=1`) |
| credentials | scrape requires `LEGACY_BASE_URL` + `LEGACY_ADMIN_EMAIL` + `LEGACY_ADMIN_PASSWORD` |

`dry-run` (candidate selection + counts only — no fetch, no file write) runs anywhere; only
`scrape`/`archive-only` enforce the VPS-context + path + no-local guards.

## Credentials / session
From env only (`LEGACY_BASE_URL`/`LEGACY_ADMIN_EMAIL`/`LEGACY_ADMIN_PASSWORD`; also accepts the
`LEGACY_BASE`/`LEGACY_EMAIL`/`LEGACY_PASS` aliases). **Never hardcoded, never printed; the session
cookie value is never logged.** The wrapper sources them from a VPS-only env file
(`/opt/nutrezee/legacy-migration.env`, not committed). If missing → BLOCKED with the required env names.

## Candidate selection
`--orders-source extract` (default): reads `orders_index.jsonl` (VPS), keeps orders whose plan
`[start,end]` overlaps the window, **preserving both `internal_id` and `order_number`**. `db` source
(window-filter `customer_order`, map to internal_id via the extract) is a documented future option.

## Output (on VPS, NOT committed)
- raw: `<output-dir>/meals_<internal_id>_<order_number>_<sha8>.html.gz` (gzipped lossless; contains
  PII → VPS-only).
- manifest: `<output-dir>/manifest.jsonl` — `{internal_id, order_number, http_status, bytes, raw_sha,
  fetched_at, duration_ms, parse_status, meal_day_count, error_code}` — **ids/counts only, no PII**.
- run-history: `/opt/nutrezee/legacy-meal-history/run-history.jsonl` — counts-only summary.

## Parsing (safe fields only)
Reuses `parseMealGrid` (lib): meal **dates**, meal **types**, legacy **meal_ids** (+ `order_meal_id`
when present). **No per-dish detail** (ajax-gated, out of scope this sprint).

## Behavior
Bounded-concurrency worker pool; `--rate-limit-ms` throttle between fetches; `--resume` skips
internal_ids already written (idempotent, no duplicate files); manifest row per attempt; retries with
backoff. Summary fields: `records_candidate · requests_attempted · requests_success · requests_failed
· raw_files_written · parse_success · parse_failed · meal_days_found · duplicate_skipped ·
resume_supported · duration_ms · ok`.

## systemd (built, DISABLED)
- `ops/systemd/nutrezee-meal-history-scrape.service` — `Type=oneshot`, flock-guarded, hardened, **no
  `[Install]`** (no timer enablement — scraping the live legacy admin is a deliberate manual action).
- `ops/systemd/run-meal-history-scrape.sh` — wrapper: flock + PID lock, sources creds from the VPS env
  file (never printed), fail-fast (non-staging / full-history / missing creds), counts-only log.
- **No timer file** by design — a recurring scrape of the live legacy production admin would be
  inappropriate. Manual, rate-limited, resumable runs only.

## Tests (`ts-i-scrape`, 8, green)
guards (missing/production target · concurrency cap · output-path · no-local/VPS-context ·
full-history) · **no credentials printed** · dry-run window selection (last-90 vs custom, deterministic).
