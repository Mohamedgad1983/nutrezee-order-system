# Legacy → New Migration Toolkit (Playwright)

A **read-only** toolkit that logs into the legacy Nutrezee admin and the new staging
system, **extracts** legacy operational data, **normalizes** it to the new schema,
**compares** it against the new system, and **prepares import-ready files + reconciliation
reports**. It performs **extraction + comparison + dry-run ONLY** — it never imports and
never mutates anything.

> Status: the harness, safety layer, normalizers, comparators, reports and unit tests are
> built and tested. Extraction is a **no-op scaffold until legacy access (the S1 blocker)
> is granted** — then you calibrate `config.json` selectors and re-run.

## What is safe / what is forbidden

✅ Safe (what this toolkit does):
- Logs in with **credentials from environment variables only** (never hardcoded, never bypassed).
- Starts the legacy browser in **auth-only mode**: the only mutating request allowed is a `POST` to a configured login URL/pattern.
- Switches the legacy browser to **strict read-only mode** immediately after login: every later `POST/PUT/PATCH/DELETE` is aborted.
- Blocks dangerous same-origin legacy `GET` URLs containing mutation words such as `delete`, `remove`, `destroy`, `update`, `save`, `approve`, `reject`, `cancel`, `assign`, `autoassign`, `confirm`, `payment`, `paid`, `status`, or `action` unless a verified read-only allowlist entry matches.
- Refuses to click any `save/update/delete/confirm/submit/…` control, or links to dangerous legacy GET URLs (DOM guard).
- Blocks extraction for any entity with `calibrated:false`; the report shows `NEEDS_CALIBRATION` and no placeholder legacy route is visited.
- Throttles navigation, retries with backoff, screenshots for evidence, **redacts secrets & PII in all logs**.
- Writes outputs to `migration-output/` (gitignored) — raw + normalized + CSV + reports.

⛔ Forbidden (never done here):
- Bypassing authentication or 2FA.
- Writing/updating/deleting/importing **anything**, legacy or new.
- Committing extracted customer/order data.
- Auto-importing into staging (a separate, explicitly-instructed step).

## 1. Configure environment variables (credentials — never committed)

```bash
export LEGACY_BASE_URL="https://nutreeze.com"          # legacy admin base URL
export LEGACY_ADMIN_EMAIL="…"                          # provided by the project owner
export LEGACY_ADMIN_PASSWORD="…"
export NEW_STAGING_URL="https://13-140-159-201.sslip.io"
export NEW_ADMIN_EMAIL="…"
export NEW_ADMIN_PASSWORD="…"
# optional:
export MIGRATION_MANUAL_LOGIN=1   # pause up to 120s for 2FA/captcha during legacy login
export MIGRATION_HEADED=1         # show the browser
export DEBUG=1                    # verbose (redacted) logs
```

Put **nothing secret** in `config.json`. Use `.env.legacy` / `.env.migration` (gitignored) if you prefer a file, and `source` it.

## 2. Install + calibrate

```bash
cd tools/legacy-migration
npm install
cp config.example.json config.json
# Once legacy access is granted: open the real legacy screens (Playwright codegen helps)
# and fix each entity's `path`, `rowSelector`, `nextPageSelector`, `columns`. Then set
# that entity's "calibrated": true. Uncalibrated entities are skipped before navigation
# and reported as NEEDS_CALIBRATION. Use fixtures/mock-legacy-customers.html to practice.
```

`legacy.authPostAllowlist` must contain only the login POST target(s), normally `"/login"`.
During auth, all other `POST/PUT/PATCH/DELETE` requests are blocked. After login, the
context switches to strict read-only and the login POST is blocked too.

`legacy.readOnlyGetAllowlist` is intentionally narrow. Add an entry only when a URL has
been manually verified as read-only but contains a blocked token such as `payment`,
`status`, or `action`. Entries can be exact paths such as `"/masters/payment-methods"` or
prefixes ending in `*`; never allowlist broad action namespaces.

## 3. Run

```bash
npm run legacy:migration:dry-run    # DEFAULT: extract → normalize → compare → report (read-only)
npm run legacy:migration:extract    # extraction only
npm run legacy:migration:compare    # comparison only
npm test                            # unit tests (normalizers + comparators)
npm run typecheck
```

Without legacy credentials or calibrated selectors, the dry-run still runs end-to-end and
produces a **readiness report** telling you exactly what to provide — it extracts 0 rows.

## 4. Where outputs go

```
migration-output/<timestamp>/
  raw/<entity>.json          # exactly what was scraped (field → cell text)
  normalized/<entity>.json   # new-schema-shaped, with legacy_id + confidence + notes
  csv/<entity>.csv           # same, flat
  screenshots/<entity>-pN.png
  reports/
    extraction-summary.md
    legacy-vs-new-coverage.md
    migration-readiness-report.md
  run-manifest.json
```
`migration-output/` is **gitignored** — extracted data is never committed.

## 5. Confidence levels (per row)

- `VERIFIED` — clean mapping, key fields parsed (safe candidate).
- `INFERRED` — mapped but with an assumption (e.g. derived end-date).
- `NEEDS_MANUAL_REVIEW` — unparseable / ambiguous / out-of-scope. **Never auto-imported.**

Uncalibrated entities are not extracted. They are reported as `NEEDS_CALIBRATION` before
any legacy page navigation occurs.

## 6. How to review the reports

1. **extraction-summary.md** — did we get the expected row counts per entity? Any `NEEDS_MANUAL_REVIEW`?
2. **legacy-vs-new-coverage.md** — legacy vs new counts, matched, only-in-legacy (import candidates), only-in-new (drift), fields the new system needs that legacy lacks.
3. **migration-readiness-report.md** — overall verdict + blockers + the next step.

## 7. Next step BEFORE any real import (separate, explicit)

This toolkit stops at import-ready files. The real import is the new system's own
**M19 dry-run → review → apply** flow (mirror-mode/idempotent), run only when explicitly
instructed and after a human reviews the dry-run report:

```
POST /imports/<batch>/dry-run   →  review the JSON report  →  POST /imports/<id>/apply
```
**Never** run apply from this toolkit. Catalog stays import-only until `cutover_catalog` flips.

## Architecture

```
legacy-login.ts / new-login.ts   env-var login (no bypass, 2FA pause)
lib/  config, safety (read-only guard + throttle + retry), browser, io, logger (redaction),
      new-api (read-only GET client), normalize-util, reports, types
extractors/   base (generic paginated scrape) + 7 entity extractors
normalizers/  customers · orders · subscriptions · catalog   (pure, unit-tested)
comparators/  compare-util (pure) + customers · orders · catalog
exporters/    csv · json
fixtures/     sample-legacy-output.json · mock-legacy-customers.html
tests/        normalizers · comparators
cli.ts        orchestrator (dry-run default)
```
