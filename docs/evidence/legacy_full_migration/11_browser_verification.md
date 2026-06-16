# Browser Verification

Date: 2026-06-16

Status: `NOT_RUN`

## Legacy Admin Browser Verification

Not run.

Reason:
- `LEGACY_ADMIN_URL`, `LEGACY_EMAIL`, and `LEGACY_PASSWORD` are missing.
- No read-only legacy session was available.

## New Admin Browser Verification

Not run for migrated data.

Reason:
- `NEW_ADMIN_URL`/`E2E_BASE_URL`, `E2E_EMAIL`, and `E2E_PASSWORD` are missing in the shell.
- No migrated data exists to verify.

## Screenshots

Path reserved:
- `docs/evidence/legacy_full_migration/screenshots/`

No screenshots were captured in this migration workflow.

## Required Future Checks

- Admin login works.
- Customers list shows migrated customers.
- Customer profile opens for migrated customer.
- Customer address appears correctly.
- Customer order history appears correctly.
- Orders list shows migrated orders.
- Order detail opens.
- Order details/items appear correctly.
- Payment status appears correctly.
- Delivery info appears correctly.
- Search by legacy ID or customer phone works if supported.
- No major console errors.
- No API 500 errors.
