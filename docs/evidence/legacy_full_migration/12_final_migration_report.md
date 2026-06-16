# Nutrezee Legacy Full Migration Report

Date: 2026-06-16

## Status

BLOCKED

## Source

- Legacy website/admin: access missing.
- Legacy database/export/API/browser: missing.
- Credentials: required variables are missing from the shell. Secret values were not printed.

## Target

- New staging/local database: missing `NEW_DATABASE_URL`.
- New admin URL: missing `NEW_ADMIN_URL`/`E2E_BASE_URL` in the shell.

## Migration Batch

- batch ID: none
- started_at: 2026-06-16
- completed_at: not completed
- commit hash at start: `bbfc449`
- branch: `migration/legacy-full-clone-reconciliation`

## Migrated Entities

| Entity | Extracted | Normalized | Imported | Verified | Status |
| ------ | --------: | ---------: | -------: | -------: | ------ |
| customers | 0 | 0 | 0 | 0 | blocked |
| customer_addresses | 0 | 0 | 0 | 0 | blocked |
| orders | 0 | 0 | 0 | 0 | blocked |
| order_details | 0 | 0 | 0 | 0 | blocked |
| payments | 0 | 0 | 0 | 0 | blocked |
| deliveries | 0 | 0 | 0 | 0 | blocked |
| products | 0 | 0 | 0 | 0 | blocked |
| packages | 0 | 0 | 0 | 0 | blocked |
| ingredients | 0 | 0 | 0 | 0 | blocked |
| allergies | 0 | 0 | 0 | 0 | blocked |
| meal_types | 0 | 0 | 0 | 0 | blocked |
| diet_statuses | 0 | 0 | 0 | 0 | blocked |
| delivery_times | 0 | 0 | 0 | 0 | blocked |
| delivery_methods | 0 | 0 | 0 | 0 | blocked |
| drivers | 0 | 0 | 0 | 0 | blocked |
| coupons | 0 | 0 | 0 | 0 | blocked |
| dietician_requests | 0 | 0 | 0 | 0 | blocked |

## Reconciliation Result

- counts: not verified
- checksums: not verified
- foreign keys: not verified
- mismatches: no mismatch file because no data was processed

## Browser Verification

- legacy checked: no
- new admin checked: no
- screenshots: `docs/evidence/legacy_full_migration/screenshots/`

## Data Quality Issues

| Severity | Issue |
| --- | --- |
| P0 | Missing legacy source access prevents extraction. |
| P0 | Missing normalized files prevents validation/import. |
| P0 | Missing new DB target prevents staging import. |
| P1 | Full clone scope exceeds current DEC-012 import scope; drivers/coupons/dietician requests have no active target. |
| P1 | Legacy payment/delivery status vocabularies are unknown. |

## Remaining Blockers

- Provide one complete read-only legacy source: DB URL, export files, API, or admin URL + credentials.
- Provide a safe staging/local target DB connection.
- Confirm whether full clone includes deferred modules or only daily order operations.
- Confirm handling for raw PII exports before any raw files are committed.

## 100% Verification Decision

`BLOCKED_BY_MISSING_ACCESS`

Recommendation: Not ready for staging signoff, main merge as a real migration, production rehearsal, or 100% completion claim.

## Tests

| Command | Result |
| --- | --- |
| `node --check tools/legacy-full-migration/validate-normalized.mjs` | pass |
| `node tools/legacy-full-migration/validate-normalized.mjs --input docs/evidence/legacy_full_migration/exports/normalized` | expected P0 gate red: 7 missing normalized files |
| `cd app && npm run typecheck` | pass |
| `cd app && npm run lint` | pass |
| `cd app && npm run build` | pass |
| `cd app && npm run test:placeholder` | pass: 46 files, 207 tests |
