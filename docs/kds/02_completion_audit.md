# WP-KDS-01 — A-to-Z completion audit

**Audit date:** 2026-08-08
**Verdict:** **PRODUCTION-READY AND LIVE for the authorized Release-1 totals-only scope.** The standalone software, review, CI, exact artifact/image, protected credentials, hardened VPS runtime, HTTPS route, live Partner arithmetic, privacy/security controls, and bilingual browser flow are proven.

Evidence labels in this audit:

- **PROVEN** — authoritative source, test, CI, GitHub, or VPS runtime evidence exists.
- **PARTIAL** — implementation exists, but required evidence is incomplete. No requirement remains in this state.
- **BLOCKED** — cannot be exercised without a protected external input. No requirement remains in this state.

## Requirement-by-requirement evidence

| # | Objective requirement | State | Authoritative evidence | Remaining proof |
|---|---|---|---|---|
| 1 | Standalone KDS, completely decoupled from Navigator, Fleetbase, drivers, vehicles, labels, and the stacked feature branches | **PROVEN** | Top-level `kitchen-display/` has its own package lock, API, React UI, authentication, Docker image, Compose project, CI workflow, and hostname fragment. `scripts/verify-boundaries.mjs` scans every runtime source file for the forbidden couplings and passed. PR #46 was based directly on `origin/main` and merged independently as `74a703c`; the earlier stacked PR #45 was closed. | None for Release 1. |
| 2 | Partner integration is server-only and read-only | **PROVEN** | `PartnerSource.requestPage` hard-codes `method: 'GET'`, header-only `X-Api-Key`, no request body, redirect rejection, timeouts, pagination/size bounds, exact `delivery_date` and allow-listed `kitchen` filters, and production pinning to `https://nutreeze.com/integration/order-items`. The deployed boundary scan passed. The independent live verifier issued four paginated GET requests only, and the service has no Partner/database/workflow write path. | None for Release 1. |
| 3 | Release 1 shows quantities only by section, exact meal, and portion | **PROVEN** | `contracts.ts` exposes only aggregate display fields. `aggregateDay` uses six-decimal scaled integer arithmetic and counts every section assignment. The independent live verifier matched the complete display projection for 3,178 rows: source quantity 3,266, assignment quantity 6,532, six sections, 222 meal/portion groups, and zero unrouted. Every live row had multiple section assignments and all were counted; no raw rows were retained. | None. |
| 4 | No PII, order/item identifiers, driver data, barcode, or label data reaches the browser | **PROVEN** | Public contracts omit prohibited fields and aggregation discards source identifiers. The authenticated live JSON and browser privacy scans passed; the 117-line container-log scan found no customer, phone, address, order/item identifier, driver, barcode, label, API key, or display password. | None. |
| 5 | Independent authentication and security boundary | **PROVEN** | Dedicated protected secrets, scrypt password hash, opaque in-memory sessions, HTTPS, Origin checks, throttling, allow-listed kitchens, CSP/HSTS/X-Frame/nosniff/no-referrer headers, API `no-store`, and safe error/logging paths are active. Live login returned 200; the cookie was Secure/HttpOnly/SameSite=Strict; unauthenticated totals returned 401; logout revoked the session; unsafe method returned 405; invalid date/kitchen/extra query returned 400. The container is healthy with zero restarts, non-root `node`, read-only root, `cap_drop=ALL`, no direct secret env, and only a read-only secrets bind. | None. |
| 6 | Independent PR merged with all gates green and review defects closed | **PROVEN** | PR #46 merged as `74a703c` after 18/18 review threads resolved. Production fix PR #48 merged as `5955054`. English-default PR #49 merged as `3743aea`; its post-merge KDS/root CI passed 6/6 + 14/14 (`31254271648`, `31254271662`). | None. |
| 7 | Deploy as its own service and hostname | **PROVEN** | Exact artifact SHA-256 `afb83d997d45924554de724a43d10d7e8e5568edf97b62f4add01a094db25240` is installed at `/opt/nutrezee-kds/releases/3743aea`; image `sha256:505154f8ea522b178e8dd7cd4797c95a24668f6845099228873feaca904014c0` is running. The independent service is live at `https://kds.13-140-159-201.sslip.io`; HTTP redirects to HTTPS and Docker health is green. It shares only the reverse-proxy network required by Caddy and otherwise retains its own Compose project/network/image/process/loopback port/credentials. | None. |
| 8 | Visible bilingual and operational acceptance | **PROVEN** | Fixture Chromium Playwright passed 2/2. Protected live Playwright passed the applicable English-default/Arabic totals test against release `3743aea`. The release sets the initial document, login, and display to English/LTR, migrates past the old Arabic-default preference key once, and retains the Arabic/RTL toggle as an explicit persistent operator choice. Direct production-browser inspection confirmed `lang=en`, `dir=ltr`, “Kitchen sign in”, English field labels, and the Arabic toggle. | None. |
| 9 | Registers, runbooks, evidence, rollback, and final handoff | **PROVEN** | `README.md`, `docs/kds/01_standalone_section_totals.md`, this audit, `NEXT_ACTION_QUEUE.md`, `build_progress_register.md`, `07_BLOCKERS_AND_DECISIONS.md`, A17–A19, and ASM-051 record the production topology, exact release, acceptance evidence, credential handoff, rollback, and DONE status. KDS owns no persistent database or migration, so rollback is route removal plus stopping only its Compose service. | None. |

## Protected inputs and operator handoff

The credential gate is resolved. The Partner credential and display-password hash are non-empty, root-owned, mode `0640`, group `61001`, inside a root-owned mode-`0750` group-`61001` directory. Compose supplies only that supplemental group to the non-root runtime. Neither secret is stored directly in container environment variables.

The current display-password handoff is retained only in `/root/nutrezee-kds-display-initial-password`, mode `0600` root:root. The operator retrieves it through root SSH, rotates away from temporary credentials after secure handoff, and removes the plaintext handoff file. Its literal value must never be copied into source control, documentation, browser evidence, or logs.

## Executed completion sequence

1. Protected-file ownership, mode, non-empty state, and non-root readability were verified without printing secret contents.
2. The exact `3743aea` release runs in its isolated Compose project; `/health` is 200 and the container remains healthy with zero restarts.
3. The KDS-only Caddy route was installed after validation; HTTP→HTTPS, public 200, TLS, headers, and unauthenticated 401 passed.
4. Dedicated display authentication succeeded and the live Partner date/kitchen read returned 200.
5. An independent in-memory verifier recomputed every source, assignment, section, meal, portion, multi-section, and unrouted total and exactly matched the display; raw rows were not persisted.
6. Browser/API and container-log scans proved prohibited identifiers, PII, Partner credential, and display password absent; the deployed boundary scan proved the only Partner method is GET and there is no write path.
7. Protected live Playwright and direct production-browser acceptance passed Arabic/English, totals, session lifecycle, and responsive rendering.
8. The discovered non-root protected-file defect was fixed in PR #48, all KDS/root CI and affected local/live gates were rerun green, and WP-KDS-01 was promoted to DONE.

## Release-1 boundary

Production-ready here means the user-authorized totals-only Kitchen Display: read-only Partner data, quantity aggregation, and bilingual display. It intentionally does not provide kitchen workflow mutations, recipes, inventory, forecasting, driver/logistics functions, labels/barcodes, customer details, or order identifiers. Those are not incomplete Release-1 features; they are explicit out-of-scope boundaries.
