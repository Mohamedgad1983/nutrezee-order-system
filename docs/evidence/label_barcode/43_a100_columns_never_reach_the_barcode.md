# 43 — WP-LBL-A100: neither label column can reach the barcode

**Date:** 2026-11-02 · **Console candidate:** `fleetbase-console:a100-1` (release `0.7.48-a100.1`), extension 0.3.31 · **Rollback:** `fleetbase-console:pre-a100-20261102` (image 665a2785b7ca, the a98 console) · extension backup `/root/a100/ext-a100.tgz`

## Owner's two photos (labels printed for Tuesday 3 Nov)

1. **Order 32156, eight dishes, no note.** The dish rows ran past the bottom of the dishes column: "Sesame Chicken Salad" was cut by the barcode, the last dish ("Pro Mud Cake" — the name is present in the Partner feed, item 2434826) printed with an empty name cell, and the barcode sat on top of "Total Nutrition".
2. **Order 31942, address wrapped to four lines, with a note.** "Phone: 55010503" was printed under the barcode.

## Causes (reproduced with the real template and stylesheet, see below)

- **Dishes column had no guard at all.** A88 clipped and tightened only the customer column. The dishes column had no fit levels and no clipping, so eight dishes with long names (16 text lines) overflowed the 45.2 mm body by 4.8 mm straight into the barcode zone.
- **A label with a note stretched the customer column.** A89 made the right column 55.8 mm tall on a label with a note (dishes + the note box beside the half-width barcode). The body is a CSS grid with `auto` rows, so the row grew to 55.8 mm and the customer column grew with it: its A88 clip now ended 10.6 mm *below* the barcode top, and `fitLabels()` saw nothing to tighten because the column "fit" its stretched box. The Phone line landed exactly where the barcode prints.

## Change (extension 0.3.31; `addon.css`, `order-label.js`)

- Both columns are pinned to their own 45.2 mm (`height: 45.2mm; align-self: start`) whatever the neighbour does; the note column keeps its 55.8 mm.
- The dishes column is clipped at its area (`overflow: hidden`) — like the customer column since A88 — so nothing can paint over the barcode.
- `fitLabels()` now also tightens the dishes table in three levels (type 1.95 → 1.8 → 1.7 → 1.6 mm, tighter cell padding and totals row) until the column fits, before the A89 note sizing runs. Labels that already fit keep the approved design untouched.
- Unit test added (`TS-U` fleetops label extension: meal fit levels + the three stylesheet guards); the A88/A89 tests still pass (18/18).

## Measured in a real browser (harness with the real template + stylesheet, 96 dpi; 1 mm = 3.78 px)

| Case | Before: column bottom vs barcode top | Before: phone | After: fit classes | After: overflow | After: phone / last dish / totals |
|---|---|---|---|---|---|
| A — photo 1 (8 dishes, no note) | +18 px (4.8 mm over the barcode) | visible | `nz-fit-1 nz-meals-fit-1` | 0 / 0 | all visible |
| B — photo 2 (wrapped address + note) | +40 px (10.6 mm, customer column stretched) | visible in the harness, under the barcode on paper | none needed | 0 / 0 | all visible |
| C — 10 dishes + long address + long note | +40 px | visible | `nz-fit-1 nz-meals-fit-2 nz-notes-fit-5` | 0 / 0 | all visible |
| D — 10 dishes + long address, no note | +72 px (19 mm) | **hidden** | `nz-fit-2 nz-meals-fit-2` | 0 / 0 | all visible |

"After" rows: customer and dishes columns end exactly at the barcode top on labels without a note; on a label with a note the dishes/note column runs beside the half-width barcode by design (A89).

## Release

Server extension copy was byte-identical to `main` before the change (22 files compared by hash); the four changed files were synced (`addon.css`, `order-label.js`, `package.json`, `extension.json`). Build, gate and swap recorded below.
