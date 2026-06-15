# Playwright / Browser Results

Date: 2026-06-15

## Commands Run

```bash
cd tools/e2e-staging
npx playwright test tests/wpui-auth-unauth.spec.ts
```

## Current Run Status

Passed: 2/2 browser tests.

```text
tests/wpui-auth-unauth.spec.ts
- protected admin routes redirect to login without a session
- invalid admin login shows an error and stays on login
```

## Expected Coverage From Updated Specs

| Spec | Coverage |
|---|---|
| `tests/wpui-orders.spec.ts` | Login, orders route load, Active status tab re-query, cancellation reason-code endpoint |
| `tests/wpui-customers.spec.ts` | Login, customers route load, create customer, add address, profile order-history section, edit notes, search by phone |
| `tests/wpui-auth-unauth.spec.ts` | Protected route redirect and invalid-login error without secrets |

## Screenshot Target

`docs/evidence/admin_gap_rebuild/screenshots/`

## Screenshots Captured

| Screenshot | Evidence |
|---|---|
| `screenshots/01-login-redirect.png` | `/app/orders` redirects to `/app/login` without a session |
| `screenshots/02-invalid-login.png` | Invalid login stays on login and shows an error |

## Authenticated Browser Blockers

- E2E credentials were missing at discovery time.
- If not deployed, staging will not contain this branch's customer address/order-history UI.
- Authenticated specs (`wpui-orders`, `wpui-customers`, full navigation) were updated but not run in this shell because `E2E_EMAIL` and `E2E_PASSWORD` are unset.
