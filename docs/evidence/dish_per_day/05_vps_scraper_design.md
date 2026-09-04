# 05 — VPS Scraper Design (built, DISABLED)

> `tools/legacy-full-migration/dish-detail-scrape-job.mjs` + `ops/systemd/run-dish-detail-scrape.sh` +
> `ops/systemd/nutrezee-dish-detail-scrape.service`. **Built and syntax-checked; NOT run this session**
> (m22 last-year scrape is active → no compounding legacy load; and the per-customer assignment endpoint
> is unconfirmed — doc 01). No timer.

## What it targets (read-only, confirmed)
The **catalog** endpoint `/orders/getMealsByType` (POST `{meal_type_id, main_sub_package_id, req_date}`
→ selectable dishes HTML). This is the menu/dish-reference layer (maps dish ids ↔ dish names per
type/subpackage/date). It is **not** the per-customer assignment (which is not exposed; doc 01).

## Guards (mirroring the proven m22 scraper)
- `--target staging` only (production refused); `SCRAPE_ON_VPS=1` + `/opt/nutrezee` required for scrape
  (no local scraping); `--no-local` required.
- **READ-ONLY allowlist** (`getMealsByType`, `getMealsDateWiseFilter`) + an explicit **mutation deny-list**
  (`addMealByAdmin|editMeal|deletemeal*|assignDriver|saveMeal|updateMeal`) — mutation endpoints are
  hard-blocked even if mis-passed.
- legacy host pinned via `LEGACY_HOST_ALLOWLIST`; credentials sourced from VPS env, **never printed**;
  cookie never logged.
- modes: `dry-run` (default, no fetch) / `scrape`; windows: sample/last-7/last-30/last-90/last-year/custom;
  `--limit`, `--concurrency` (cap 4), `--rate-limit-ms`, `--resume`.
- output → `/opt/nutrezee/dish-per-day/raw`; run-history → `/opt/nutrezee/dish-per-day/run-history.jsonl`
  (counts only); raw artifacts **never committed**.
- candidate params come from `catalog-params.jsonl` (derived from grid slots: meal_type_id /
  main_sub_package_id / req_date) — if a candidate lacks required params it is **skipped/exception**, never
  guessed.

## Service
`nutrezee-dish-detail-scrape.service` — oneshot, `flock -n` overlap guard, **no `[Install]`, no `.timer`**
→ manual `systemctl start` only, DISABLED until a deliberate, signed-off decision **after** the m22 scrape
finishes.

## Not run — why
1. **Legacy load:** the m22 last-year scrape is hammering the same host; a second scraper would compound it.
2. **Wrong layer for the goal:** the catalog gives the menu, not the per-customer dish-per-day the business
   asked for. The per-customer assignment source is unconfirmed (doc 01) and needs a separate small live
   discovery first.
</content>
