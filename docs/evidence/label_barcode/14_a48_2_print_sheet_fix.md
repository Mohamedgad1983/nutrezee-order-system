# 14 — a48.2: single/batch print clipped on the 100 × 70 mm sheet; bidi-safe plate/phone

Date: 2026-09-03 · Owner report: screen preview complete, but the printed PDF (Chrome "Save as PDF") showed the
label shifted (~22 mm blank top, ~7 mm clipped left) and cut after the 4th dish row: no totals, address or barcode.

## Cause (Verified from the owner's PDF: MediaBox 282.96 × 198 pt = 100 × 70 mm, one page)

Print CSS placed `.nz-legacy-label` with `position: fixed; inset: 0` while every other node was only
`visibility: hidden`. Fleetbase's order side panel is a transformed container, so `fixed` resolved relative
to the panel, not the sheet; the label landed offset inside the 100 × 70 mm page and was clipped.

## Change (extension v0.3.7, Console `0.7.48-a48.2`)

- `printDetached(selector, modeClass)` (order-label.js, shared with batch-labels.js): clone the label / batch
  container into a `.nz-print-root` appended to `<body>`, call `window.print()`, then remove root and class.
  Print CSS hides every other body child with `display: none` and positions the root at the sheet origin.
- `.nz-driver-band strong`: `direction: ltr; unicode-bidi: isolate` so the bilingual line no longer renders
  the plate as "40149-24" or moves the phone's "+".
- Tests: TS-U extension (print path + CSS), console release string.
