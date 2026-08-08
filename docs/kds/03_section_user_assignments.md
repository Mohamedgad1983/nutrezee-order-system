# WP-KDS-02 — User-assigned section isolation

**Evidence state:** implementation and local acceptance complete; production release evidence is recorded after merge/deployment.

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

