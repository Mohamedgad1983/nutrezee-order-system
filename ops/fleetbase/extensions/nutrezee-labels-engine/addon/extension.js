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

        // A27/A28 — supported Fleet-Ops Operations registry. Fleet-Ops owns the surrounding
        // sidebar and virtual route; this extension contributes only the batch-label component.
        menuService.registerMenuItem(
            'engine:fleet-ops',
            new MenuItem({
                title: 'Nutrezee Batch Labels',
                label: 'Batch Labels',
                slug: 'nutrezee-batch-labels',
                view: 'nutrezee-batch-labels',
                section: 'operations',
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
    },
};
