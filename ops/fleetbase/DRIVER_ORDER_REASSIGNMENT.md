# Driver-to-driver order reassignment — WP-OPS-03 / A22

This runbook enables the Nutrezee **Logistics Manager** to select any number of
eligible Fleetbase orders assigned to one driver and move them to another driver.

## Authorization model

- The human manager authenticates only to Nutrezee with the server-side `nz_session`
  cookie and receives every current Nutrezee delivery/driver permission:
  - `delivery.driver.read`
  - `delivery.driver.manage`
  - `delivery.assign`
  - `delivery.route.read`
  - `delivery.route.manage`
  - `delivery.status.update`
  - `delivery.driver.credentials.rotate`
  - `delivery.order.reassign`
- The role does **not** receive finance, staff/RBAC, catalog, or system-administration
  permissions. It is not equivalent to `super_admin`.
- The reassignment endpoint is fail-closed on both role and dedicated permission even
  while the wider RBAC rollout is in log/warn mode.

## Fleetbase service identity

Use a separate server-only Fleetbase identity for order reassignment. Grant only:

- `fleet-ops list driver`
- `fleet-ops view driver`
- `fleet-ops list order`
- `fleet-ops view order`
- `fleet-ops update order`

Do not grant Administrator, IAM, finance, user-management, role-management, order-delete,
or driver-delete permissions. Store its token only in `/opt/nutrezee/.env` (mode `0600`):

```dotenv
FLEETBASE_INTERNAL_API_BASE=https://fleetapi.13-140-159-201.sslip.io
FLEETBASE_ORDER_MANAGER_TOKEN=<server-only token>
```

Never paste the token into chat, Git, browser storage, screenshots, CI logs, or captured
command output. The browser submits only Fleetbase `driver_*` and `order_*` public ids;
Nutrezee derives all upstream UUIDs server-side.

## Operational behavior

1. Open **Delivery → Reassign orders / نقل الأوردرات**.
2. Select source driver, target driver, and delivery date.
3. Select individual eligible orders or **Select all eligible**. There is no product/UI
   batch-size cap; the server submits bounded chunks of 100 to Fleetbase.
4. Confirm the exact selected count and run the operation.
5. Read the recorded batch result. A partial result lists every order that failed or whose
   post-write assignment could not be confirmed; inspect it before retrying.

Orders with `started_at`, terminal status, or the source driver's current active-job UUID
are visibly blocked under ASM-053. Fleetbase v0.7.48 bulk assignment changes only
`driver_assigned_uuid`; it does not transfer current-job/activity state, so moving an active
job would leave driver sessions inconsistent.

## Acceptance checks

1. `ops_manager` and Logistics Manager without `delivery.order.reassign` receive HTTP 403.
2. Browser/API responses contain order/tracking/status/time only—no customer, phone,
   address, payload, or upstream UUID.
3. An arbitrary UUID, same source/target driver, unknown order, started/current/terminal
   order, or order that left the source after preflight is not reassigned.
4. A selection larger than 100 is processed in multiple upstream chunks with no UI cap.
5. Every request creates HIGH requested + final audit events and per-order completed/failed
   ledger rows. Partial upstream failure is reported honestly; it is never flattened to success.
6. New driver sees successfully moved orders; old driver no longer sees them in Navigator.
7. Fleetbase vendor diff and Navigator `/legacy` diff remain zero.

## Rollback

- Revoke the human `logistics_manager` role to remove all Logistics Manager UI/API access.
- Revoke `delivery.order.reassign` to disable only reassignment while preserving other
  logistics functions.
- Revoke the Fleetbase order-manager token and remove `FLEETBASE_ORDER_MANAGER_TOKEN`.
- Retain migration `0026` and its audit ledger; use a corrective migration to retire the
  role/permission if required.
