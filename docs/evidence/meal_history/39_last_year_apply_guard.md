# 39 — Last-Year Apply Guard (Stage 6)

> **Stage 6.** Widened the importer apply guard to allow `last_year` apply **only** under its own
> explicit, non-interchangeable confirmation token, keeping every other guard intact. Full-history
> remains refused. Tests green.

## Change
`tools/legacy-full-migration/meal-history-import.mjs` — added `last_year` to the applyable scopes:
```js
const APPLY_SCOPES = {
  last_30_days: 'APPLY_LAST_30_STAGING',
  last_90_days: 'APPLY_LAST_90_STAGING',
  last_year:    'APPLY_LAST_YEAR_STAGING',   // Stage 6: controlled historical backfill
};
```
No other guard logic changed. A `last_year` apply therefore still requires **all** of:
- `SYNC_TARGET=staging` (production refused),
- `MEAL_IMPORT_SCOPE=last_year` present in `APPLY_SCOPES`,
- `MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_YEAR_STAGING` (the last-30/last-90 tokens are rejected),
- `MEAL_IMPORT_SOURCE_VPS=1` (VPS-approved raw source),
- staging DB version ≥ `0019`,
- m22 destination tables deployed (`dedup_checked=true`).

`full` / `all` / unknown scopes remain **not applyable** (not in `APPLY_SCOPES`); `scope=full` is also
still gated earlier by `ALLOW_FULL_HISTORY=1`. There is no `last_year` backdoor to full-history.

## Tests (`app/tests/integration/ts-i-import-guards.test.ts`, TS-I) — 9/9 green
- allows last-year apply **only** with `APPLY_LAST_YEAR_STAGING` (rejects missing token and the
  last-90 token),
- refuses last-year apply without `MEAL_IMPORT_SOURCE_VPS=1`,
- still refuses `full` apply even with `ALLOW_FULL_HISTORY=1` (caught by `APPLY_SCOPES` — no backdoor),
- unchanged: refuses production, refuses unknown scope, keeps last-30/last-90 tokens distinct.

Every refusal exits 2 **before** any DB/driver load (guards run on Node builtins only).

## Deployment note
The VPS copy at `/opt/nutrezee/legacy-meal-history/meal-history-import.mjs` will be re-uploaded
(byte-verified) from this reviewed repo version **before** the Stage 7 last-year apply, so the gated
apply runs audited code.

## Gate
Tests pass → last-year apply is unlocked under explicit confirmation. Proceed (Stage 7) once the
last-year scrape (Stage 4) and importer dry-run (Stage 5) complete.
</content>
