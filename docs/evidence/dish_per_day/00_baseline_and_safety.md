# 00 — m23 Baseline & Safety

> **Read-only discovery + foundation build.** Target **staging** only. A heavy m22 scrape is running →
> **no m23 bulk scraping** this run (per the prompt's safety rule). Discovery (done entirely from
> **already-captured** m22 raw artifacts, zero new legacy calls) found that the actual dish content is
> **not** present in the captured source (doc 01) — so this run builds the **schema + parser + scraper +
> importer foundation** and reports the dish-content source as **BLOCKED**, with the exact safe next
> step. No misleading sample import was run (there is no dish content to import).

## Repo / DB
- branch `migration/legacy-full-clone-reconciliation`; commit `e90bfc5`; tree clean (known untracked only).
- staging DB version `0019`; m22 counts: raw 4,987 · meal-history items 67,908 · exceptions 77.
- no m23 tables yet; no nutrezee timers enabled.

## VPS / load
- host `vmi3360590`; disk **172 GB free**; legacy creds present in `/opt/nutrezee/legacy-migration.env`
  (LEGACY_BASE_URL / ADMIN_EMAIL / ADMIN_PASSWORD) — **never printed**.
- **m22 last-year scrape IS RUNNING** (pid 2088180, ~51 min, **6,680 raw files / 1.1 GB** and growing).
  It continuously loads the legacy server (`getMealsDateWiseFilter`, conc 3).

## Safety decision (binding for this run)
Because a heavy scrape is active, per the prompt:
- ❌ **No m23 bulk/live scraping** — would compound legacy load.
- ✅ Read-only discovery from **existing** m22 raw artifacts (zero new legacy calls).
- ✅ Build schema, parser, importer, tests.
- ✅ Sample the pipeline over **existing** raw (no scraping).
- The live dish-catalog scraper (`getMealsByType`) is **built but DISABLED and not run** (deferred until
  the m22 scrape ends and a separate window is approved).

This is safer than the prompt's default assumption (scraping `getMeals`): the dish-per-day data is
already archived in the m22 grids (doc 01), so **no scraping is needed to build the dish layer**.

## Confirmations
- target = **staging**, not production ✅
- legacy credentials present (not printed) ✅
- no timers enabled ✅
- additive-only migration planned (`0020`) ✅
- separate m23 raw path reserved: `/opt/nutrezee/dish-per-day/raw` (for the future catalog scrape) ✅

## Gate
Staging confirmed; m22 scrape active → constrained to read-only discovery + foundation build + sample
over existing raw. Proceed to endpoint discovery (doc 01).
</content>
