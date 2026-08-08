# WP-KDS-01 — Standalone section totals release

**Evidence state:** **DONE and production-active 2026-08-08.** Software, review, CI, exact artifact deployment, protected credentials, live Partner arithmetic, privacy/security, and bilingual browser acceptance are proven.

## Release evidence

- PR #46 delivered the standalone application and merged as `74a703c` after all 18 review threads were resolved.
- PR #48 fixed the verified non-root protected-secret mount defect and merged as production release `5955054`.
- PR #48 pre-merge KDS/root workflows passed 6/6 and 14/14 (`31252914322`, `31252914332`); post-merge runs `31253038731` and `31253038740` passed 6/6 and 14/14.
- Production artifact SHA-256: `57698350d3eff6602122a24963325043ad7e11be37d03998f4cdc9f42387e5fa`.
- Production release path: `/opt/nutrezee-kds/releases/5955054`; `/opt/nutrezee-kds/repo` is its active symlink.
- Production image: `sha256:dbff652868a8bf292b488ed367326b3003125cc29ce268bdffd6cb472f893a32`, also retained as version tag `nutrezee-kitchen-display:5955054`.
- Production URL: `https://kds.13-140-159-201.sslip.io`; Caddy's pre-KDS configuration backup is `/opt/nutrezee/repo/docker/Caddyfile.active.pre-kds-5955054`.
- Runtime proof: Docker health `healthy`, restart count 0, user `node`, supplemental group `61001`, read-only root, `cap_drop=ALL`, no direct secret environment entries, read-only `/run/secrets`, loopback-only host port `8180`, and a single reverse-proxy connection to `nutrezee_default` in addition to its own isolated Compose network.
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
| Visible bilingual journey | `npm run test:e2e` | Chromium English-default login/totals → Arabic toggle; unrouted visible; PII absent |
| Container image | `docker build -f Dockerfile -t nutrezee-kds:verify .` | hardened runtime image builds and its ESM entrypoint imports |
| Runtime health | Start the image with test-only configuration, then request `/health` inside the isolated container | HTTP 200 with `service=nutrezee-kds`; no Partner request is made |

## Production deployment

Installed protected inputs (never commit or print them):

1. A dedicated Partner read-only API key for KDS.
2. A display password chosen by the operator, stored only as a generated scrypt hash.
3. Confirmed Partner kitchen identifier list (`main` is the current conservative configurable default).

Host layout:

```text
/opt/nutrezee-kds/
  releases/5955054/     # exact production release
  repo -> releases/5955054
  secrets/              # mode 0750, owner root, group 61001
    kds_partner_api_key       # mode 0640, owner root, group 61001
    kds_display_password_hash # mode 0640, owner root, group 61001
```

`KDS_SECRET_GID` defaults to the dedicated numeric group `61001`. The Compose service adds that supplemental group to its non-root Node user. Do not use root-only `0600` files with the directory bind mount: the non-root runtime cannot read them. Do not grant world-readable permissions.

The initial display password plaintext is retained only in `/root/nutrezee-kds-display-initial-password`, mode `0600` root:root, for secure operator retrieval. Retrieve it through root SSH, rotate the display credential after handoff, then remove the plaintext handoff file. The Partner key and password hash remain mode `0640` root:61001 inside the mode-`0750` root:61001 secrets directory.

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
3. English is the default with `lang=en` and `dir=ltr`; the Arabic toggle changes to `lang=ar` and `dir=rtl` and persists the operator's explicit selection.
4. Every section returned by Partner is visible and ordered by `step_no`.
5. Recompute at least two meal/portion totals from the exact Partner rows; displayed totals match.
6. A multi-section row contributes to all of its upstream sections.
7. An unrouted source row, if present, appears in the warning lane; if none exists, upstream and display both show zero.
8. Search the JSON/browser/network evidence for item refs, order numbers, customer names, phones, addresses, API keys, delivery actors, and label data; none may appear.
9. Verify the service issued only Partner GET requests and caused no Partner/database/workflow writes.
10. Run `KDS_E2E_BASE_URL=https://<kds-host> KDS_E2E_USERNAME=<display-user> KDS_E2E_LIVE=1 npm run test:e2e:staging` after exporting `KDS_E2E_PASSWORD` through a protected interactive environment. The live suite requires a successful totals response, validates browser-contract arithmetic and prohibited-field absence, then proves Arabic RTL and English LTR rendering. Set `KDS_E2E_DELIVERY_DATE=YYYY-MM-DD` when validating a specific production date.

### Executed production result — 2026-08-08

| Check | Verified result |
|---|---|
| Health and TLS | Loopback `/health` and public HTTPS returned 200; HTTP redirects to HTTPS. |
| Authentication | Unauthenticated totals returned 401; login 200; cookie Secure/HttpOnly/SameSite=Strict; logout revoked the session. |
| Request safety | Totals accepts authenticated GET only; POST returned 405; invalid date, kitchen, and extra query returned 400; API responses are `no-store`. |
| Partner access | Independent verifier made four paginated `GET /integration/order-items` requests only; the KDS has no Partner/database/workflow write path. |
| Exact projection | 3,178 source rows; source quantity 3,266; section-work quantity 6,532; six sections; 222 meal/portion groups; zero unrouted. Every independently aggregated group exactly matched the saved display response; no raw upstream rows were retained. |
| Privacy and secrets | Live JSON/browser scan and 117-line container log scan found no prohibited identifiers, PII, Partner key, or display password. |
| Browser | Protected live Chromium Playwright passed the applicable Arabic/English totals journey; direct browser validation passed login, logout, RTL/LTR, six section cards, and 390×800 rendering with no horizontal overflow. |

## Rollback

Remove only the KDS reverse-proxy route and stop only the `kitchen-display` compose service. It owns no persistent state, migrations, or upstream records, so rollback cannot alter order, logistics, driver, label, or Partner data.
