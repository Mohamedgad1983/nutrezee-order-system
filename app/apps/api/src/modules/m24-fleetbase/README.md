# m24-fleetbase — nutrezee → Fleetbase order bridge

Our integration code (Fleetbase stays config-only/AGPL). Sends nutrezee orders to Fleetbase for
dispatch and writes delivery status back. Branch `build/fleetbase-integration`.

## Pieces
- `fleetbase.client.ts` — Fleet-Ops REST client. Auth `Authorization: Bearer ${FLEETBASE_API_KEY}` at
  `${FLEETBASE_API_BASE}/v1` (default `https://fleetapi.13-140-159-201.sslip.io`). `upsertContact`,
  `createOrder`, `findByInternalId`, `getOrder`, `organizations`; `verifyWebhookSignature` (HMAC-SHA256 of
  the RAW body in the header literally named **`Signature`**). Key is env-only and never logged.
- `address-assembler.ts` — `hasRealCoordinate` (the geo gate: present, numeric, ≠0,0, inside Kuwait bbox),
  `composeStreet1` (Block/Street/House), `freezeAddress`, `assembleDropoff` (attaches `location` ONLY when real).
- `order-mapper.ts` — builds `POST /v1/orders` (`type:transport`, `internal_id=order_number`, pickup/dropoff,
  entities, scheduled_at); `mapEventToState` (webhook event → state; `canceled` has one `l`).
- `fleetbase.service.ts` — `dispatchOrder(orderId)`: read-only load (order→customer→address→area) → freeze →
  **geo gate** (pending → HELD, flagged, not sent) → upsert contact → idempotent create → audit. `applyWebhookEvent`.
- `fleetbase.controller.ts` — `POST /integrations/fleetbase/webhook` (HMAC-verified, fails closed).
- Migration `app/db/migrations/0024_fleetbase_dispatch.sql` — the `fleetbase_dispatch` bridge table.

## Env / config
- `FLEETBASE_API_KEY` (required), `FLEETBASE_API_BASE` (optional), `FLEETBASE_WEBHOOK_SECRET` (webhook verify).
- Settings: `fleetbase_pickup_place` (central kitchen, needs real coords), `fleetbase_area_fleet_map` (area→fleet, future).

## Status & gates
- Built + unit-tested + 2B-verified against live Fleetbase (5 synthetic test orders).
- **NOT deployed; migration 0024 NOT applied to staging.** Real orders are gated on owner approval:
  geocoding (fill location_pin so orders pass the gate), drivers/fleets/area-map, webhook registration
  (console), and wiring the dispatch trigger into the order lifecycle.

## Why orders link to a frozen address (not live)
`customer_order` has no `address_id`; the live order→address path only works because customers are 1:1
with addresses today. We FREEZE the resolved address onto the bridge row at dispatch so a later address
edit can never misroute a past order.
