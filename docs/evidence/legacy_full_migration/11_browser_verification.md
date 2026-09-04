# Browser / API Verification

Date: 2026-06-16

Status: `PARTIAL` — API (unauthenticated) verified; authenticated API + browser **BLOCKED** by missing credentials.

## What was verified (read-only, no credentials needed)

| Check | Result |
| --- | --- |
| Staging API health (internal `http://127.0.0.1:3000/health`) | `200 {"status":"ok","service":"nutrezee-api"}` |
| Staging API health via public Caddy (`https://13-140-159-201.sslip.io/health`) | `200` |
| `GET /customers` unauthenticated | `401` (auth enforced ✅) |
| `GET /orders` unauthenticated | `401` (auth enforced ✅) |
| `GET /drafts` unauthenticated | `401` (auth enforced ✅) |
| Migrated data present (direct DB read) | 19,379 legacy customers, 19,465 legacy orders, e.g. active order_numbers 24622 / 24618 / 24627 / 24626 / 24614 with frozen package names |

Unauthorized requests are correctly blocked, and migrated legacy records are present and queryable at the data layer.

## What is BLOCKED

Authenticated API verification and full **browser** verification (Playwright on the staging admin) require `E2E_BASE_URL` / `E2E_EMAIL` / `E2E_PASSWORD` (or staging admin credentials). **None are present in this environment**, so the following could not be exercised this session:

- Admin login in a browser.
- Customers list / search / migrated customer profile.
- Migrated addresses on the profile.
- Customer order history; orders list; order detail + line items.
- Payment status; delivery info on screen.
- Console-error / API-500 sweep.

> Note: even if credentials were available, two checks would **fail by data**: order **line items** (order_item=1, seed only) and **delivery info** are not migrated — see `10_reconciliation_results.md` / `mismatches.jsonl`.

## Screenshots

Path reserved: `docs/evidence/legacy_full_migration/screenshots/new_admin/`. None captured this session (browser access blocked).

## To complete this phase

Provide `E2E_BASE_URL` + `E2E_EMAIL` + `E2E_PASSWORD` (staging admin), then run `tools/e2e-staging` Playwright specs that open a migrated customer profile and a migrated order, capturing screenshots to the path above.
