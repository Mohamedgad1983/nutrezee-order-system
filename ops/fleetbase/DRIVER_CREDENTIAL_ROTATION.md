# Driver credential rotation — WP-OPS-02 / A21

This runbook enables the Nutrezee **Logistics Manager** to rotate passwords for the
existing Fleetbase driver accounts from the Nutrezee admin panel.

## Security model

- The browser authenticates only to Nutrezee with a server-side `nz_session` cookie.
- Nutrezee requires the active `logistics_manager` role and the dedicated
  `delivery.driver.credentials.rotate` permission. This endpoint ignores the wider
  log/warn RBAC rollout and fails closed on a missing grant.
- A separate, server-only Fleetbase service identity performs the upstream call. It must
  have exactly these Fleetbase permissions:
  - `fleet-ops list driver`
  - `fleet-ops view driver`
  - `iam change-password-for user`
- The service identity is not a human Logistics Manager and must not receive Administrator,
  IAM User Manager, role-management, user-list, user-create, or user-update permissions.
- Nutrezee accepts only a Fleetbase `driver_*` public id. It fetches that driver through
  Fleetbase and derives `user_uuid` server-side before calling Fleetbase's standard
  `/int/v1/auth/change-user-password` route. The browser can never submit a user UUID.
- Passwords are never stored, logged, emailed, returned by the API, or written to audit.
  The local ledger stores only driver public id, actor, outcome, and a non-sensitive failure code.

## Secret provisioning gate

Provision the Fleetbase service identity through the canonical Fleetbase IAM console or an
approved one-time administrator procedure. Generate a fresh personal access token and place
it only in `/opt/nutrezee/.env` (mode `0600`):

```dotenv
FLEETBASE_INTERNAL_API_BASE=https://fleetapi.13-140-159-201.sslip.io
FLEETBASE_CREDENTIAL_MANAGER_TOKEN=<server-only token>
```

Never paste the token into chat, Git, the admin browser, screenshots, CI logs, or a command
whose output is captured. The deployment reads it through `docker/compose.staging.yml`.

## Logistics Manager setup

1. In Nutrezee **Staff & roles**, create or select the human manager account.
2. Grant `logistics_manager`. Do not grant `super_admin` merely for password rotation.
3. Sign in as that manager and open **Delivery → Driver passwords / كلمات المرور**.
4. Confirm that the driver list shows masked phone hints only.

## Acceptance checks

1. A normal `ops_manager` receives HTTP 403 for `GET /driver-credentials` and the rotation POST.
2. A `logistics_manager` without the dedicated permission receives HTTP 403 even in RBAC log mode.
3. An arbitrary user UUID or non-`driver_*` id receives HTTP 400 and creates no ledger row.
4. A valid driver rotation creates HIGH `requested` + `completed` audit events without password or user UUID.
5. The previous driver password fails and the new password succeeds in Navigator.
6. Missing/invalid service token fails closed and records a secret-free failed result where a request began.
7. Fleetbase vendor diff and Navigator `/legacy` diff remain zero.

## Rollback

- Revoke the human `logistics_manager` role to remove UI/API access immediately.
- Revoke the Fleetbase service token and remove the two environment variables.
- Do not roll back migration `0025`; retain its audit ledger. A corrective migration may
  deactivate the role/permission if permanent retirement is required.
