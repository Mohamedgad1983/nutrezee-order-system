# Nutrezee Fleet-Ops Labels Extension

This separately identifiable AGPL-3.0-or-later Ember engine adds:

- the official Nutreeze visual system to the existing Fleet-Ops shell, with responsive light and
  dark treatments, an accessible Nutreeze header identity and branded favicon;
- a `Label & Barcode` tab to the existing Fleet-Ops order-details screen; and
- a `Batch Labels` page in the existing Fleet-Ops **Resources** sidebar; and
- a `Driver Locations` page in the same sidebar for A30 append-only review and correction.

Fleet-Ops 0.7.48 treats `/fleet-ops/operations/:value` as an order-details route, so its
`operations` extension section cannot host a virtual page. The supported `management`
registry renders under the user-facing **Resources** section and routes through Fleet-Ops'
non-conflicting virtual-page handler.

Batch Labels uses the complete current-day Partner → Fleetbase dispatch set. It can group by
Fleetbase driver or source routing area, select all or a subset, and prints one 100 × 70 mm
sticker per page. It fails closed when today's Fleetbase set is absent or any Fleetbase order
cannot be mapped to the label database; a partial local fulfillment count is never presented as
the day's operational total.

Each assigned driver's boxes carry a prominent, deterministic color keyed only by the immutable
Fleetbase driver public id. The visible identity is the driver's current Fleetbase phone and
assigned vehicle plate, never the mutable driver name. Every company driver gets a distinct color;
the Code 128 barcode stays black. An assigned driver with no phone, vehicle plate or color blocks
preview and printing. These values are read live for the authenticated Fleet-Ops operation and are
not persisted in Nutrezee label or audit tables.

It uses the already-authenticated Fleetbase bearer token and same-origin
`/nz/fleet-ops/labels/*` endpoints. It does not add an administration shell,
login page, or independent customer/driver authorization model.

## Nutreeze shell branding (A43)

The theme is presentation-only. `addon/extension.js` attaches a Nutreeze class/data attribute to
the existing Console document and loads this engine's versioned stylesheet on first render. This
makes the theme available on direct Fleet-Ops routes such as Drivers before an operator visits a
Nutrezee virtual page. It also gives the existing header logo an accessible Nutreeze name and uses
the official mark for the tab icon. No route, permission, request, Fleetbase record or operational
workflow changes.

The official source PDF supplied by operations defines the mark geometry and the single bronze
brand color `#956132`. The theme keeps the Fleetbase version/legal attribution visible and supports
both Console light and dark preferences. The printed legacy label remains isolated from the shell
theme so its exact white 100 x 70 mm output is unchanged.

Driver Locations uses the same Fleetbase operator bearer against
`/nz/fleet-ops/driver-locations*`. It shows opaque customer references and exact coordinates, not
customer names or phones. A correction requires a reason, creates a new linked ledger row and HIGH
audit event, and leaves the previous coordinate immutable. Valid Partner pins remain authoritative.

Opening the print dialog does not record a print. The operator must separately confirm that the
physical batch completed; cancelled dialogs therefore create no print events. A mixed or complete
reprint batch requires a reason and shares one audited batch reference.

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

For the A43 branding release, use Console application version `0.7.48-a43.1`, the extension theme
query `?v=a43.1`, and the same cachebuster on the Console scripts and `/extensions.json`. Rebuild
only through the documented local package dependency/registration wiring; Fleetbase application
and vendor source remain unchanged.
