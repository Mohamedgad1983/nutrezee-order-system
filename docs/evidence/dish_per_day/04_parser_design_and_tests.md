# 04 — Parser Design & Tests

> `tools/legacy-full-migration/dish-detail-lib.mjs` — pure, I/O-free dish-grid parser. Proven correct by
> unit tests; the real source simply lacks the dish (doc 01), which the parser reports as `no_dish`
> (never a crash, never a silent drop).

## What it extracts (per grid)
`parseDishGrid(html, {internal_id, order_number})` → `{ internal_id, order_number, slots[], dates[],
warnings[], counts }`. Per slot: `{ order_meal_id, meal_date, meal_slot, meal_slot_label,
dish:{meal_id,name}|null, components:[{meal_component_type, legacy_meal_id, dish_name}], extra:{} }`.

Signals parsed (robust to attribute order, HTML-entity-decoded):
- **assigned dish** = the `selected` `<option>` in `<select id="meal_select_<order_meal_id>">` →
  `meal_id` (value) + `dish_name` (text). Placeholders (`value=""`/`"0"`) are skipped.
- **date** ← `datepciker_<order_meal_id>` input value, fallback `getMeals(...,'YYYY-MM-DD',<omid>,…)`.
- **meal slot/type** ← `meal_type_<omid>` selected option.
- **components** ← selected options of `protein_/carb_/raw_eggs_/white_eggs_/…` selects.
- **unknown fields** → preserved in `extra` (never dropped); `warnings[]` + `counts` flag gaps.

Helpers: `selectedOption`, `normalizeDate`, `cleanText`, `normalizeDishName`, `dishSha` (sha256 raw key).

## Tests (`app/tests/integration/ts-u-dish-detail.test.ts`, TS-U) — 6/6 green
| test | proves |
|---|---|
| extracts assigned dish/date/slot/components when present | parser works on a real dish source |
| slot with no selected dish → `no_dish` (no crash, no drop) | graceful on the actual legacy shape |
| date from `getMeals(...)` literal when datepciker absent | dual date binding |
| `selectedOption` skips `""`/`"0"` placeholders | no false dishes |
| empty/malformed input handled gracefully | robustness |
| helpers (date/clean/normalize/sha) | correctness |

## Validation against real artifacts (on the VPS, counts only)
Run over real grids: dates + slot structure extract correctly (e.g. 198 dates / 199 slots), but
**dishes = 0 across 40/40 files** — the `meal_select` dropdowns hold the catalog with **no `selected`
pick** (doc 01). This is the source limitation, confirmed empirically, not a parser fault.

## Limitations (current source)
- dish **name/id**, meal **type**, **macros**, **components**: absent from the captured grid (ajax-loaded
  or never saved per customer).
- the parser is **ready** to populate the clean model the moment a dish-bearing source (assignment-read
  endpoint or `getMealsByType` catalog join, or forward capture) is available.
</content>
