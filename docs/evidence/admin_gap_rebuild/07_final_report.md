# Final Report - Admin Gap Rebuild

Date: 2026-06-15

## Status

Partial. Code, evidence docs, local gates, and no-secret browser smoke are complete. Authenticated staging browser coverage is blocked by missing `E2E_EMAIL`/`E2E_PASSWORD` in this shell and by the need to deploy this branch before testing its new customer-profile UI on staging.

## What Was Discovered

- Verified: the new admin already covers the core order-ops slice: auth, dashboard, intake, review, orders, customers, payments, kitchen, catalog, reports, settings, staff/RBAC, exceptions, and audit.
- Verified: current branch has unmerged order/customer UI improvements beyond `main`.
- Verified: legacy baseline includes many additional operational/content/finance/dispatch areas beyond the current order-ops cutover path.
- Verified: real legacy data migration is still blocked by missing legacy export/DB/source access.
- Verified: staging/browser tests exist, but this shell lacks `E2E_EMAIL` and `E2E_PASSWORD`.

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

Authenticated Playwright specs were not run because secure staging credentials were not available in the shell.

## Remaining Gaps

See `03_gap_matrix.md`.

## Production Readiness Risk

- High: real migration cannot proceed without sponsor legacy access.
- High: workshop-owned validators/routing/RBAC sign-off remain required before pilot/cutover.
- Medium: finance report parity, coupon rules, and renewal queue need explicit cutover-scope decisions.
- Medium: browser rerun requires secure E2E credentials and deployment of this branch.

## Recommended Next Work Package

Run this branch through local gates and secure browser E2E, then deploy to staging for UAT if green. After that, the next project-level unblock is sponsor S1 legacy export/DB access for `WP-DATA-01`.
