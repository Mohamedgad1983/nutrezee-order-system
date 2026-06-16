# Final Report - Admin Gap Rebuild

Date: 2026-06-16

## Status

Complete for this branch. Code, evidence docs, local gates, no-secret browser smoke, staging deploy, and authenticated staging browser coverage are complete. Real legacy migration remains blocked on sponsor legacy export/DB/source access.

## What Was Discovered

- Verified: the new admin already covers the core order-ops slice: auth, dashboard, intake, review, orders, customers, payments, kitchen, catalog, reports, settings, staff/RBAC, exceptions, and audit.
- Verified: current branch has unmerged order/customer UI improvements beyond `main`.
- Verified: legacy baseline includes many additional operational/content/finance/dispatch areas beyond the current order-ops cutover path.
- Verified: real legacy data migration is still blocked by missing legacy export/DB/source access.
- Verified: staging/browser tests exist and now pass with the supplied staging account after password reset.
- Verified: this branch was deployed to staging at commit `19b827c`; `api` and `admin` were rebuilt and restarted.

## What Was Missing

- Customer profile could display addresses but could not add one, despite a safe backend API.
- Customer profile had no direct order-history panel.
- `/orders` did not expose a direct `customer_id` filter for profile order history.
- Existing `wpui-orders` Playwright selector expected a stale select filter instead of the current tab UI.
- Required evidence docs for this broad admin gap mission did not exist.

## What Was Built

- Added `customer_id` read filter to `GET /orders`.
- Added customer-profile add-address UI using existing `POST /customers/:id/addresses`.
- Added customer-profile order-history panel using `GET /orders?customer_id=...`.
- Extended customer Playwright coverage to create -> add address -> edit -> search.
- Updated orders Playwright coverage to use current Active tab.
- Added evidence docs, gap matrix, migration mapping, data-quality checks, and test plan.

## What Was Tested

| Command | Result |
|---|---|
| `cd app && npm run typecheck` | Passed |
| `cd app && npm run lint` | Passed |
| `cd app && npm run build` | Passed |
| `cd app && npx vitest run tests/integration/ts-c-orders.test.ts tests/integration/ts-c-customers.test.ts` | Passed: 23 tests |
| `cd app && npm run test:placeholder` | Passed: 46 files, 204 tests |
| `cd tools/e2e-staging && npx playwright test tests/wpui-auth-unauth.spec.ts` | Passed: 2 browser tests, screenshots captured |
| `cd tools/e2e-staging && E2E_EMAIL=... E2E_PASSWORD=... npx playwright test tests/wpui-shell.spec.ts tests/wpui-orders.spec.ts tests/wpui-customers.spec.ts` | Passed: 11 browser tests |

Authenticated Playwright specs passed after resetting the staging account password and deploying this branch to staging. Generated artifacts were scanned for the supplied email/password; no matches were found.

## Staging Deployment

- Commit deployed: `19b827c`.
- Method: branch archive uploaded to `/opt/nutrezee/repo`, with pre-deploy backup at `/opt/nutrezee/backups/repo-pre-admin-gap-20260616055912.tgz`.
- Services rebuilt/restarted: `api`, `admin`.
- Post-deploy health: `postgres` healthy; `api`, `admin`, and `caddy` up; `/app/login` and `/api/health` returned HTTP 200.

## Remaining Gaps

See `03_gap_matrix.md`.

## Production Readiness Risk

- High: real migration cannot proceed without sponsor legacy access.
- High: workshop-owned validators/routing/RBAC sign-off remain required before pilot/cutover.
- Medium: finance report parity, coupon rules, and renewal queue need explicit cutover-scope decisions.
- Medium: current authenticated browser suite covers the rebuilt admin flows, but broader migration/UAT depends on sponsor data and workshop sign-off.

## Recommended Next Work Package

Proceed to sponsor/UAT review of the deployed branch, then unblock `WP-DATA-01` with legacy export/DB/source access.
