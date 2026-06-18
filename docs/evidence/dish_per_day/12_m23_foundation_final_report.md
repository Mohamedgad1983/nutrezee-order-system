# 12 — m23 Dish-per-Day Foundation: Final Report

**STATUS: BLOCKED** (on the dish-content goal — no safe read-only source exists) **· foundation
built, gated, and ready.**

> The business goal — "know exactly what each customer actually ate each day" — cannot be met from the
> legacy system as captured: the per-customer **dish assignment is not present** in the grid HTML (the
> dish dropdowns are an ajax-populated **editor**, never carrying a `selected` pick — confirmed 0/40
> files), and the secondary `getMealsByType` ajax returns the selectable **catalog**, not the assignment.
> The full m23 foundation (schema, parser+tests, disabled read-only scraper, discovery) is built so that
> capture is immediate and lossless once a dish source exists — most likely via **forward capture** in
> the new system.

## 1. Repo state
- branch: `migration/legacy-full-clone-reconciliation`
- starting commit: `e90bfc5`
- ending commit: `23036a7`
- working tree: clean except known untracked (`CLAUDE.md`, `nutreeze-hr-kuwait-plan/`, `tools/legacy-migration/`)

## 2. Legacy source discovery
- endpoint found (read-only): `getMealsByType` (POST `{meal_type_id, main_sub_package_id, req_date}`) →
  dish **catalog**; `getMealsDateWiseFilter` (GET) → the per-day **editor** grid (m22 already captures it)
- **dish-level (per-customer assignment) data found: NO** — 0/40 captured grids carry a `selected` dish;
  no dish-name display element; macros ajax-loaded
- fields found in captured source: dates, slot structure, dish **catalog** options (menu), one order-level
  PII attribute
- fields missing from source: assigned dish name/id, meal type (real), macros, allergens, ingredients,
  quantities, replacement/edit/delete state, delivery status

## 3. Schema
- migration: `0020_wave7_dish_per_day.sql` (additive)
- raw table: `legacy_dish_detail_raw` (full HTML/JSON, `UNIQUE(raw_sha)`)
- clean tables: `customer_dish_day`, `customer_dish_day_item` (+`extra_json` for unknowns)
- exception table: `dish_detail_exception` (CHECK reasons; never deleted)
- import run table: `dish_detail_import_run`
- constraints: no-dup raw hash / dish-day / dish-item; nullable deterministic links; RBAC perms seeded
- applied to staging: **no** (no data to import; staging stays at `0019`); applies cleanly `0001→0020` locally

## 4. Parser
- files: `tools/legacy-full-migration/dish-detail-lib.mjs`
- tests: `app/tests/integration/ts-u-dish-detail.test.ts` (6/6 green)
- fields parsed: assigned dish (meal_id+name) when present, date, slot/type, components; **unknowns → `extra`**
- unknown fields preserved: yes (`extra` / `extra_json`)
- limitations: the real source has no selected dish → parser correctly reports `no_dish` (no crash, no drop)

## 5. VPS scrape
- ran on VPS: **no** (m22 last-year scrape active → no compounding load; assignment endpoint unconfirmed)
- sample size: read-only parse of 40+ existing grids (no new legacy calls)
- success / failures: parse OK; **0 dishes found** (source limitation)
- raw files: none written (no scrape run)
- PII/secret check: 0 (counts only; dish/name values never printed)

## 6. Import
- dry-run / apply: **not run** (no dish content to import)
- raw / dish-days / dish-items / exceptions inserted: 0 (importer designed, doc 07/08; not built/run)
- idempotency: enforced structurally by `0020` (proven mechanism, mirrors m22)

## 7. DB reconciliation
- not run (no import); method defined (doc 09); `0020` enforces dedup/no-dup constraints

## 8. Scaling plan
- last-7 / last-30 / last-90 / last-year / full: **not started** — gated on first confirming a dish source
  (doc 10); when unblocked, runs batched + per-stage reconciled (m22 discipline)

## 9. AI impact
- readiness before: ≈ 27/100; readiness after this run: **unchanged** (no content captured)
- projected after real dish-per-day capture: ≈ 55–65/100; unlocks dish repetition / likes-dislikes /
  personalized dish rec / richer 360 & menu intelligence (doc 11)
- still blocked: feedback, nutrition, allergy mapping, substitutions, delivery outcomes

## 10. Tests / gates
- node --check: ✅ (lib, scraper) · bash -n: ✅ (wrapper)
- typecheck: 0 · lint: 0 · build: ✅ · scanners: 0/0
- vitest: **54 files / 273 tests** ✅ (+6 dish-detail parser) · migrations local apply: **0001→0020 clean** ✅

## 11. Docs created
`00_baseline_and_safety` · `01_legacy_endpoint_discovery` · `02_raw_archive_design` ·
`03_clean_model_design` · `04_parser_design_and_tests` · `05_vps_scraper_design` ·
`06_sample_scrape_execution` · `07_sample_import_dry_run` · `08_sample_gated_apply` ·
`09_sample_db_reconciliation` · `10_scaling_plan` · `11_ai_readiness_impact` · `12_…final_report`

## 12. Commit and push
- commit hash: `23036a7` · push: `origin/migration/legacy-full-clone-reconciliation`

## 13. Next safest step
After the m22 last-year scrape finishes, run a **tiny live VPS discovery (≤5 orders, GET-only, polite)**
to confirm whether any read-only endpoint returns the **saved** dish per `order_meal_id` (e.g. the main
order view). If yes → feed the built importer/scraper and scale per doc 10. If no → **the legacy system
does not store retrievable per-customer dish content**, so dish-per-day must be **captured forward** in
the new system (assign the actual dish per slot at order/kitchen time) into the m23 schema. **Do not**
bulk scrape while the m22 scrape runs; **do not** call mutation endpoints; **never** guess/fabricate dish
assignments.

## Decision-rule mapping
No safe read-only **dish-content** source exists → **BLOCKED** (per the rule). The catalog endpoint is
read-only but is the menu, not the assignment. Foundation (schema + parser + disabled scraper +
discovery) delivered and gated; zero PII/secret leakage; no production; no mutation; no timer.
</content>
