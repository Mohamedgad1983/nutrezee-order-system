# 08 — A28 Fleet-Ops product correction

> **Status:** live route correction verified 2026-07-28; source correction verified locally.
> A28 supersedes A27's separate Nutrezee operations-admin mount. Fleet-Ops at
> `https://ops.nutreeze.com/` is the sole operations admin.

## 1. Corrected product boundary

- Fleet-Ops remains the only operations UI on `ops.nutreeze.com`.
- Nutrezee keeps the same-host `/nz/*` API gateway needed by the label/barcode integration.
- Label and collection controls will be presented through a supported Fleetbase Console
  extension, not a second React admin and not a second driver login.
- Fleetbase identity and Fleetbase order assignment are the collection authority.
- The permanent customer barcode, append-only collection ledger, audit controls and
  no-fabricated-meal-data rules remain unchanged.

This boundary is recorded as A28 in `AGENTS.md` and the build progress register.

## 2. Live route rollback

Before the change, the active Caddy configuration sha256 was:

`8a7e3a181a6f081248f0fd4128df5352740ef647788d0b1b0644d7dedc1a1a8c`

The exact active file was backed up on the staging host as:

`/opt/nutrezee/repo/docker/Caddyfile.active.pre-a28-20260728T0235Z`

The previous admin image also remains available as:

`nutrezee-admin:pre-a28-20260728`

Only the `/labels` redirect and `/nz-admin*` reverse-proxy blocks were removed. The
candidate configuration was validated with the running Caddy image before installation.
The installed configuration sha256 is:

`e7c78301f4de4cf2e225598879ec252a4119b044ee992484cae7ce52bb2818c6`

After reload:

- `/`, `/fleet-ops`, `/labels` and `/nz-admin/app/labels` all render the Fleetbase Console;
- `/nz/health` still returns `200 {"status":"ok","service":"nutrezee-api"}`;
- the `/nz/*` handler remains present;
- every pre-existing site and Fleetbase health probe retained its baseline status code.

## 3. Source correction

The three commits which added a second admin bundle and live subpath mount were reversed
without altering the A27 barcode or label implementation:

- `a4ef4ab` — second `/nz-admin` SPA mount;
- `dd942df` — dual-bundle smoke probe;
- `eb39a6a` — follow-up dual-bundle smoke change.

The corrected source:

- has no `build:ops` script or `dist-ops` image layer;
- has no `/nz-admin` nginx location;
- has no dual-host pathname router;
- has no Caddy admin-mount snippet;
- retains the original Nutrezee admin build for its original staging host.

The retired generated `dist-ops` directory was moved to
`/tmp/nutrezee-a28-dist-ops-retired` rather than deleted.

## 4. Verification

Local verification after the source rollback:

- A28 single-admin boundary unit tests: pass;
- label print pagination regression tests: pass;
- TypeScript typecheck: pass;
- ESLint: pass;
- application build: pass.

The label print pagination repair is retained as an independent label correctness change; it
does not reintroduce the separate operations admin.

## 5. Rollback

If the route correction itself must be reverted, restore the timestamped Caddy backup,
validate it inside the Caddy container, and reload. No database migration or data mutation
was performed for this route-only correction.
