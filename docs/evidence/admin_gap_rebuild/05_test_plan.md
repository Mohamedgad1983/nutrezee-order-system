# Test Plan

Date: 2026-06-15

## Local Static/Unit Gates

| Gate | Command | Expected |
|---|---|---|
| Typecheck | `cd app && npm run typecheck` | API/admin/shared TS compile |
| Lint | `cd app && npm run lint` | ESLint clean |
| Build | `cd app && npm run build` | API tsc + admin Vite build |
| Focused order contract | `cd app && npx vitest run tests/integration/ts-c-orders.test.ts` | `/orders` read contract covers `customer_id` filter |
| Focused customer contract | `cd app && npx vitest run tests/integration/ts-c-customers.test.ts` | Customer API contract remains green |

## Browser / Playwright Gates

| Area | Command | Expected |
|---|---|---|
| Auth/shell | `cd tools/e2e-staging && E2E_EMAIL=... E2E_PASSWORD=... npx playwright test tests/wpui-shell.spec.ts --project=chromium` | Login, protected shell, logout |
| Orders | `cd tools/e2e-staging && E2E_EMAIL=... E2E_PASSWORD=... npx playwright test tests/wpui-orders.spec.ts --project=chromium` | Orders load; active tab re-queries; reason-code endpoint works |
| Customers | `cd tools/e2e-staging && E2E_EMAIL=... E2E_PASSWORD=... npx playwright test tests/wpui-customers.spec.ts --project=chromium` | Create, add address, edit, search |
| Navigation smoke | Run all `tools/e2e-staging/tests/wpui-*.spec.ts` after deploy | No major console/network failures; screenshots refreshed |

## Screenshots

Screenshots should be copied or generated under:

`docs/evidence/admin_gap_rebuild/screenshots/`

Expected screenshots after browser run:

- login
- dashboard
- orders list
- order detail modal
- customers list
- customer profile with address and order history
- catalog
- payments
- reports
- audit

## Known Test Blockers

- `E2E_EMAIL` and `E2E_PASSWORD` are not set in this shell.
- Legacy admin credentials are not set, so legacy browser discovery cannot be safely rerun.
- GitHub Actions billing is recorded as blocked in the live queue.
