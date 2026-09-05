# A55 — Searchable batch-label filters

2026-09-05 · DONE + DEPLOYED · Owner-requested UI correction.

## Scope declared before implementation

Extension-owned `addon/components/batch-labels.js` and `.hbs`, initially a nested dropdown component (subsequently removed),
`addon/styles/addon.css`; extension package/manifest version; Console release argument; focused tests and registers.
No Fleetbase vendor source, API/database change, Partner writes or print-layout change.

Driver and Area selections show the whole matching batch; an Orders dropdown narrows either group to one order.
Orders mode searches all current-day candidates and selects one exact order, using its existing area scope and
selection id in the unchanged server contract. Selection changes invalidate pending previews and confirmations.
Native disclosure dropdowns keep browser keyboard support and avoid the previous Ember native-select rendering defect.

## Verification
Verified locally: 25/25 focused tests (8 behavioral selection/race/search cases, 13 extension boundaries,
4 production-build configuration checks); lint, all-workspace typecheck/build and both boundary scans pass.
Both PRs and post-merge CI are green; final production Console and signed-in browser proof are complete.

## Browser integration correction

The first live browser check on a55.1 exposed Fleet-Ops rendering the contributed panel with the host owner,
which cannot resolve a nested extension-local component (null component manager). The previous a54.4 image
was immediately restored. A55.2 keeps the native dropdown markup inline in the existing registered panel;
the shared field model and actions stay in `batch-labels.js`. No vendor change is needed.

## Final release — Verified

- PR #72: merge `9d94242`; push/PR CI `33947576168` / `33947578240`, 14/14 jobs each.
- Host integration correction PR #73: merge `fa0b375`; push/PR CI `33948298691` / `33948317291`,
  14/14 jobs each (29 reported checks including the repository bot). Post-merge `33948443019`: green.
- Final source `fdbc252`; extension `0.3.14`; Console `0.7.48-a55.2`;
  image `fleetbase-console:a55-2-fdbc252`, image id
  `294b9cea2e4af1206842c7d6f52132e2a48100a4db4bada620b88ebd2ea5f15d`.
- Build: `/opt/fleetbase/builds/a55-dropdowns/host-build.log` and `host-build.exit` (0).
  The final compilation reused the verified production builder image via the recorded
  `console/Dockerfile.incremental`, overlaid only extension-owned code, then ran Ember production
  compilation again. The runtime stage is copied verbatim from the checked-in Console Dockerfile.
- Temporary isolated-container gates: production metadata, extension version, dropdown/race bundle,
  stable theme alias, gzip, immutable/revalidating caching and no Clear-Site-Data all passed (7/7).
- Recreated only Console via `docker compose up -d --no-build --no-deps console`; public
  `/extensions.json` confirms 0.3.14. Rollback image: `fleetbase-console:pre-a55-20260905`.
  Extension source/Dockerfile backup: `/opt/fleetbase/backups/a55-20260905/`.

## Visible browser proof — Verified

Executed through the user's existing signed-in Chrome tab using Playwright locators; no credential extraction.
The repeatable equivalent flow ships at `tools/e2e-staging/flows/fleetops-batch-dropdowns.spec.ts`
with separate `fleetops.config.ts` (spec discovery passes: one test). No physical print or print confirmation
was submitted. Evidence is aggregate-only; customer/contact payloads and driver phone numbers are not retained here.

1. Corrected release renders all dropdowns inside Fleet-Ops; no nested-component resolution failure.
2. Tomorrow selects 2026-09-06 and auto-renders the first driver's 81 labels.
3. Driver dropdown search narrows the list; choosing another driver renders exactly 58 label articles.
4. Area dropdown search selects Salwa; exactly 17 label articles render.
5. Orders dropdown within that area narrows to order 26503; exactly one article with the matching aria-label.
6. Direct Orders mode searches the whole day's candidates; order 24400 renders exactly one matching article.
7. A no-match query shows the bilingual empty state without changing the current preview; Escape closes the
   dropdown and preserves the one-label selection.
8. Returned to Driver mode / all 81 labels for 2026-09-06. No print-confirmation panel or ledger submission.

The original `partner_label_source_unavailable` transport error recurred once during the area preview;
Refresh preview succeeded and produced all 17 labels. That pre-existing upstream intermittency is not fixed
by this UI change and remains a separate diagnostic follow-up if it continues.
