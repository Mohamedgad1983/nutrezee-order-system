# WP-KDS-01 — Standalone section totals release

**Evidence state:** software merged and independently CI-green 2026-08-08; exact merge artifact and hardened image staged on the VPS. Dedicated credentials, service activation, and live Partner/HTTPS acceptance remain required before DONE.

## Release evidence

- PR #46 merged as `74a703c` after all 18 review threads were resolved.
- Final pre-merge KDS workflows passed 6/6 and root workflows passed 14/14; post-merge runs `31251266861` and `31251266863` passed 6/6 and 14/14 respectively.
- Artifact SHA-256: `1e3b0f572a1c73b86538f20f457d64cc03064422db0b9c3220af6d2e9c2c500d`.
- Staged VPS image: `sha256:efe4a3ecbe416f2c9715190942e284ffcb902687ff115f05f4639e2469bb7289`.
- Staging Compose and the combined existing-plus-KDS Caddy configuration validate.
- Safety check: zero KDS containers, zero port-8180 listeners, zero live KDS proxy matches, and both protected credential files absent/empty. No route or service was activated.
- The exact staged image also passed a hardened network-disabled VPS `/health` smoke as user `node` with a read-only root filesystem, all capabilities dropped, and no-new-privileges; the temporary container was removed and left no listener. The proposed hostname resolves to the VPS, while HTTPS correctly remains unavailable before route activation.
- The requirement-by-requirement completion verdict is maintained in `docs/kds/02_completion_audit.md`.

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
| Container image | `docker build -f Dockerfile -t nutrezee-kds:verify .` | hardened runtime image builds and its ESM entrypoint imports |
| Runtime health | Start the image with test-only configuration, then request `/health` inside the isolated container | HTTP 200 with `service=nutrezee-kds`; no Partner request is made |

## Staging provisioning

Required protected inputs (do not commit or print them):

1. A dedicated Partner read-only API key for KDS.
2. A display password chosen by the operator, stored only as a generated scrypt hash.
3. Confirmed Partner kitchen identifier list (`main` is the current conservative configurable default).

Host layout:

```text
/opt/nutrezee-kds/
  repo/                 # this repository checkout
  secrets/              # mode 0750, owner root, group 61001
    kds_partner_api_key       # mode 0640, owner root, group 61001
    kds_display_password_hash # mode 0640, owner root, group 61001
```

`KDS_SECRET_GID` defaults to the dedicated numeric group `61001`. The Compose service adds that supplemental group to its non-root Node user. Do not use root-only `0600` files with the directory bind mount: the non-root runtime cannot read them. Do not grant world-readable permissions.

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

`compose.staging.yml` creates its own default network and also joins only the KDS container to the existing reverse-proxy network (`nutrezee_default`, override with `KDS_REVERSE_PROXY_NETWORK`). This is the single infrastructure link required for Caddy; KDS remains a separate Compose project, image, process, port, credential set, and hostname. Add the route in `deploy/Caddyfile.fragment`, validate Caddy, and reload it without restarting or editing the order, delivery, or label services.

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
