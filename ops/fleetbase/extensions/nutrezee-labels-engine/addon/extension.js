import { MenuItem, ExtensionComponent } from '@fleetbase/ember-core/contracts';

// A28 — supported Fleetbase extension point. The feature appears as a tab on the existing
// Fleet-Ops order-details page; no second admin shell, route redirect or Nutrezee login is added.
export default {
    setupExtension(_app, universe) {
        const menuService = universe.getService('universe/menu-service');
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
    },
};
