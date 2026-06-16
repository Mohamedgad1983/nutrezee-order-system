# Import Plan

Date: 2026-06-16

## Safety Defaults

- Default mode: dry-run.
- Write mode requires `MIGRATION_APPLY=true`.
- Target must be local or staging only.
- No production import.
- No destructive SQL.
- No delete outside owner rollback ports.

## Existing New-System Import API

Verified:
- `POST /imports/:type/dry-run`
- `POST /imports/:type/apply`
- `GET /imports/:batchId`
- `POST /imports/:batchId/rollback`

Supported types in code:
- `customer`
- `catalog`
- `active_plans`

Existing behavior:
- Apply requires prior dry-run of the same source hash.
- Apply is idempotent through `sync_record`.
- Rollback goes through owner-module rollback ports.
- Import rows are recorded in `import_row_result`.
- Apply writes audit and outbox events.

## Import Order

1. Master/reference data.
2. Catalog products/packages and dependent masters.
3. Customers.
4. Customer addresses.
5. Orders / active plans.
6. Order details/items if source details exist and schema support is approved.
7. Payments.
8. Deliveries / fulfillment days.
9. Dietary/allergy relations.
10. Reconciliation run.

## Current Gaps Before Full Clone Apply

Needs Confirmation:
- Current M19 code supports the existing DEC-012 scope: catalog, customers, active plans.
- The mission asks for a broader full clone: order_details, deliveries, drivers, coupons, dietician requests. Those are not all first-class import targets today.
- `order_item` and `fulfillment_day` are derived/child tables and do not currently carry `origin` or `import_batch_id` directly.
- `sync_record.object_type` does not include address, order_detail, delivery, driver, coupon, or dietician_request.

## Commands

Existing project commands:
- From `app/`: `npm run typecheck`
- From `app/`: `npm run lint`
- From `app/`: `npm run build`
- From `app/`: `npm run test:placeholder`
- From `app/`: `npx vitest run`

New helper added by this branch:
- From repo root: `node tools/legacy-full-migration/validate-normalized.mjs`
- Optional input dir: `node tools/legacy-full-migration/validate-normalized.mjs --input docs/evidence/legacy_full_migration/exports/normalized`

This helper validates normalized JSONL files only. It does not connect to legacy or new databases and cannot import data.

## Current Session Result

Status: `NOT_RUN`

Reason:
- No legacy source data.
- No `NEW_DATABASE_URL`.
- No `MIGRATION_APPLY=true`.
