# 01 — Legacy Dish-Detail Source Discovery

> **Headline finding (evidence-based): the actual dish assigned per customer per day is NOT present in
> any source we can currently access safely.** The captured m22 grids are an admin **edit** interface
> whose dish dropdowns are ajax-populated and carry **no `selected` assignment**; the secondary
> `getMeals`/`getMealsByType` ajax returns the selectable **catalog**, not the saved assignment. With the
> m22 scrape running, live probing of any assignment-read endpoint is not done. → **dish content source
> is BLOCKED** (foundation built and ready; see docs 02–05). Discovery used existing artifacts only —
> **zero new legacy calls**.

## Endpoints referenced by the legacy grid (from captured HTML)
| name | method | role | dish assignment? |
|---|---|---|---|
| `getMealsDateWiseFilter/all/<internal_id>` | GET | renders the per-day **edit** grid (m22 captured this) | **no** — dish dropdowns empty/ajax |
| `getMealsByType` | POST `{meal_type_id, main_sub_package_id, req_date}` | edit control: returns selectable dish **catalog** for a slot | **no** — catalog, not the saved pick |
| `getupgradegramvaluebydate` | POST `{order_id, selected_date}` | edit control: protein/carb grams | no |
| `getMealsEgssByProduct` | GET/POST | egg component options | no |
| `addMealByAdmin`,`editMeal`,`deletemeal*`,`assignDriver` | POST | **mutations — FORBIDDEN, never called** | — |

`getMeals(elem, dateval, order_meal_id, main_sub_package_id, order_id)` fires on meal-type **change** and
POSTs to `getMealsByType` to repopulate the dish `<select>` via `$("#meal_select_"+order_meal_id).html(data)`.
It is the **edit UI** — it returns the catalog, not what the customer was assigned.

## What the captured grid actually contains (measured, not assumed)
Scanned the largest artifacts + 40 sequential files:
| signal | present? | evidence |
|---|---|---|
| per-day **dates** | ✅ | `datepciker_<order_meal_id>` value / `getMeals(...,'YYYY-MM-DD',...)` |
| per-day **slot structure** | ✅ | 131–199 `meal_select_<id>`, `meal_qty_`, `prot_`, `carb_`, `raw_eggs_`, `white_eggs_` per order |
| **assigned dish** (selected option in `meal_select_`) | ❌ | **0 / 40 files** have a `selected` option in `meal_select`; dropdowns hold the catalog only |
| assigned dish as **display text** | ❌ | `has_meal_name_span = false`; no dish-name label element |
| assigned **meal type** (selected) | ❌ | no meal-type `<select>` carries a real selected type; m22's `["breakfast","snack"]` was a regex artifact over page text |
| one id-less select with a `selected` value | ⚠️ | a single **order-level** attribute repeated per row (a proper-name value) — **not** a dish/type; treated as **PII**, not parsed |
| macros (`prot_`/`carb_` spans) | ❌ static | ajax-loaded (`getupgradegramvaluebydate`) |
| dish **catalog** options | ✅ | `meal_select` dropdowns are pre-loaded with selectable dishes (the menu), but nothing is marked as the customer's pick |

**Conclusion:** the grid is an *editor*; the customer's actual saved dish is loaded dynamically (ajax/JS)
or rendered in a different legacy view we have not captured. It is **not** in the saved HTML.

## Why this is a real blocker (not a parser bug)
- The parser (`dish-detail-lib.mjs`) correctly extracts dates + slot structure and *would* extract the
  assigned dish if a `selected` option existed (proven by fixture tests, doc 04). Across 40 real files
  there are **0** selected dishes — so the data is genuinely absent from this source.
- `getMealsByType` cannot supply the assignment: its params are `{meal_type_id, main_sub_package_id,
  req_date}` (no `order_meal_id`), so it returns the catalog for a slot type, not the customer's pick.

## What would be needed (next safe step, currently deferred)
1. **A live read-only discovery** (after the m22 scrape ends, on the VPS) of an endpoint that returns the
   **saved** dishes for an order/order_meal_id — e.g. probing the main order view or an
   `getOrderMeals`-style endpoint, GET-only, ≤5 orders, polite. If such an endpoint exists, the m23
   schema + scraper + importer (built here) capture it directly.
2. If no read-only assignment endpoint exists, then the legacy system **does not store per-customer dish
   content** in a retrievable form, and dish-per-day must be **captured going forward** in the new
   system (data-intelligence doc 09 keystone), not back-filled.

## Gate
A safe read-only **dish-content** source is **NOT found** in what we can access now. Per the m23
decision rule this is **BLOCKED** on the content goal. The foundation (schema, parser, scraper,
importer) is built and ready so that, once an assignment-read endpoint is confirmed (or forward capture
begins), capture is immediate and lossless.
</content>
