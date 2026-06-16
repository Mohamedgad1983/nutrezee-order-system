# Staging E2E Merge Readiness

## Status
BLOCKED

## Branch
build/wp-ui-customers-list

## Commit
Verification started from `80d3b1e` with this readiness report and focused contract-test updates pending commit.

## Deployment Target
Staging VPS: `https://13-140-159-201.sslip.io`

Deployment method is manual VPS deploy via `tools/vps-mcp/` and Docker Compose:

```bash
set -a; . /opt/nutrezee/.env; set +a
docker compose -f docker/compose.yml -f docker/compose.staging.yml up -d --build admin
```

The current app branch was already deployed to staging during dashboard verification. No production configuration was edited.

## Credentials
- E2E_EMAIL: missing
- E2E_PASSWORD: missing
- E2E_BASE_URL: missing; config defaults to `https://13-140-159-201.sslip.io`

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

Authenticated staging E2E was not run because required environment credentials were missing.

## Browser Coverage
No-secret browser coverage:
- Protected admin route redirects to login without a session.
- Invalid admin login shows an error and remains on login.

Authenticated browser coverage is blocked pending `E2E_EMAIL` and `E2E_PASSWORD`.

## Screenshots
- `docs/evidence/admin_gap_rebuild/screenshots/01-login-redirect.png`
- `docs/evidence/admin_gap_rebuild/screenshots/02-invalid-login.png`

No authenticated screenshots were captured in this follow-up run.

## Failures
- Initial parallel local Vitest command collided on the shared test database schema while another Vitest command was running. Root cause: two commands both called `freshDb()` concurrently. Re-run sequentially passed.
- Authenticated staging E2E blocked because `E2E_EMAIL` and `E2E_PASSWORD` were not present in the shell environment.

## Remaining P0
- Supply staging authenticated E2E credentials through environment/secret store and rerun authenticated Playwright before merging.

## Merge Recommendation
No. Do not merge to `main` until authenticated staging browser tests pass with credentials supplied securely at runtime.
