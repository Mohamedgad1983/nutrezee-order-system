# Nutrezee Fleet-Ops Labels Extension

This separately identifiable AGPL-3.0-or-later Ember engine adds one
`Label & Barcode` tab to the existing Fleet-Ops order-details screen.

It uses the already-authenticated Fleetbase bearer token and same-origin
`/nz/fleet-ops/labels/*` endpoints. It does not add an administration shell,
login page, or independent customer/driver authorization model.

The extension is installed into the self-hosted Fleetbase Console as a local
package dependency and enabled in the Console `EXTENSIONS` build setting.
