# 17 — VPS Scrape Job Execution (staging, live legacy)

> **Status: PROVEN on the VPS.** The scraper authenticated to the live legacy admin, fetched real
> meal grids (GET-only, throttled), stored compressed artifacts on the VPS-approved path, and proved
> resume/idempotency. No secrets printed. No PII in manifest/run-history. Artifacts not committed.

## Pre-run: adversarial security review + hardening
A 5-agent review (credential-leak, PII, guard-bypass, GET-only/rate) found **0 credential/PII leaks**
but **3 HIGH guard-bypasses** — all fixed before the live run:
1. full-history evasion via `--since` / unknown `--window` → now gated on the **computed span**
   (`SPAN_CAP_DAYS=100`; unknown windows rejected). 2. unpinned host (only `--target` label checked) →
   **`LEGACY_HOST_ALLOWLIST` host pin** (default `nutreeze.com`). 3. unguarded off-VPS `RUN_HISTORY`
   write in dry-run → run-history written **only on the VPS** under the approved tree. Plus MEDIUM
   (OUTPUT_DIR `startsWith` → `path.resolve` + sep) and LOW (non-integer concurrency rejected).
Re-verified: each bypass now refuses (tests `ts-i-scrape`, 10 green).

## Runtime placement (corrected)
The scraper has **no DB dependency** (pure Node builtins) and writes host paths under `/opt/nutrezee`,
so it runs on the **VPS host** with plain `node v24` — **not** inside the api container (whose fs has
no `/opt/nutrezee`). Staged at `/opt/nutrezee/legacy-meal-history/{meal-history-scrape-job.mjs,
meal-history-lib.mjs,run-meal-history-scrape.sh}`.

## Proof sequence
| step | command (host) | result |
|---|---|---|
| dry-run candidates | `--mode dry-run --window last-90 --until 2026-06-17` | **records_candidate 4927**, window 2026-03-19→2026-06-17, ok |
| limited scrape | `--mode scrape --window last-90 --limit 10 --concurrency 1 --rate-limit-ms 1200 --resume --no-local` | attempted 10 / success 10 / failed 0 · raw 10 · parse 10/0 · **meal_days 94** · dup 0 · 41s · ok |
| controlled scrape | `--mode scrape --window last-90 --limit 50 --concurrency 2 --rate-limit-ms 1000 --resume …` | attempted **40** / success 40 / failed 0 · raw 40 · parse 40/0 · **meal_days 443** · **dup_skipped 10** (resume) · 87s · ok |

Credentials sourced from `/opt/nutrezee/legacy-migration.env` (never printed; cookie never logged).

## Artifact + safety verification
| check | result |
|---|---|
| raw artifacts on VPS | **50** `meals_<internal_id>_<order_number>_<sha8>.html.gz` under `/opt/nutrezee/legacy-meal-history/raw` |
| committed? | **no** — path is outside any git repo |
| manifest keys | `internal_id, order_number, http_status, bytes, raw_sha, fetched_at, duration_ms, parse_status, meal_day_count, error_code` — **ids/counts only** |
| manifest PII (Kuwait phone / name keys) | **0** (the broad `[0-9]{8,}` hits were `bytes` page-sizes up to 32MB + `raw_sha` hex runs, not phones) |
| run-history PII | **0** — counts-only summary |
| resume/idempotency | **proven** — 2nd run `duplicate_skipped=10`, no re-fetch, no duplicate files |
| credentials/session | present on VPS (`LEGACY_BASE_URL`/`LEGACY_ADMIN_EMAIL`/`LEGACY_ADMIN_PASSWORD`); never printed |

## systemd
`ops/systemd/nutrezee-meal-history-scrape.service` (oneshot, flock, hardened, **no `[Install]`**) +
`run-meal-history-scrape.sh` (flock + PID lock, sources creds, fail-fast, counts-only log). **No
timer** — scraping the live legacy admin is deliberate/manual, never scheduled. Not enabled.

## Note
A full last-90 scrape is **4,927** throttled GETs (~100 min at conc-1/1200ms) — run deliberately and
**resumably** (the `--resume` skip is proven). This sprint proved the mechanism on a 50-order sample.
