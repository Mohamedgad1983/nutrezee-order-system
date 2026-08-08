# Nutrezee Kitchen Display System

Standalone, read-only production display for kitchen sections. It has its own Node API, React/Vite UI, authentication, package lock, container, configuration, tests, and CI workflow. It does not import or call the Nutrezee order-system API and has no dependency on any delivery application, logistics service, label module, or database.

## Release-1 behavior

- Select a configured kitchen and delivery date.
- Read Partner `GET /integration/order-items` with a dedicated server-held key.
- Validate live mode, pagination, exact date, physical-row uniqueness, quantity, meal, portion, and routing metadata.
- Total each exact `meal_id` + `portion_size` inside every upstream section. A multi-section item contributes its quantity to every assigned section.
- Keep rows with no routing in a visible `unrouted` section.
- Return only section, meal, portion, quantity, and source freshness metadata. Physical item, order, customer, phone, and address data are never projected.
- Fail closed. It never displays stale, inferred, name-matched, or estimated numbers.

There are no status buttons, workflow transitions, Partner writes, database writes, recipe/inventory features, driver functions, or label functions.

## Architecture

```text
Browser (same origin)
  ├─ server-side opaque session cookie
  ├─ GET /api/display-config
  └─ GET /api/section-totals
            │
Standalone Node service (zero external runtime packages)
  ├─ independent scrypt display credential
  ├─ strict PII-free aggregation
  └─ GET + X-Api-Key only
            │
Partner /integration/order-items (read-only)
```

The process keeps sessions and a 15-second Partner response cache in memory. A restart signs displays out and discards the cache; there is no persistent application state.

## Local verification

Requires Node.js 22 or later.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` starts an isolated fixture source and production-built server, then runs the Arabic/English Chromium journey. It does not call Partner.

After deployment, run the same journey against the HTTPS hostname without putting credentials in arguments or source control:

```bash
export KDS_E2E_BASE_URL=https://kds.example.com
export KDS_E2E_USERNAME=kitchen-display
read -rs KDS_E2E_PASSWORD
export KDS_E2E_PASSWORD KDS_E2E_LIVE=1
npm run test:e2e:staging
unset KDS_E2E_PASSWORD KDS_E2E_LIVE
```

Set `KDS_E2E_DELIVERY_DATE=YYYY-MM-DD` when operations needs to verify a date other than today. The live journey requires a successful totals response, checks section/meal arithmetic, scans the browser response for prohibited fields, and verifies Arabic RTL plus English LTR rendering.

## Configuration

Copy `.env.example` to an untracked `.env`. Production must use HTTPS and secure cookies. The preferred staging setup mounts the two secrets as root-protected files:

- `KDS_PARTNER_API_KEY_FILE=/run/secrets/kds_partner_api_key`
- `KDS_DISPLAY_PASSWORD_HASH_FILE=/run/secrets/kds_display_password_hash`

Direct `KDS_PARTNER_API_KEY` and `KDS_DISPLAY_PASSWORD_HASH` values are supported for local operation, but a direct value and its `_FILE` alternative cannot be set together. The service never logs either value.

Create a display password hash without putting the password in command-line arguments:

```bash
read -rs KDS_INPUT_PASSWORD
printf '%s' "$KDS_INPUT_PASSWORD" | npm run hash-password
unset KDS_INPUT_PASSWORD
```

Treat the generated hash as protected configuration. `KDS_KITCHENS` is a comma-delimited allow-list; the browser cannot submit an arbitrary kitchen identifier. `KDS_REFRESH_SECONDS` is bounded to 15–300 seconds.

## Run the container

Local configuration:

```bash
docker compose -f compose.yml up --build -d
curl --fail http://127.0.0.1:8180/health
```

Staging uses `compose.staging.yml`, `/opt/nutrezee-kds/secrets/`, and a dedicated reverse-proxy hostname. The KDS container has its own default network and joins the existing external reverse-proxy network only so Caddy can reach its service alias; it remains a separate Compose project and application. The container is read-only, drops every Linux capability, enables `no-new-privileges`, exposes only a loopback host port, and runs as the unprivileged Node user.

## Operations and safe failure

- `/health` proves only that this service is alive and configured enough to start; it never returns or tests the Partner credential.
- Partner authentication/network/HTTP failures return `kds_source_unavailable` and clear current totals from the browser.
- Schema/date/pagination/duplicate/metadata contradictions return `kds_source_response_invalid` and clear current totals.
- API responses use `Cache-Control: no-store`; the UI shows both source time and display-generation time.
- Login is origin-checked and rate-limited. Sessions are opaque, hashed in memory, `HttpOnly`, `SameSite=Strict`, and `Secure` in production.

Deployment and live-acceptance commands are in [`../docs/kds/01_standalone_section_totals.md`](../docs/kds/01_standalone_section_totals.md).
