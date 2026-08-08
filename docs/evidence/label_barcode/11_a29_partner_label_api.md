# A29 — Partner v2 label-source correction

**Date:** 2026-08-08
**Mode:** Fix Mode
**Status:** COMPLETE — deployed and read-only verified on staging

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

## Implementation and test result

- Commit: `0147c86` on `build/wp-lbl-a27-legacy-label-barcode` (PR #44).
- Full local regression: 70 files / 393 tests passed.
- Focused final A29 source + label integration: 28/28 passed.
- Lint, API typecheck/build, cross-module-write scan, no-GET-mutation scan and Partner snapshot
  guards passed. Local Docker was unavailable; CI supplied the authoritative Docker validation.
- GitHub CI run `31244633933`: all 14 jobs passed, including clean-install full typecheck,
  Docker/Compose builds, eight suite jobs and both boundary scans.

The client performs GET only, requires `mode=live`, pins the production base host, paginates both
endpoints, validates count/cursor/server-time envelopes, deduplicates concurrent date loads, and
does not cache errors. The service keeps local authoritative dish-day priority, uses Partner only
when local rows are absent, and repeats the readiness check at print confirmation so a direct POST
cannot bypass it.

## Staging deployment proof

| Check | Result |
|---|---|
| Source archive | commit `0147c86`; SHA-256 `fbc33b0845cd…` |
| New API image | `sha256:d7108de4f1bf…` |
| Rollback image | `nutrezee-api:pre-a29-20260808` → `sha256:d6db705521a3…` |
| Secret posture | existing 48-character key copied to `/opt/nutrezee/.env`; root-owned mode `0600`; container/file values matched; log secret scan clean |
| Runtime guard | production without key returned `not_configured`; configured process returned `configured` |
| Compiled client live read | complete real order returned 4 rows; incomplete real order returned `nutrition_incomplete` |
| Label-service live read | mapped real order returned `meal_source=partner_api_v2`, 4 rows, `complete=true` |
| Public boundary | `/nz/health` HTTP 200; unauthenticated Fleet-Ops render HTTP 401 JSON |
| Database safety | before = after: customers 19,483; orders 20,204; print events 1; barcodes 1; collections 1 |

Only the Nutrezee API container was recreated. Admin, Console, Caddy, PostgreSQL, Fleetbase,
Partner and legacy services were not written or restarted. No label preview/print was triggered,
no migration ran, and unattended dispatch remains disabled.

## Honest residual boundary

The data-source defect is closed, but the API cannot fabricate the 187 incomplete upstream
orders: operations must correct their missing protein/fat values in the authoritative Partner
source before those labels can print. Driver/area batch availability still depends on a complete
current-day Fleetbase dispatch/assignment feed. Exact physical 100 × 70 mm scaling and Code 128
camera decoding still require the paper/device pilot; this session does not claim physical proof.
