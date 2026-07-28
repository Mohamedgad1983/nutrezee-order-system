import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../ops/fleetbase/extensions/nutrezee-labels-engine/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const packageJson = JSON.parse(read('package.json')) as {
  name: string;
  keywords: string[];
  license: string;
};
const extension = read('addon/extension.js');
const component = read('addon/components/order-label.js');
const template = read('addon/components/order-label.hbs');
const styles = read('addon/styles/addon.css');
const routes = read('addon/routes.js');
const readme = read('README.md');
const adminGateway = readFileSync(new URL('../../../docker/nginx.admin.conf', import.meta.url), 'utf8');

describe('TS-U A28 Fleet-Ops label extension boundary', () => {
  it('is a separately identifiable supported Fleetbase Ember extension', () => {
    expect(packageJson.name).toBe('@nutrezee/fleetops-labels-engine');
    expect(packageJson.keywords).toContain('fleetbase-extension');
    expect(packageJson.keywords).toContain('ember-engine');
    expect(packageJson.license).toBe('AGPL-3.0-or-later');
  });

  it('registers inside Fleet-Ops order details and exposes no standalone operations UI', () => {
    expect(extension).toContain("universe.getService('menu')");
    expect(extension).toContain("'fleet-ops:component:order:details'");
    expect(extension).toContain("title: 'Nutrezee Label'");
    expect(extension).toContain("slug: 'nutrezee-label'");
    expect(extension).toContain("route: 'operations.orders.index.details.virtual'");
    expect(extension).toContain("'@nutrezee/fleetops-labels-engine'");
    expect(extension).toContain("'order-label'");
    expect(routes).toContain('buildRoutes(function () {})');
    expect(extension).not.toContain('registerHeaderMenuItem');
    expect(extension).not.toContain('registerAdminMenuPanel');
  });

  it('documents both Fleetbase enablement layers and cache invalidation', () => {
    expect(readme).toContain('fleetbase.config.json');
    expect(readme).toContain('EXTENSIONS: "@nutrezee/fleetops-labels-engine"');
    expect(readme).toContain('/extensions.json');
    expect(readme).toContain('Cache-Control: no-cache, no-store, must-revalidate');
    expect(readme).toContain('0.7.48-a28.0');
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

  it('renders an explicit empty meal state instead of fabricated nutrition', () => {
    expect(template).toContain('No dish detail recorded for this date');
    expect(template).toContain('No authoritative dish detail is recorded');
    expect(component).toContain("nutritionMissing: document?.meal_source === 'no_dish_source'");
  });
});
