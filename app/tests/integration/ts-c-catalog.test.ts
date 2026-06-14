import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CatalogController } from '../../apps/api/src/modules/m05-catalog/catalog.controller';
import type { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'agent-1', name: 'Agent', email: 'a@t', locale: 'en', roles: ['order_agent'], sessionId: 's',
};
const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

function controllerWith(catalog: Partial<CatalogService>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return new CatalogController(sessions, catalog as CatalogService, access);
}

describe('TS-C API contract — catalog read controller (WP-API-01)', () => {
  it('lists products in the list contract and passes paging/active through', async () => {
    const listProducts = vi.fn().mockResolvedValue([{ id: 'p-1', nameEn: 'Rice' }]);
    const c = controllerWith({ listProducts });
    const res = await c.listProducts(req, 'true', '50', '10');
    expect(res).toEqual({ items: [{ id: 'p-1', nameEn: 'Rice' }], page: { limit: 50 } });
    expect(listProducts).toHaveBeenCalledWith({ activeOnly: true, limit: 50, offset: 10 });
  });

  it('gets a product, 404 when missing', async () => {
    const found = controllerWith({ getProduct: vi.fn().mockResolvedValue({ id: 'p-1' }) });
    await expect(found.getProduct(req, 'p-1')).resolves.toEqual({ id: 'p-1' });
    const missing = controllerWith({ getProduct: vi.fn().mockResolvedValue(null) });
    await expect(missing.getProduct(req, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns nutrition wrapped (null is a valid empty, not a 404)', async () => {
    const c = controllerWith({ getNutrition: vi.fn().mockResolvedValue(null) });
    await expect(c.getNutrition(req, 'p-1')).resolves.toEqual({ item: null });
  });

  it('resolves product allergens', async () => {
    const resolveAllergens = vi.fn().mockResolvedValue([{ allergenId: 'a-1', nameEn: 'Nuts', source: 'declared' }]);
    const c = controllerWith({ resolveAllergens });
    await expect(c.productAllergens(req, 'p-1')).resolves.toEqual({ items: [{ allergenId: 'a-1', nameEn: 'Nuts', source: 'declared' }] });
  });

  it('lists packages and gets one (404 when missing)', async () => {
    const listPackages = vi.fn().mockResolvedValue([{ id: 'pk-1' }]);
    const c = controllerWith({ listPackages, getPackage: vi.fn().mockResolvedValue(null) });
    await expect(c.listPackages(req, undefined, undefined, undefined)).resolves.toEqual({ items: [{ id: 'pk-1' }], page: { limit: 100 } });
    expect(listPackages).toHaveBeenCalledWith({ activeOnly: false, limit: undefined, offset: undefined });
    await expect(c.getPackage(req, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists allergens', async () => {
    const listAllergens = vi.fn().mockResolvedValue([{ id: 'a-1', nameEn: 'Nuts' }]);
    const c = controllerWith({ listAllergens });
    await expect(c.listAllergens(req)).resolves.toEqual({ items: [{ id: 'a-1', nameEn: 'Nuts' }] });
  });

  it('lists a whitelisted master kind, rejects an unknown kind without querying', async () => {
    const listMasters = vi.fn().mockResolvedValue([{ id: 'm-1', nameEn: 'Lunch' }]);
    const c = controllerWith({ listMasters });
    await expect(c.listMasters(req, 'meal_type')).resolves.toEqual({ items: [{ id: 'm-1', nameEn: 'Lunch' }] });
    expect(listMasters).toHaveBeenCalledWith('meal_type');

    await expect(c.listMasters(req, 'customer')).rejects.toBeInstanceOf(BadRequestException);
    expect(listMasters).toHaveBeenCalledTimes(1); // not called for the bad kind
  });

  it('sets nutrition (enrichment) mapping snake→camel, 404 when product missing (WP-UI-04)', async () => {
    const setNutrition = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ getProduct: vi.fn().mockResolvedValue({ id: 'p-1' }), setNutrition });
    await expect(c.setNutrition(req, 'p-1', { calories: 500, protein_g: 30, carbs_g: 40, fat_g: 12 }))
      .resolves.toEqual({ ok: true });
    expect(setNutrition).toHaveBeenCalledWith(ctx, 'p-1', { calories: 500, proteinG: 30, carbsG: 40, fatG: 12 });

    const missing = controllerWith({ getProduct: vi.fn().mockResolvedValue(null), setNutrition: vi.fn() });
    await expect(missing.setNutrition(req, 'nope', { calories: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
