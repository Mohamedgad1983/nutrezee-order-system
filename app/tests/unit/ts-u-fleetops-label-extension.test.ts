import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../ops/fleetbase/extensions/nutrezee-labels-engine/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const packageJson = JSON.parse(read('package.json')) as {
  name: string;
  version: string;
  keywords: string[];
  license: string;
};
const extensionJson = JSON.parse(read('extension.json')) as {
  version: string;
};
const extension = read('addon/extension.js');
const component = read('addon/components/order-label.js');
const template = read('addon/components/order-label.hbs');
const batchComponent = read('addon/components/batch-labels.js');
const batchTemplate = read('addon/components/batch-labels.hbs');
const normalize = read('addon/utils/normalize-label.js');
const styles = read('addon/styles/addon.css');
const routes = read('addon/routes.js');
const readme = read('README.md');
const adminGateway = readFileSync(new URL('../../../docker/nginx.admin.conf', import.meta.url), 'utf8');

describe('TS-U A28/A43/A44 Fleet-Ops extension boundary', () => {
  it('is a separately identifiable supported Fleetbase Ember extension', () => {
    expect(packageJson.name).toBe('@nutrezee/fleetops-labels-engine');
    expect(packageJson.version).toBe('0.3.3');
    expect(extensionJson.version).toBe(packageJson.version);
    expect(packageJson.keywords).toContain('fleetbase-extension');
    expect(packageJson.keywords).toContain('ember-engine');
    expect(packageJson.license).toBe('AGPL-3.0-or-later');
  });

  it('brands the existing Fleet-Ops shell from extension-owned assets only', () => {
    expect(extension).toContain("const BRAND_THEME_VERSION = 'a44.2'");
    expect(extension).toContain("document.documentElement.dataset.nutrezeeBrand = 'official'");
    expect(extension).toContain("body.classList.add('nutrezee-brand-theme')");
    expect(extension).toContain("if (document.title !== 'Nutreeze | Fleet-Ops')");
    expect(extension).toContain("document.title = 'Nutreeze | Fleet-Ops'");
    expect(extension).toContain("'DOMContentLoaded'");
    expect(extension).toContain('/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css');
    expect(extension).toContain("brandLink.setAttribute('aria-label', 'Nutreeze')");
    expect(extension).toContain("favicon.dataset.nutrezeeFavicon = 'official'");
    expect(extension).toContain('installBrandTheme();');
    expect(styles).toContain('body.nutrezee-brand-theme');
    expect(styles).toContain('--nz-brand: #956132');
    expect(styles).toContain('.next-view-header .navbar-logo::before');
    expect(styles).toContain('.next-sidebar-navigator-item.is-active');
    expect(styles).toContain('.next-table-wrapper tbody tr:hover td');
    expect(styles).toContain('@media (max-width: 760px)');
    expect(styles).toContain('.next-sidebar-footer .fleetbase-attribution-notice');
    expect(styles).not.toMatch(/fleetbase-attribution-notice[^{}]*\{[^}]*display:\s*none/);
    expect(readme).toMatch(/Fleetbase application\s+and vendor source remain unchanged/);
  });

  it('keeps the approved warm light presentation on the real Fleetbase DOM', () => {
    expect(extension).toContain("body.classList.remove('dark-theme')");
    expect(extension).not.toContain('approvedLightThemeObserver');
    expect(extension).not.toContain('installApprovedLightThemeGuard');
    expect(extension).not.toContain("body.dataset.theme = 'light'");
    expect(styles).not.toContain('--nz-bg: #120f0d');
    expect(styles).toContain('.next-table-wrapper tbody td {');
    expect(styles).toMatch(/next-table-wrapper tbody td \{[\s\S]*?background: var\(--nz-surface\) !important/);
    expect(styles).toContain('body.nutrezee-brand-theme .btn-magic');
    expect(styles).toMatch(/\.btn-magic \{[\s\S]*?background: var\(--nz-surface-raised\) !important/);
    expect(readme).toContain('0.7.48-a44.2');
  });

  it('does not retrigger its document observer by rewriting the title', () => {
    expect(extension).toMatch(
      /const observer = new MutationObserver\(\(\) => \{\s*if \(applyAccessibleBrandIdentity\(\)\) \{\s*observer\.disconnect\(\);\s*\}\s*\}\);/,
    );
  });

  it('registers individual and batch operations inside supported Fleet-Ops registries only', () => {
    expect(extension).toContain("universe.getService('menu')");
    expect(extension).toContain("'fleet-ops:component:order:details'");
    expect(extension).toContain("title: 'Nutrezee Label'");
    expect(extension).toContain("slug: 'nutrezee-label'");
    expect(extension).toContain("route: 'operations.orders.index.details.virtual'");
    expect(extension).toContain("'@nutrezee/fleetops-labels-engine'");
    expect(extension).toContain("'order-label'");
    expect(extension).toContain("'engine:fleet-ops'");
    expect(extension).toContain("title: 'Nutrezee Batch Labels'");
    expect(extension).toContain("slug: 'nutrezee-batch-labels'");
    expect(extension).toContain("section: 'management'");
    expect(extension).toContain("permission: 'fleet-ops list order'");
    expect(extension).toContain("'batch-labels'");
    expect(routes).toContain('buildRoutes(function () {})');
    expect(extension).not.toContain('registerHeaderMenuItem');
    expect(extension).not.toContain('registerAdminMenuPanel');
  });

  it('documents both Fleetbase enablement layers and cache invalidation', () => {
    expect(readme).toContain('fleetbase.config.json');
    expect(readme).toContain('EXTENSIONS: "@nutrezee/fleetops-labels-engine"');
    expect(readme).toContain('/extensions.json');
    expect(readme).toContain('Cache-Control: no-cache, no-store, must-revalidate');
    expect(readme).toContain('0.7.48-a28.1');
    expect(readme).toContain('vendor.js');
    expect(readme).toContain('?v=a28.2');
    expect(readme).toContain('rotate Fleetbase');
    expect(readme).toContain('clearing one browser');
  });

  it('reuses the current Fleetbase bearer token and contains no second login', () => {
    expect(component).toContain('this.session?.data?.authenticated?.token');
    expect(component).toContain('Authorization: `Bearer ${token}`');
    expect(component).not.toContain('/auth/login');
    expect(component).not.toMatch(/\bpassword\b/i);
    expect(template).not.toMatch(/sign[\s-]?in/i);
  });

  it('resolves and records prints through the same-origin Nutrezee gateway', () => {
    expect(component).toContain("this.request('/nz/fleet-ops/labels/render'");
    expect(component).toContain('/nz/fleet-ops/labels/${encoded}/print-history');
    expect(component).toContain('/nz/fleet-ops/labels/${encoded}/printed');
    expect(component).toContain("kind: this.isReprint ? 'reprint' : 'print'");
    expect(component).toContain('A reprint reason is required.');
    expect(adminGateway).toMatch(/\|fleet-ops\)\(\/\|\$\)/);
  });

  it('supports one current-day batch by driver or area without false print recording', () => {
    expect(batchComponent).toContain("this.request('/nz/fleet-ops/labels/batch/options')");
    expect(batchComponent).toContain("this.request('/nz/fleet-ops/labels/batch/preview'");
    expect(batchComponent).toContain("this.request('/nz/fleet-ops/labels/batch/printed'");
    expect(batchComponent).toContain("filter_type: this.filterType");
    expect(batchComponent).toContain("selection_ids: this.selectionIds");
    expect(batchComponent).toContain("document.body.classList.add('nutrezee-batch-print-mode')");
    expect(batchComponent).toContain('this.awaitingConfirmation = true');
    expect(batchComponent.indexOf('window.print()')).toBeLessThan(
      batchComponent.indexOf("this.request('/nz/fleet-ops/labels/batch/printed'"),
    );
    expect(batchTemplate).toContain('Driver / السائق');
    expect(batchTemplate).toContain('Area / المنطقة');
    expect(batchTemplate).toContain('Select all');
    expect(batchTemplate).toContain('Nothing is recorded until you confirm');
    expect(batchTemplate).toContain('Cancel — do not record');
    expect(batchTemplate).toContain('A partial driver or area batch will not be printed');
    expect(styles).toContain('body.nutrezee-batch-print-mode .nz-batch-label');
    expect(styles).toContain('page-break-after: always');
    expect(styles).toContain('width: 100mm !important');
    expect(styles).toContain('height: 70mm !important');
  });

  it('preserves the legacy structure and adds one Code 128 footer', () => {
    expect(template.match(/<polygon/g)).toHaveLength(2);
    expect(template).toContain('Full Name :');
    expect(template).toContain('Subscription :');
    expect(template).toContain('Delivery Time :');
    expect(template).toContain('Days Remaining :');
    expect(template).toContain('Delivery Method :');
    expect(template).toContain('Dish Name');
    expect(template).toContain('Total Nutrition');
    expect(template).toContain('this.label.barcodeSvg');
    expect(template).toContain('this.label.barcodeValue');
    expect(styles).toContain('width: 100mm');
    expect(styles).toContain('height: 70mm');
    expect(styles).toContain('grid-template-columns: minmax(0, 51%) minmax(0, 49%)');
    expect(styles).toContain('border-bottom: 0.18mm dashed');
    expect(styles).toMatch(/\.nz-legacy-label__barcode\s*\{/);
  });

  it('prints vehicle and phone in a driver color while keeping the barcode black', () => {
    expect(template).toContain('CAR / سيارة');
    expect(template).toContain('TEL / هاتف');
    expect(template).toContain('this.label.vehicleNumber');
    expect(template).toContain('this.label.driverPhone');
    expect(template).not.toContain('Driver ID');
    expect(batchTemplate).toContain('item.label.driverColorClass');
    expect(batchTemplate).toContain('item.label.vehicleNumber');
    expect(batchTemplate).toContain('item.label.driverPhone');
    expect(batchTemplate).not.toContain('order.driver_name');
    expect(normalize).toContain('DRIVER_COLORS');
    expect(normalize).toContain('driver_color');
    expect(styles).toContain('.nz-driver-color--red');
    expect(styles).toContain('.nz-driver-color--coral');
    expect(styles).toContain('-webkit-print-color-adjust: exact');
    expect(styles).toMatch(/\.nz-barcode-svg svg[\s\S]*fill: #000/);
  });

  it('renders an explicit empty meal state instead of fabricated nutrition', () => {
    expect(template).toContain('No dish detail recorded for this date');
    expect(template).toContain('No authoritative dish detail is recorded');
    expect(normalize).toContain("nutritionMissing: document?.meal_source === 'no_dish_source'");
  });
});
