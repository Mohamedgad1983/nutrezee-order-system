import { MenuItem, ExtensionComponent } from '@fleetbase/ember-core/contracts';

// A28 — supported Fleetbase extension point. The feature appears as a tab on the existing
// Fleet-Ops order-details page; no second admin shell, route redirect or Nutrezee login is added.
export default {
    setupExtension(_app, universe) {
        // `UniverseService#getService()` accepts the Fleetbase service alias, not the Ember
        // container registration name. This is the same supported wiring used by Fleet-Ops.
        const menuService = universe.getService('menu');
        menuService.registerMenuItem(
            'fleet-ops:component:order:details',
            new MenuItem({
                title: 'Nutrezee Label',
                label: 'Label & Barcode',
                route: 'operations.orders.index.details.virtual',
                slug: 'nutrezee-label',
                icon: 'barcode',
                priority: 4,
                component: new ExtensionComponent(
                    '@nutrezee/fleetops-labels-engine',
                    'order-label'
                ),
            })
        );

        // A27/A28 — supported Fleet-Ops Resources registry. Fleet-Ops owns the surrounding
        // sidebar and virtual route; this extension contributes only the batch-label component.
        //
        // Fleet-Ops 0.7.48 reserves `/fleet-ops/operations/:public_id` for order details, so an
        // extension registered in the `operations` section is interpreted as an order public ID.
        // The `management` section is the supported non-conflicting virtual-route surface shown
        // to operators as "Resources".
        menuService.registerMenuItem(
            'engine:fleet-ops',
            new MenuItem({
                title: 'Nutrezee Batch Labels',
                label: 'Batch Labels',
                slug: 'nutrezee-batch-labels',
                view: 'nutrezee-batch-labels',
                section: 'management',
                icon: 'print',
                priority: 6,
                permission: 'fleet-ops list order',
                description: "Print today's labels by driver or area.",
                keywords: ['labels', 'stickers', 'barcode', 'driver', 'area'],
                component: new ExtensionComponent(
                    '@nutrezee/fleetops-labels-engine',
                    'batch-labels'
                ),
            })
        );

        // A30 — governed exact locations captured by the assigned driver. This stays inside the
        // same Fleet-Ops Resources surface; no second admin or Nutrezee operator login exists.
        menuService.registerMenuItem(
            'engine:fleet-ops',
            new MenuItem({
                title: 'Nutrezee Driver Locations',
                label: 'Driver Locations',
                slug: 'nutrezee-driver-locations',
                view: 'nutrezee-driver-locations',
                section: 'management',
                icon: 'map-marker-alt',
                priority: 7,
                permission: 'fleet-ops list order',
                description: 'Review and correct exact locations captured by assigned drivers.',
                keywords: ['driver', 'location', 'map', 'customer', 'address'],
                component: new ExtensionComponent(
                    '@nutrezee/fleetops-labels-engine',
                    'driver-locations'
                ),
            })
        );
    },
};
