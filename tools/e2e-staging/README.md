# e2e-staging — visible Playwright suite

Headed Playwright tests that drive the admin SPA on staging
(`https://13-140-159-201.sslip.io`, set in `playwright.config.ts`).

## Credentials — passed at runtime, never committed

Every spec reads the login from the environment (no secrets in the repo):

```ts
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
```

Provide them at run time — from your shell or a CI secret, **never** hardcoded:

```bash
E2E_EMAIL='you@example.com' E2E_PASSWORD='…' npx playwright test
# a single spec:
E2E_EMAIL='you@example.com' E2E_PASSWORD='…' npx playwright test wpui-catalog
```

If `E2E_EMAIL` / `E2E_PASSWORD` are unset the login step fails fast — that's expected,
not a product bug.

> History note: these specs previously hardcoded a staging admin password. That
> credential has been **rotated** (so the value in old commits is dead) and the specs
> were parameterized. Do not paste real credentials back into any tracked file — a
> pre-commit `gitleaks` hook (see `.pre-commit-config.yaml`) guards against it.
