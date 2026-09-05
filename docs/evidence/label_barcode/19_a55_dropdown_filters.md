# A55 — Searchable batch-label filters

2026-09-05 · IN PROGRESS · Owner-requested UI correction.

## Scope declared before implementation

Extension-owned `addon/components/batch-labels.js` and `.hbs`, new `batch-filter-select.js` and `.hbs`,
`addon/styles/addon.css`; extension package/manifest version; Console release argument; focused tests and registers.
No Fleetbase vendor source, API/database change, Partner writes or print-layout change.

Driver and Area selections show the whole matching batch; an Orders dropdown narrows either group to one order.
Orders mode searches all current-day candidates and selects one exact order, using its existing area scope and
selection id in the unchanged server contract. Selection changes invalidate pending previews and confirmations.
Native disclosure dropdowns keep browser keyboard support and avoid the previous Ember native-select rendering defect.

## Verification
Verified locally: 25/25 focused tests (8 behavioral selection/race/search cases, 13 extension boundaries,
4 production-build configuration checks); lint, all-workspace typecheck/build and both boundary scans pass.
CI, production Console build and signed-in browser proof pending.
