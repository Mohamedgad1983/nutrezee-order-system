# Playwright / Browser Results

Date: 2026-06-16

## Commands Run

```bash
cd tools/e2e-staging
npx playwright test tests/wpui-auth-unauth.spec.ts
# authenticated run requires E2E_EMAIL/E2E_PASSWORD exported from a secret source first
npx playwright test tests/wpui-shell.spec.ts tests/wpui-orders.spec.ts tests/wpui-customers.spec.ts tests/wpui-dashboard.spec.ts
```

## Current Run Status

Follow-up readiness run on branch `build/wp-ui-customers-list`:

```bash
cd tools/e2e-staging
npx playwright test tests/wpui-auth-unauth.spec.ts
```

Result: passed, 2/2 browser tests.

Authenticated staging E2E was rerun after the operator explicitly approved using
the staging account already present in the conversation. Credentials were supplied
as runtime environment variables only; they were not hardcoded, echoed, or
committed.

No-secret smoke passed: 2/2 browser tests.

```text
tests/wpui-auth-unauth.spec.ts
- protected admin routes redirect to login without a session
- invalid admin login shows an error and stays on login
```

Authenticated staging run passed after resetting the supplied staging account password and deploying this branch's app/API changes to staging.

```text
tests/wpui-customers.spec.ts
- customers admin — create, search, open profile, edit (end-to-end)

tests/wpui-orders.spec.ts
- Orders screen loads from the live API
- status filter re-queries without error
- cancellation reason-code endpoint is wired

tests/wpui-shell.spec.ts
- unauthenticated visit redirects to login
- sign in lands on kitchen board
- sidebar navigates drafts, review queue, and orders with seeded-data tolerant assertions
- Payments opens from the sidebar as a live queue
- kitchen board Generate/Refresh works inside the shell
- deep-link hard refresh renders the SPA
- sign out revokes the session server-side

tests/wpui-dashboard.spec.ts
- dashboard loads
- KPI cards navigate to dedicated metric detail pages
- analytics panel detail rows open without client crashes
```

Result: 12/12 authenticated tests passed.

Staging deployment used the current branch archive; `api` and `admin` images were rebuilt and restarted. VPS health after deploy: `postgres` healthy, `api` up, `admin` up, `caddy` up.

Secret hygiene: generated Playwright artifacts were scanned for the supplied email and password; no matches were found.

## Expected Coverage From Updated Specs

| Spec | Coverage |
|---|---|
| `tests/wpui-orders.spec.ts` | Login, orders route load, Active status tab re-query, cancellation reason-code endpoint |
| `tests/wpui-customers.spec.ts` | Login, customers route load, create customer, add address, profile order-history section, edit notes, search by phone |
| `tests/wpui-dashboard.spec.ts` | Login, dashboard cards, KPI detail pages, analytics detail dropdowns |
| `tests/wpui-auth-unauth.spec.ts` | Protected route redirect and invalid-login error without secrets |

## Screenshot Target

`docs/evidence/admin_gap_rebuild/screenshots/`

## Screenshots Captured

| Screenshot | Evidence |
|---|---|
| `screenshots/01-login-redirect.png` | `/app/orders` redirects to `/app/login` without a session |
| `screenshots/02-invalid-login.png` | Invalid login stays on login and shows an error |
| `screenshots/authenticated-staging/` | Authenticated staging shell, customers, orders, dashboard coverage |

## Authenticated Browser Blockers

None for this branch's current authenticated staging coverage.

Resolved during follow-up:

- The supplied E2E account initially failed login; password was reset on staging through the VPS access path and login was verified in the in-app Browser.
- Staging initially lacked this branch's customer add-address/order-history UI; the current branch archive was deployed to staging and `api`/`admin` were rebuilt.
- Older shell assertions assumed empty staging lists and a Payments placeholder; the test now accepts seeded data and verifies the live Payments queue.
