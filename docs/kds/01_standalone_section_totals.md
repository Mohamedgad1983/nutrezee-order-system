# WP-KDS-01 — Standalone section totals release

**Evidence state:** implementation and independent KDS/root CI verified 2026-08-08; PR review/merge, staging deployment, and live Partner acceptance remain required before DONE.

## Authorized scope

The user explicitly directed that Kitchen Display is entirely separate from the car/driver application and currently needs quantities only. This release is a new standalone service based directly on repository `main`, not on the label or logistics branches.

In scope:

1. Dedicated bilingual Arabic/English display and login.
2. Dedicated Node API and server-side opaque sessions.
3. Dedicated Partner read-only credential and exact `/integration/order-items` reads.
4. Exact totals by delivery date, configured kitchen, dynamic upstream section, `meal_id`, and `portion_size`.
5. Multi-section quantity included in every assigned section; missing route remains visible as `unrouted`.
6. Independent package lock, Docker image, compose definitions, CI, unit/HTTP/Playwright tests, and deployment runbook.

Out of scope:

- delivery/driver/vehicle functions or dependencies;
- label/barcode/collection functions or dependencies;
- customer/order/item identifiers in browser contracts;
- any Partner, production, legacy, or database write;
- kitchen status updates, workflow transitions, automatic release, recipes, inventory, forecasting, or AI;
- inferred routing or name matching.

## Local evidence

| Gate | Command | Expected |
|---|---|---|
| Separation/privacy scan | `npm run lint` | all runtime files pass; Partner method is GET only |
| API/web type safety | `npm run typecheck` | zero errors |
| Unit + HTTP integration | `npm test` | all tests pass |
| Production artifacts | `npm run build` | API and Vite bundles generated |
| Visible bilingual journey | `npm run test:e2e` | Chromium login → Arabic totals → English totals; unrouted visible; PII absent |
| Container | `docker build -f Dockerfile -t nutrezee-kds:verify .` | image builds; `/health` passes |

## Staging provisioning

Required protected inputs (do not commit or print them):

1. A dedicated Partner read-only API key for KDS.
2. A display password chosen by the operator, stored only as a generated scrypt hash.
3. Confirmed Partner kitchen identifier list (`main` is the current conservative configurable default).

Host layout:

```text
/opt/nutrezee-kds/
  repo/                 # this repository checkout
  secrets/
    kds_partner_api_key       # mode 0600
    kds_display_password_hash # mode 0600
```

Deployment sequence:

```bash
cd /opt/nutrezee-kds/repo/kitchen-display
KDS_PUBLIC_ORIGIN=https://kds.13-140-159-201.sslip.io \
  docker compose -f compose.staging.yml config --quiet
KDS_PUBLIC_ORIGIN=https://kds.13-140-159-201.sslip.io \
  docker compose -f compose.staging.yml build
KDS_PUBLIC_ORIGIN=https://kds.13-140-159-201.sslip.io \
  docker compose -f compose.staging.yml up -d
curl --fail http://127.0.0.1:8180/health
```

Add the reverse-proxy route in `deploy/Caddyfile.fragment`, validate Caddy, and reload it without restarting or editing the order, delivery, or label services.

## Live acceptance

Use today's Kuwait delivery date and each configured kitchen.

1. Unauthenticated `/api/section-totals` returns 401.
2. Dedicated KDS login succeeds and its cookie is Secure/HttpOnly/SameSite=Strict.
3. Arabic is the default and `dir=rtl`; English toggle changes to `dir=ltr`.
4. Every section returned by Partner is visible and ordered by `step_no`.
5. Recompute at least two meal/portion totals from the exact Partner rows; displayed totals match.
6. A multi-section row contributes to all of its upstream sections.
7. An unrouted source row, if present, appears in the warning lane; if none exists, upstream and display both show zero.
8. Search the JSON/browser/network evidence for item refs, order numbers, customer names, phones, addresses, API keys, delivery actors, and label data; none may appear.
9. Verify the service issued only Partner GET requests and caused no Partner/database/workflow writes.
10. Run `KDS_E2E_BASE_URL=https://<kds-host> KDS_E2E_USERNAME=<display-user> KDS_E2E_LIVE=1 npm run test:e2e:staging` after exporting `KDS_E2E_PASSWORD` through a protected interactive environment. The live suite requires a successful totals response, validates browser-contract arithmetic and prohibited-field absence, then proves Arabic RTL and English LTR rendering. Set `KDS_E2E_DELIVERY_DATE=YYYY-MM-DD` when validating a specific production date.

## Rollback

Remove only the KDS reverse-proxy route and stop only the `kitchen-display` compose service. It owns no persistent state, migrations, or upstream records, so rollback cannot alter order, logistics, driver, label, or Partner data.
