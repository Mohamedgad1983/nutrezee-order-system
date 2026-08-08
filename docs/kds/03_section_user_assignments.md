# WP-KDS-02 — User-assigned section isolation

**Evidence state:** **DONE and production-active 2026-08-08.** Server-enforced assignment isolation, review, CI, exact artifact deployment, all six production accounts, hardened runtime, protected live Playwright, and direct browser/API proof are complete.

## Corrected operating requirement

The Kitchen Display is not a shared all-sections dashboard. Each kitchen-section user signs in separately and must receive only the meals and total quantities assigned to that user's section. A user may be assigned more than one section through protected server configuration, but no browser control or query parameter can expand that assignment.

This correction supersedes the shared-display credential part of ASM-051. The standalone, totals-only, read-only Partner, no-PII, no-driver, and no-write boundaries remain unchanged.

## Authorization model

1. Production mounts a protected versioned JSON user manifest.
2. Each record contains a unique username, a scrypt password hash, and one or more exact Partner section codes.
3. Successful login binds the username and section-code list to the opaque in-memory server session.
4. `/api/display-config`, `/api/auth/me`, and `/api/section-totals` resolve that server session on every request.
5. Section totals are projected server-side from Partner rows using only the session assignment.
6. The response summary is assignment-scoped and exposes no global row or quantity totals.
7. Extra query parameters are rejected, so a browser cannot request a different section.
8. Logout/restart revokes the in-memory session; changing the manifest takes effect on restart.

## Verified production section source

A read-only authenticated production check on 2026-08-08 returned these exact Partner section codes:

| Section ID | Code | English name | Step |
|---:|---|---|---:|
| 6 | `drinks` | Drinks | 1 |
| 1 | `hot` | Hot | 1 |
| 5 | `pastry` | Pastry | 1 |
| 3 | `salad` | Salad | 1 |
| 4 | `soup` | Soup | 1 |
| 7 | `packing` | Packing | 9 |

The conservative production account convention is username = exact section code, one section per user. This mapping is configuration, not code, and can be replaced when operations provides staff-specific usernames. Password literals and hashes are never committed.

## Browser behavior

- English/LTR remains the initial language; Arabic/RTL remains available.
- The login explains that every account is section-scoped.
- The signed-in username and assigned section codes are visible.
- With one assignment, one full-width production card emphasizes that section's total and meal/portion quantities.
- No section selector exists.
- A missing assigned section for the chosen date shows an explicit empty state rather than other sections.

## Acceptance gates

- Unit authentication test proves two users with different assignments receive different principals.
- HTTP integration test proves `hot` never receives the `packing` section or meal and `packing` never receives `hot` data.
- Totals test proves response metadata is assignment-scoped and contains no global quantity fields.
- Playwright logs in as two section users and proves mutually exclusive screens.
- Boundary scan, API/web typecheck, Vitest, production build, fixture Playwright, container smoke, protected live Playwright, and direct production login tests must all pass before DONE.

## Executed production evidence

- PR #50 delivered the assignment model and focused UI, then merged as `251e1f2`; all three review findings were addressed before merge.
- A protected live gate found that the 15-second browser deadline could abort a valid uncached Partner read before the server's 30-second deadline. PR #51 aligned those deadlines, made the live refresh deterministic, and merged as final production release `0fd988a`.
- Final post-merge KDS CI passed 6/6 (`31256752632`) and root CI passed 14/14 (`31256752652`).
- Exact artifact SHA-256 `86f596aaeaa15c235a7edc918adbedb7155c9141c27a6224984bb74fd4c93b80` is installed at `/opt/nutrezee-kds/releases/0fd988a`.
- The active image is `sha256:e30f357f0872d3ace10d36e1dc396b5a979ba3d93a17632add3dce76de0f095c`; releases `251e1f2` and `3743aea` remain available for rollback.
- The protected `kds_users.json` manifest is mode `0640`, owned by root and supplemental group `61001`, and contains six independently salted scrypt hashes. Password literals and hashes were not committed or printed.
- Direct production verification proved exact one-to-one assignments and totals on Kuwait date `2026-08-08`: `drinks` 35, `hot` 1,885, `pastry` 686, `salad` 618, `soup` 42, and `packing` 3,266.
- A `hot` session attempting `section=packing` was rejected with HTTP 400. Every account returned exactly one matching section; global totals and prohibited fields were absent.
- Protected live Chromium passed the English-default totals flow and Arabic/RTL switch against the final release after a fresh container restart and uncached read. Direct browser proof separately showed `hot` only and `packing` only.
- Final runtime proof: health `healthy`, restart count 0, read-only root filesystem, `cap_drop=ALL`, supplemental secret group only, read-only secrets mount, public/loopback 200, and zero error-level container log events.
