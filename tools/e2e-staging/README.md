# e2e-staging — visible Playwright suite

Headed Playwright tests that drive the admin SPA on staging. The default target is
`https://13-140-159-201.sslip.io`; override it with `E2E_BASE_URL` when needed.

## Credentials — passed at runtime, never committed

Every spec reads the login from the environment (no secrets in the repo):

```ts
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
```

Provide them at run time from your shell or a CI secret, **never** hardcoded.
Prefer exporting values from a local secret manager or an interactive prompt so the
password is not stored in shell history:

```bash
export E2E_BASE_URL='https://13-140-159-201.sslip.io'
export E2E_EMAIL='you@example.com'
read -rsp 'E2E_PASSWORD: ' E2E_PASSWORD; export E2E_PASSWORD; echo
npx playwright test

# a single spec
npx playwright test tests/wpui-customers.spec.ts
```

If `E2E_EMAIL` / `E2E_PASSWORD` are unset the login step fails fast — that's expected,
not a product bug.

> History note: these specs previously hardcoded a staging admin password. That
> credential has been **rotated** (so the value in old commits is dead) and the specs
> were parameterized. Do not paste real credentials back into any tracked file — a
> pre-commit `gitleaks` hook (see `.pre-commit-config.yaml`) guards against it.
