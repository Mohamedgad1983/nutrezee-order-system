# A56 — Full-width batch labels and named drivers

2026-09-05 · DONE + DEPLOYED · Owner-requested correction.

## Scope declared before implementation

Extension-owned styles, batch/individual label templates, label normalization, package/manifest;
Console release marker; Nutrezee API label service and current Fleetbase directory enrichment;
shared label contract; focused regression tests, browser flow and registers.
Use the full Fleet-Ops content width, arrange screen previews in horizontal rows, and show the
current driver name beside the phone in selectors and the existing colored label header.
Name is display-only, never assignment/color/barcode identity; missing names remain explicitly
unavailable. Preserve the 100 x 70 mm design canvas / 150 x 100 mm print stock and one label per
printed page. No vendor edits, database migration, Partner writes or print-ledger submission.

## Verification — Verified

- 52 focused unit tests pass, including current-directory name replacement, absent-name handling,
  stable immutable-id colors, dropdown behavior and existing print-layout boundaries.
- Lint, workspace typecheck/build, cross-module and no-GET-mutation scans pass.
- PR #74 / source `6dbf641`, merge `25338b6`: push CI `33949463959` and PR CI `33949484837`
  passed 14/14 jobs each (29 reported checks including the repository bot). Post-merge CI
  `33949743808` passed. TS-I verifies the name on candidate and preview responses.
- `tools/e2e-staging/flows/fleetops-batch-dropdowns.spec.ts` now also checks full-width geometry,
  horizontal placement, current name/phone consistency and header fit. Discovery: one test.
  The signed-in browser equivalent below was executed through the user's Chrome session;
  no protected session export or print confirmation was submitted.

## Release — Verified

- Console `0.7.48-a56.1`, extension `0.3.15`, image `fleetbase-console:a56-1-6dbf641`, id
  `9e480fa017e9d31526c5f59071af4d800be5973366c043766e7e5f9994858b2c`.
- Nutrezee API image `nutrezee-api:a56-6dbf641`, id
  `1c2813f82aca92cdcecfc10ff2ed217195867ec1c3712a17aabb9319b4ce94a4`.
- Builds: `/opt/fleetbase/builds/a56-layout/{build,api-build}.log`; both exit files contain 0.
  Console recompiled the complete production bundle using the verified A55 builder with only
  the extension overlay and release marker; its runtime stage matches the tracked Dockerfile.
- Isolated Console image checks passed: nginx syntax, production metadata, manifest version,
  name/header bundle, scoped full-width/grid CSS, stable theme alias, gzip, immutable caching,
  and absence of Clear-Site-Data. API compiled-source checks passed.
- Recreated API and Console only; reloaded the existing admin gateway's nginx after API
  replacement. API compose environment matched the previous container exactly (keys compared
  without printing values); `/health` reports ok with restart count 0. No migration was run.
- Source retained at `/opt/nutrezee/a56-src-6dbf641`; Console extension source synchronized to
  `/opt/fleetbase/console/extensions/nutrezee-labels-engine`.
- Rollback images: `fleetbase-console:pre-a56-20260905`, `nutrezee-api:pre-a56-20260905`.
  Previous Console source backup: `/opt/fleetbase/backups/a56-20260905/`.

## Visible browser proof — Verified

2026-09-06 delivery day, 1728 px desktop viewport. Aggregate-only evidence; no customer/contact
payloads or private screenshots are committed.

1. Real Fleet-Ops panel expanded from 768 px to **1464.20 px**. Header, date summary and dropdowns
   use the available content width; existing sidebar and Fleetbase attribution remain visible.
2. First driver's **81** actual labels render in three columns. The current driver's name appears
   next to the phone in both the selector and the colored label header; the barcode stays black.
3. Area dropdown search selected Salwa: **17** labels. First-row x positions **288.125, 781.523,
   1274.922**, identical y **840.836**, each canvas width **377.945 px** (100 mm).
4. Orders search selected order **26503**: exactly one article with matching aria-label.
   Driver name and phone are present, and the entire band fits within the existing header height.
5. Returned to Driver mode, searched by the displayed driver name: one matching option;
   restored the full driver batch. No print confirmation panel appeared.
6. Synthetic Arabic full-name header was also inspected in the browser: no overlap with logo,
   phone or label body. Screen previews use horizontal rows; print CSS keeps one landscape
   150 x 100 mm page per label. Physical printer/camera UAT was not performed in this session.

No upstream transport failure occurred during the final preview checks. The separately recorded
intermittent Partner error is not claimed as fixed by this presentation change.
