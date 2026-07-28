# Nutrezee Fleet-Ops Labels Extension

This separately identifiable AGPL-3.0-or-later Ember engine adds one
`Label & Barcode` tab to the existing Fleet-Ops order-details screen.

It uses the already-authenticated Fleetbase bearer token and same-origin
`/nz/fleet-ops/labels/*` endpoints. It does not add an administration shell,
login page, or independent customer/driver authorization model.

The extension is installed into the self-hosted Fleetbase Console as a local
package dependency and enabled in both places used by Fleetbase Console:

- the Console `EXTENSIONS` build setting; and
- `EXTENSIONS: "@nutrezee/fleetops-labels-engine"` in the runtime
  `fleetbase.config.json`.

Fleetbase caches its indexed extension list. The Console proxy must serve
`/extensions.json` with `Cache-Control: no-cache, no-store, must-revalidate`.
When an already-running deployment adds this extension, bump the Console
application version for that deployment (for example, from `0.7.48` to
`0.7.48-a28.1`) so Fleetbase rejects the old version-keyed browser cache.

The self-hosted Console also serves stable `vendor.js` and
`@fleetbase/console.js` asset names. Give both script URLs a deployment query
version (for example, `?v=a28.2`) and use the same query on
`/extensions.json`. When a previously cached manifest may already exist,
rotate Fleetbase's extension-list cache key for the deployment as well. This
ensures every existing operator browser fetches the ten-extension manifest;
clearing one browser's storage is not an acceptable deployment fix.
