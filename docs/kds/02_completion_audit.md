# WP-KDS-01 — A-to-Z completion audit

**Audit date:** 2026-08-08
**Verdict:** **NOT YET PRODUCTION-READY — external credential gate only.** The standalone software, review, CI, artifact, image, deployment topology, and non-networked VPS runtime are proven. Service activation and live Partner/HTTPS acceptance are not proven and must remain open.

Evidence labels in this audit:

- **PROVEN** — authoritative source, test, CI, GitHub, or VPS runtime evidence exists.
- **PARTIAL** — implementation exists, but the required live-scope evidence is still missing.
- **BLOCKED** — cannot be exercised without a protected external input.

## Requirement-by-requirement evidence

| # | Objective requirement | State | Authoritative evidence | Remaining proof |
|---|---|---|---|---|
| 1 | Standalone KDS, completely decoupled from Navigator, Fleetbase, drivers, vehicles, labels, and the stacked feature branches | **PROVEN** | Top-level `kitchen-display/` has its own package lock, API, React UI, authentication, Docker image, Compose project, CI workflow, and hostname fragment. `scripts/verify-boundaries.mjs` scans every runtime source file for the forbidden couplings and passed. PR #46 was based directly on `origin/main` and merged independently as `74a703c`; the earlier stacked PR #45 was closed. | None for Release 1. |
| 2 | Partner integration is server-only and read-only | **PARTIAL** | `PartnerSource.requestPage` hard-codes `method: 'GET'`, header-only `X-Api-Key`, no request body, redirect rejection, timeouts, pagination/size bounds, exact `delivery_date` and allow-listed `kitchen` filters, and production pinning to `https://nutreeze.com/integration/order-items`. Unit tests and the boundary scan passed. Browser contracts contain no API key. | A live request/audit cannot be proven until the dedicated KDS read-only key exists. Confirm only GET requests and no upstream/database/workflow writes during live acceptance. |
| 3 | Release 1 shows quantities only by section, exact meal, and portion | **PARTIAL** | `contracts.ts` exposes only date/kitchen/timestamps, aggregate summaries, section metadata, meal metadata, portion, and totals. `aggregateDay` uses six-decimal scaled integer arithmetic, counts every multi-section assignment, and preserves missing routes in an explicit `unrouted` lane. Vitest 31/31 and fixture Playwright 2/2 passed, including multi-section, portion split, fractional quantities, stale-date response suppression, and visible unrouted behavior. | Recompute at least two totals from the exact live Partner rows and compare them with the live display. |
| 4 | No PII, order/item identifiers, driver data, barcode, or label data reaches the browser | **PARTIAL** | The public TypeScript contracts omit those fields; the aggregation projection discards `itemRef`; boundary tests inject customer/order/phone/address data and prove it is absent. Live Playwright scans the returned JSON for customer, phone, address, order, item, API-key, driver, vehicle, barcode, and label terms. | Execute that scan against the live authenticated HTTPS response. |
| 5 | Independent authentication and security boundary | **PARTIAL** | Dedicated scrypt password hash, opaque in-memory sessions, Secure/HttpOnly/SameSite=Strict cookies, Origin checks on mutations, bounded login throttling, strict production HTTPS, allow-listed kitchens, CSP/security headers, size limits, fail-closed source validation, secret-file support, redacted errors/logging, non-root read-only image, all Linux capabilities dropped, and no-new-privileges are implemented and tested. The exact image passed a hardened, network-disabled `/health` smoke on the VPS as user `node`, then the temporary container was removed. | Verify the real HTTPS cookie and authentication flow after the operator-selected password hash is installed. |
| 6 | Independent PR merged with all gates green and review defects closed | **PROVEN** | PR #46 merged as `74a703c` after 18/18 review threads resolved. Final pre-merge KDS runs `31251176353` and `31251178417` passed 6/6; root runs `31251176357` and `31251178414` passed 14/14. Post-merge KDS `31251266861` passed 6/6 and root `31251266863` passed 14/14. Documentation handoff CI `31251577364` passed 14/14. | None. |
| 7 | Deploy as its own service and hostname | **PARTIAL** | Exact merge archive SHA-256 `1e3b0f572a1c73b86538f20f457d64cc03064422db0b9c3220af6d2e9c2c500d` is staged at `/opt/nutrezee-kds/repo`. Hardened image `sha256:efe4a3ecbe416f2c9715190942e284ffcb902687ff115f05f4639e2469bb7289` is built. Staging Compose and combined Caddy configuration validate. The service has a separate project/image/process/port/credential set and proposed hostname `kds.13-140-159-201.sslip.io`; DNS resolves to `13.140.159.201`. | Service and Caddy route intentionally remain inactive until both secret files exist; HTTPS certificate/response are therefore not yet available. |
| 8 | Visible bilingual and operational acceptance | **PARTIAL** | Fixture Chromium Playwright passed Arabic RTL, English LTR, totals, unrouted warning, privacy, no refetch on language toggle, stale-response suppression, and mobile sign-out. A credential-protected live Playwright configuration is committed. | Run live Playwright plus the ten-step operational checklist for the selected Kuwait delivery date and every configured kitchen. |
| 9 | Registers, runbooks, evidence, rollback, and final handoff | **PARTIAL** | `README.md`, `docs/kds/01_standalone_section_totals.md`, this audit, `NEXT_ACTION_QUEUE.md`, `build_progress_register.md`, `07_BLOCKERS_AND_DECISIONS.md`, A17, and ASM-051 contain the current topology, commands, evidence, rollback, and exact blocker. KDS owns no persistent database or migration, so rollback is route removal plus stopping only its Compose service. | Record live evidence, promote WP-KDS-01 to DONE, and issue the final production-readiness handoff. |

## Current protected-input gate

Both files were re-verified absent/empty on the VPS on 2026-08-08:

1. `/opt/nutrezee-kds/secrets/kds_partner_api_key` — dedicated KDS Partner read-only credential; do not reuse the label-service key.
2. `/opt/nutrezee-kds/secrets/kds_display_password_hash` — scrypt hash of a password selected by the kitchen-display operator.

Both files must be root-managed, non-empty, and mode `0600`. The operator password must not be invented by an agent or exposed in shell arguments, logs, source control, or ordinary chat.

## Exact completion sequence after provisioning

1. Validate ownership/mode/non-empty metadata without printing either secret.
2. Start only `/opt/nutrezee-kds/repo/kitchen-display/compose.staging.yml` and verify container health plus loopback port `8180`.
3. Install the already-validated KDS Caddy fragment and reload Caddy; verify HTTPS certificate, headers, and unauthenticated 401 behavior.
4. Authenticate with the operator credential and execute the live Partner date/kitchen read.
5. Recompute source, assignment, section, meal, portion, multi-section, and unrouted quantities from exact upstream rows.
6. Prove the browser/API response contains no prohibited identifiers or PII and the request trace contains only Partner GET operations with no writes.
7. Run protected Arabic/English live Playwright and the operational checklist.
8. Fix any discovered in-scope defect, rerun all affected local/CI/live gates, update registers to DONE, and publish the final handoff.
