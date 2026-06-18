# 06 — Sample Execution (read-only, existing artifacts)

> Per the prompt's Part 8 gate ("if the sample does not include dish names/details, stop and report
> source limitation"), the sample was a **read-only parse of existing m22 grids** (no new legacy calls,
> m22 scrape active). **Result: dish names/details are NOT present → source limitation → gate stops here.**

## What was run
- Parsed existing m22 raw grids on the VPS with `dish-detail-lib.mjs` (counts only; no PII printed).
- Scanned the 4 largest artifacts in depth + 40 sequential files for a `selected` dish.

## Findings (counts only)
| metric | result |
|---|---|
| files parsed | 40 + 4 deep |
| dates extracted | ✅ (e.g. 198 dates / 199 slots in one order) |
| slot structure (`meal_select_/prot_/carb_/raw_eggs_/white_eggs_/meal_qty_`) | ✅ present |
| **assigned dish in `meal_select` (selected option)** | **0 / 40 files** |
| dish-name display element (`meal_name`/`assigned_meal` span) | **none** (`has_meal_name_span=false`) |
| catalog options in `meal_select` dropdowns | present but **none marked selected** |
| macros (`prot_/carb_` spans) | empty (ajax-loaded) |
| PII/secret in logs | **0** (counts only; dish/name values never printed) |
| parser warnings | `no_dish` on every slot (honest, not a crash) |

## Gate decision
The sample **does not include dish names/details** → **STOP and report source limitation** (exactly as
the prompt instructs). The actual per-customer dish is loaded by ajax/JS in the legacy editor and is not
saved in the captured HTML; the catalog endpoint returns selectable options, not the assignment (doc 01).

No live VPS scrape of the catalog/assignment was run (m22 scrape active + assignment endpoint unconfirmed).
Therefore there is **no dish content to import** — Parts 9–11 (import dry-run / apply / reconciliation) are
**not run** (see docs 07–09), and m23 reports **BLOCKED** on the dish-content goal with the foundation
built and ready (docs 02–05).
</content>
