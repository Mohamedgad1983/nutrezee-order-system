import { MenuItem, ExtensionComponent } from '@fleetbase/ember-core/contracts';

const BRAND_THEME_VERSION = 'a43.2';
const BRAND_THEME_STYLESHEET_ID = 'nutrezee-fleetops-brand-theme';
const BRAND_THEME_STYLESHEET = `/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css?v=${BRAND_THEME_VERSION}`;
const BRAND_MARK_DATA_URL =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 418.364 370.498'%3E%3Cg fill='%23956132' fill-rule='evenodd'%3E%3Cpath d='M116.788 17.028h184.788l97.12 168.215-97.12 168.222H116.788L19.661 185.243Zm194.619-17.028H106.958L0 185.243l106.95 185.255h204.457l106.957-185.255Z'/%3E%3Cpath d='M147.381 70.015h123.598l66.534 115.231-66.534 115.234H147.381L80.847 185.246Zm133.447-17.051H137.539L61.164 185.246l76.375 132.293h143.286l76.372-132.293Z'/%3E%3C/g%3E%3C/svg%3E";

function applyAccessibleBrandIdentity() {
    const brandLink = document.querySelector('.next-view-header a.navbar-logo');
    if (!brandLink) {
        return false;
    }

    brandLink.setAttribute('aria-label', 'Nutreeze');
    brandLink.setAttribute('title', 'Nutreeze');

    const brandImage = brandLink.querySelector('img');
    brandImage?.setAttribute('alt', 'Nutreeze');
    return true;
}

function applyDocumentBrandIdentity() {
    document.documentElement.dataset.nutrezeeBrand = 'official';
    document.body?.classList.add('nutrezee-brand-theme');
    if (document.title !== 'Nutreeze | Fleet-Ops') {
        document.title = 'Nutreeze | Fleet-Ops';
    }
}

function installBrandTheme() {
    if (typeof document === 'undefined') {
        return;
    }

    applyDocumentBrandIdentity();

    if (!document.body) {
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                applyDocumentBrandIdentity();
                applyAccessibleBrandIdentity();
            },
            { once: true }
        );
    }

    if (!document.getElementById(BRAND_THEME_STYLESHEET_ID)) {
        const stylesheet = document.createElement('link');
        stylesheet.id = BRAND_THEME_STYLESHEET_ID;
        stylesheet.rel = 'stylesheet';
        stylesheet.href = BRAND_THEME_STYLESHEET;
        stylesheet.dataset.nutrezeeThemeVersion = BRAND_THEME_VERSION;
        document.head.appendChild(stylesheet);
    }

    if (!document.querySelector('link[data-nutrezee-favicon]')) {
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.type = 'image/svg+xml';
        favicon.href = BRAND_MARK_DATA_URL;
        favicon.dataset.nutrezeeFavicon = 'official';
        document.head.appendChild(favicon);
    }

    if (!applyAccessibleBrandIdentity() && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
            if (applyAccessibleBrandIdentity()) {
                observer.disconnect();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        globalThis.setTimeout(() => observer.disconnect(), 10000);
    }
}

// A28 — supported Fleetbase extension point. The feature appears as a tab on the existing
// Fleet-Ops order-details page; no second admin shell, route redirect or Nutrezee login is added.
export default {
    setupExtension(_app, universe) {
        // A43 — brand the existing Fleet-Ops shell through extension-owned assets only. Fleetbase
        // application/vendor source and every route, permission and data workflow remain unchanged.
        installBrandTheme();

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
