# Playwright / Browser Results

Date: 2026-06-15

## Commands Run

```bash
cd tools/e2e-staging
npx playwright test tests/wpui-auth-unauth.spec.ts
E2E_EMAIL=... E2E_PASSWORD=... npx playwright test tests/wpui-shell.spec.ts tests/wpui-orders.spec.ts tests/wpui-customers.spec.ts
```

## Current Run Status

No-secret smoke passed: 2/2 browser tests.

```text
tests/wpui-auth-unauth.spec.ts
- protected admin routes redirect to login without a session
- invalid admin login shows an error and stays on login
```

Authenticated run blocked at login: staging returned `Invalid email or password.` for the supplied account. No authenticated route assertions ran after that failure.

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

- Supplied E2E credentials were rejected by staging with `Invalid email or password.`
- If not deployed, staging will not contain this branch's customer address/order-history UI.
- Authenticated specs (`wpui-orders`, `wpui-customers`, full navigation) were attempted but did not pass login.
