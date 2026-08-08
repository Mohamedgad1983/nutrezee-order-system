# A29 — Partner v2 label-source correction

**Date:** 2026-08-08
**Mode:** Fix Mode
**Status:** IN PROGRESS

## Verified defect

The deployed label engine reads nutrition only from `customer_dish_day_item`. The live
2026-08-08 local source contains zero dish days/items, while the authorized read-only Partner
Kitchen & Labels v2 API returns 3,210 physical order items for 739 orders. Therefore the
existing print layout is structurally correct but its meal table is empty for current-day work.

The live read-only audit verified exact `meal_id` joins for all 3,210 current-day items. It also
found 187 orders containing at least one upstream item with incomplete protein/fat nutrition.
Those orders cannot be made print-complete without an authoritative upstream correction and
must be blocked rather than guessed.

## Corrective contract

1. Fleetbase remains the sole current-day order/assignment authority.
2. The API reads Partner v2 server-side with GET only; the key never reaches the browser,
   logs, error bodies, source control, or audit payloads.
   A production API process cannot start without the key, and only `mode=live` responses pass.
3. Order items are selected by exact `delivery_date` and exact `order_number`.
4. Nutrition joins by exact documented `meal_id` only; no dish-name matching or fallback math.
   The live contract fields are `nutrition.protein_g`, `carbs_g`, `fat_g`, and `calories`;
   each printed line value is the catalog serving value multiplied by the exact item `qty`.
5. Missing catalog rows, malformed responses, request failure, or incomplete nutrition fail
   closed before any print dialog or print-event write.
6. Existing authoritative `customer_dish_day_item` rows remain first priority for historical
   or explicitly entered operational data. Partner v2 supplies the current gap only when that
   source is absent.
7. Date reads are bounded, paginated, cached briefly, and concurrent requests share one
   in-flight load. Errors are never cached.

Live schema verification found `qty` values 1, 2 and 3 in the first 1,000 current-day items;
therefore quantity-aware line totals are required for the bottom nutrition total to remain exact.

## Predeclared source files

- `AGENTS.md`
- `19_Roadmap/build_progress_register.md`
- `19_Roadmap/NEXT_ACTION_QUEUE.md`
- `docs/evidence/label_barcode/11_a29_partner_label_api.md`
- `app/apps/api/src/modules/m25-label/partner-label-source.ts`
- `app/apps/api/src/modules/m25-label/label.service.ts`
- `app/apps/api/src/app.module.ts`
- `app/packages/shared/src/index.ts`
- `app/.env.example`
- `docker/compose.staging.yml`
- `app/tests/unit/ts-u-partner-label-source.test.ts`
- `app/tests/integration/ts-i-label-barcode.test.ts`

No Fleetbase vendor source, Navigator `/legacy`, Partner write endpoint, migration, or secret
value is in scope.

## Completion evidence required

- Unit proof for auth/header secrecy, pagination, exact order/date/catalog joins, caching, and
  malformed/incomplete fail-closed behavior.
- Label-service integration proof for local-source precedence, Partner fallback, explicit no
  source, and incomplete Partner nutrition block before print recording.
- Existing label/barcode/collection and extension regression suites.
- API typecheck/build plus repository security/secret scans.
- Staging read-only proof using the protected production key, without printing or changing any
  real order/customer/Partner row.
