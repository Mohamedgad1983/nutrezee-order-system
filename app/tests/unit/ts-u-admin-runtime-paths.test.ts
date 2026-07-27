import { describe, expect, it } from 'vitest';
import {
  OPS_ADMIN_BASE,
  OPS_API_BASE,
  adminBaseForPathname,
  adminUrl,
  apiUrl,
  stripAdminBase,
} from '../../apps/admin/src/runtimePaths';

describe('TS-U admin runtime paths — ops.nutreeze.com mount', () => {
  it('keeps the original root-host routes unchanged', () => {
    expect(adminBaseForPathname('/app/labels')).toBe('');
    expect(stripAdminBase('/app/labels')).toBe('/app/labels');
    expect(adminUrl('/app/kitchen', '/app/labels')).toBe('/app/kitchen');
    expect(apiUrl('/auth/me', '/app/labels')).toBe('/auth/me');
  });

  it('strips the ops admin mount before client-side route matching', () => {
    expect(stripAdminBase(OPS_ADMIN_BASE)).toBe('/');
    expect(stripAdminBase(`${OPS_ADMIN_BASE}/`)).toBe('/');
    expect(stripAdminBase(`${OPS_ADMIN_BASE}/app/labels`)).toBe('/app/labels');
    expect(stripAdminBase(`${OPS_ADMIN_BASE}/app/dashboard/orders`)).toBe(
      '/app/dashboard/orders',
    );
  });

  it('keeps navigation inside the ops admin mount', () => {
    expect(adminUrl('/app/login', `${OPS_ADMIN_BASE}/`)).toBe(
      `${OPS_ADMIN_BASE}/app/login`,
    );
    expect(adminUrl('/app/labels', `${OPS_ADMIN_BASE}/app/kitchen`)).toBe(
      `${OPS_ADMIN_BASE}/app/labels`,
    );
  });

  it('sends ops-host admin API calls through the existing /nz gateway', () => {
    expect(apiUrl('/auth/me', `${OPS_ADMIN_BASE}/app/login`)).toBe(
      `${OPS_API_BASE}/auth/me`,
    );
    expect(apiUrl('/labels/render', `${OPS_ADMIN_BASE}/app/labels`)).toBe(
      `${OPS_API_BASE}/labels/render`,
    );
    expect(apiUrl('/barcodes/customer/customer_1', `${OPS_ADMIN_BASE}/app/labels`)).toBe(
      `${OPS_API_BASE}/barcodes/customer/customer_1`,
    );
  });

  it('does not treat similar prefixes as the mounted admin', () => {
    expect(adminBaseForPathname('/nz-admin-other/app/labels')).toBe('');
    expect(apiUrl('/auth/me', '/nz-admin-other/app/labels')).toBe('/auth/me');
  });
});
