# 04 — m23 Dish-Per-Day Blocker Report

**Date:** 2026-06-20 · **Status: `BLOCKED`** on the dish-content goal.
**Verification:** DB facts (tables absent, schema head 0019) **verified this run**; discovery/foundation facts **previously documented** in `docs/evidence/dish_per_day/` (cited inline).

---

## 1. The business goal

> "Know exactly what each customer actually ate each day" — capture the actual dish assigned per customer, per meal slot, per date, with dish metadata (name, id, components, macros, allergens). *(`dish_per_day/12`, STATUS.)*

This is the single keystone that would lift auto-meal readiness from package/cadence level to true dish-level personalization. It is currently **not achievable from the legacy system as captured**.

## 2. Discovery performed

The m23 pass reviewed the legacy meal-editing endpoints and sampled real captured grid files to determine whether a **saved** per-customer dish exists in retrievable form. It does not.

### Endpoints reviewed — `BLOCKED` *(`dish_per_day/01`)*

| Endpoint | Role | Saved assigned dish present? |
|---|---|---|
| `getMealsDateWiseFilter/all/<internal_id>` (GET) | Renders the per-day **edit** grid (the same page m22 captured) | ❌ No — dropdowns are empty/ajax |
| `getMealsByType` (POST `{meal_type_id, main_sub_package_id, req_date}`) | Editor control returning the selectable dish **catalog** for a slot | ❌ No — catalog only, not the pick |
| `getupgradegramvaluebydate` (POST) | Editor control: protein/carb grams | ❌ No |
| `getMealsEgssByProduct` | Egg component options | ❌ No |

### What the captured grid actually contains *(`dish_per_day/01`)*

- Per-day **slot structure** ✅ (e.g. `meal_select_<id>`, `meal_qty_`, `prot_`, `carb_`, `raw_eggs_`, `white_eggs_`).
- **Assigned dish (a `selected` option in `meal_select_`): ❌ — 0 of 40 sampled files** contain a selected dish. The dropdowns hold the catalog only.
- Verbatim: *"dishes = 0 across 40/40 files — the `meal_select` dropdowns hold the catalog with no `selected` pick."*

## 3. Why catalog/options are NOT actual assigned-dish data — `BLOCKED`

- The grid is an **editor**, not a record. The customer's actual saved dish is loaded dynamically (ajax/JS) or rendered in a legacy view that was not captured; **it is not in the saved HTML** *(`dish_per_day/01`, "Why this is a real blocker")*.
- `getMealsByType` is keyed by `{meal_type_id, main_sub_package_id, req_date}` with **no `order_meal_id`** — it returns the menu **for a slot type**, not the customer's selection.
- **Catalog ≠ assignment.** Knowing which dishes *could* be chosen for a slot says nothing about which dish a specific customer *was* assigned on a specific date.

## 4. Why we must NOT infer dish assignment — `BLOCKED`

- There is **no `selected` attribute in any of the 40/40 real files**, so there is literally nothing to infer a selection from.
- Inferring "the customer ate dish X" from a catalog dropdown would **manufacture false history** — unsafe for any downstream nutrition/allergy/preference use.
- Per the binding project rules and this report's mandate: **never guess or fabricate dish assignments; never map by name/phone.** If no read-only assignment endpoint exists, the legacy system **does not store retrievable per-customer dish content**, and dish-per-day must be **captured going forward**, not back-filled *(`dish_per_day/01`, "What would be needed")*.

## 5. What foundation was built — `CONFIRMED` (built, gated, ready)

So that capture is immediate and lossless the moment a real dish source exists:

- **Migration `0020_wave7_dish_per_day.sql`** — five tables *(confirmed from the SQL)*:
  - `dish_detail_import_run` — auditable run trail
  - `legacy_dish_detail_raw` — lossless raw archive (`UNIQUE(raw_sha)`)
  - `customer_dish_day` — one row per (order, date, slot)
  - `customer_dish_day_item` — one row per actual dish/component
  - `dish_detail_exception` — append-only parse/link failures
- **Parser** `tools/legacy-full-migration/dish-detail-lib.mjs` — extracts assigned dish/date/slot/components; correctly reports `no_dish` when the source lacks a selected option (no crash, no drop) *(`dish_per_day/04`)*.
- **Scraper** `tools/legacy-full-migration/dish-detail-scrape-job.mjs` — staging-only, mutation deny-list, rate-limited, `--resume`; output to `/opt/nutrezee/dish-per-day/raw` *(`dish_per_day/05`)*.
- **Disabled systemd** `ops/systemd/nutrezee-dish-detail-scrape.service` + `run-dish-detail-scrape.sh` — **no `[Install]`, no `.timer`** (manual start only) *(`dish_per_day/05`)*.
- **Docs 00–12** under `docs/evidence/dish_per_day/`.
- **Tests:** **54 files / 273 tests pass** (+6 dish-detail parser); migrations apply clean **`0001→0020` locally** *(`dish_per_day/12`, "Tests / gates")*.

## 6. Why staging apply of 0020 was skipped — `CONFIRMED`

- The sample contains **no dish names/details**, so per the prompt the correct action was **STOP and report the source limitation** — import dry-run / apply / reconciliation (Parts 9–11) were **not run** *(`dish_per_day/06`, `08`)*.
- A heavy m22 scrape was active; no live bulk/assignment scrape was run to avoid compounding legacy load *(`dish_per_day/00`, "Safety decision")*.
- **There is no dish content to import → migration `0020` was deliberately not applied to staging; staging stays at `0019`.**

> **DB-verified this run (2026-06-20):** `to_regclass` returns **NULL** for `customer_dish_day`, `customer_dish_day_item`, and `legacy_dish_detail_raw` — the m23 tables **do not exist** on staging. Schema head = `0019`. This confirms the documented decision.

## 7. What forward capture must do in the new system — `RECOMMENDED`

Capture the dish **at the operational moment** — assign the actual dish per slot at **order/kitchen time** — and write it into the m23 schema (`customer_dish_day` + `customer_dish_day_item`), with the raw payload archived in `legacy_dish_detail_raw`/equivalent. This is the data-intelligence "keystone": it is what moves auto-meal readiness from ≈27 toward ≈55–65 over time *(`dish_per_day/11`; `data_intelligence/09`)*.

**One safe legacy check remains optional:** after the m22 last-year scrape finishes, a **tiny GET-only discovery (≤5 orders, polite)** could confirm whether any read-only endpoint (e.g. the main order view) returns the **saved** dish per `order_meal_id`. If yes → feed the already-built importer. If no → the legacy system does not store retrievable dish content, and forward capture is the only path *(`dish_per_day/12`, "Next safest step")*. **Do not** bulk scrape; **do not** call mutation endpoints.

## 8. Exact conclusion — `BLOCKED`

> **True dish-level auto-meal AI is BLOCKED** until either (a) **forward dish-per-day capture** exists in the new system, or (b) a **confirmed read-only saved-dish legacy source** is found. The legacy back-fill cannot supply dish content (the per-customer assignment is not present in the grid HTML — confirmed 0/40 files; the catalog endpoint returns options, not the pick). The full m23 foundation (schema, parser+tests, disabled read-only scraper, discovery) is built and ready so capture is immediate and lossless once a dish source exists — **most likely via forward capture.** *(`dish_per_day/12`, STATUS + "Honest conclusion".)*

**Therefore:** do not claim dish-level / nutrition-aware / allergy-safe / auto-meal-planner readiness. See [05_ai_readiness_report.md](05_ai_readiness_report.md).
