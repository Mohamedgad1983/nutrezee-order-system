# 12 — A48: unlimited label reprints, reason optional

Date: 2026-09-03 · Owner directive (Mohamed, after the first live single-label print on staging):
"اعملها مفتوحة أي عدد طباعة". Branch `build/wp-lbl-a48-unlimited-reprints` → `fix/a45-console-performance`.

## Change

| Layer | Before (A27) | After (A48) |
|---|---|---|
| DB | `label_print_event_check`: reprint requires non-blank `reason` | migration `0031` drops the CHECK; `reason` stays optional text |
| API | `recordPrint` / `recordCandidateBatchPrint` and both `…/printed` routes reject reprints without reason | reason optional; blank stored as NULL; audit `label.reprinted` still written in the same transaction |
| Fleet-Ops extension v0.3.6 | client-side gate "A reprint reason is required"; an error replaced the whole panel (label disappeared) | no gate, field labelled optional; errors render above the label, the preview stays visible |
| Console image | `CONSOLE_RELEASE=0.7.48-a45.1` | `0.7.48-a48.1` (theme alias `?v=a48.1`) |

Unchanged: barcode never changes on reprint, print/reprint permissions (`label.print` / `label.reprint`),
append-only trail (tamper trigger), same-transaction audit, current-day-only batch rule.

## Tests (local, 2026-09-03)

TS-I `ts-i-label-barcode` (reprint without reason accepted, stored NULL, history 3 rows, barcode stable;
batch with prior prints accepted without reason), TS-U extension/console tests updated; TS-M 12/12.
