# Staging E2E Merge Readiness

## Status
READY_TO_MERGE

## Branch
build/wp-ui-customers-list

## Commit
`PENDING_DOC_COMMIT` (authenticated staging E2E passed; final hash set after commit)

## Deployment Target
Staging VPS: `https://13-140-159-201.sslip.io`

Deployment method is manual VPS deploy via `tools/vps-mcp/` and Docker Compose:

```bash
set -a; . /opt/nutrezee/.env; set +a
docker compose -f docker/compose.yml -f docker/compose.staging.yml up -d --build admin
```

The current app branch was already deployed to staging during dashboard verification. No production configuration was edited.

## Credentials
- E2E_EMAIL: set at runtime
- E2E_PASSWORD: set at runtime
- E2E_BASE_URL: set at runtime

No credential values were printed, hardcoded, or committed.

## Tests Run
```bash
cd app && npm run typecheck
```
Passed.

```bash
cd app && npm run lint
```
Passed after removing an unused dashboard helper.

```bash
cd app && npm run build
```
Passed.

```bash
cd app && npx vitest run tests/integration/ts-c-orders.test.ts tests/integration/ts-c-customers.test.ts tests/integration/ts-i-orders.test.ts
```
Passed: 29 tests.

```bash
cd app && npm run test:placeholder
```
Passed: 46 files, 207 tests.

```bash
cd tools/e2e-staging && npx playwright test tests/wpui-auth-unauth.spec.ts
```
Passed: 2 browser tests.

Authenticated staging E2E passed: 12/12 browser tests.

## Browser Coverage
No-secret browser coverage:
- Protected admin route redirects to login without a session.
- Invalid admin login shows an error and remains on login.

Authenticated browser coverage passed:
- Admin login works.
- Dashboard loads, including KPI detail-page navigation.
- Sidebar/navigation loads: drafts, review queue, orders, payments, kitchen.
- Customers list loads.
- Customer profile opens.
- Address add form opens and address can be added with safe staging test data.
- Customer order history panel loads.
- Orders list loads.
- Order filtering re-queries without UI errors.
- Cancellation reason-code API is reachable.
- Deep-link refresh renders the SPA.
- Sign out revokes the session.

## Screenshots
No-secret screenshots:
- `docs/evidence/admin_gap_rebuild/screenshots/01-login-redirect.png`
- `docs/evidence/admin_gap_rebuild/screenshots/02-invalid-login.png`

Authenticated staging screenshots:
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-01-login-screen.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-02-signed-in-kitchen-shell.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-03-drafts-screen.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-04-review-queue-screen.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-05-orders-screen.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-06-payments-screen.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-07-kitchen-board-in-shell.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/wpui-08-signed-out.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/orders-01-orders.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/orders-02-orders-filtered.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/customers-01-customers.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/customers-02-profile.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/customers-03-address-added.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/customers-04-edited.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/customers-05-search-found.png`
- `docs/evidence/admin_gap_rebuild/screenshots/authenticated-staging/dashboard-01-dashboard.png`

## Failures
- Initial parallel local Vitest command collided on the shared test database schema while another Vitest command was running. Root cause: two commands both called `freshDb()` concurrently. Re-run sequentially passed.
- None in the authenticated staging run. Credentials were supplied at runtime and were not committed.

## Remaining P0
None.

## Merge Recommendation
Yes. Authenticated staging browser tests passed with credentials supplied securely at runtime.
