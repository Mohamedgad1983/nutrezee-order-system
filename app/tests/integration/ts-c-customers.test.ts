import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CustomerController } from '../../apps/api/src/modules/m04-customers/customer.controller';
import { CustomerError, type CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { MergeError, type MergeService } from '../../apps/api/src/modules/m04-customers/merge.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService, VisibilityClass } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'ops-1', name: 'Ops', email: 'ops@t', locale: 'en', roles: ['ops_manager'], sessionId: 's',
};
const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

function controllerWith(
  customers: Partial<CustomerService>,
  grants: VisibilityClass[] = ['pii', 'health', 'payment'],
  merges: Partial<MergeService> = {},
) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
    visibilityGrants: vi.fn().mockResolvedValue(new Set<VisibilityClass>(grants)),
  } as unknown as AccessService;
  return new CustomerController(sessions, customers as CustomerService, access, merges as MergeService);
}

describe('TS-C API contract — customers controller (WP-API-01)', () => {
  it('searches by phone and wraps in the list contract', async () => {
    const searchByPhone = vi.fn().mockResolvedValue([{ id: 'c-1', full_name_en: 'A', phone_normalized: '+966500000001' }]);
    const c = controllerWith({ searchByPhone });
    const res = await c.search(req, '0500000001');
    expect(res).toEqual({ items: [{ id: 'c-1', full_name_en: 'A', phone_normalized: '+966500000001', masked: false }], page: { limit: 100 } });
    expect(searchByPhone).toHaveBeenCalledWith('0500000001');
  });

  it('requires a phone query on search', async () => {
    const c = controllerWith({ searchByPhone: vi.fn() });
    await expect(c.search(req, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('masks name and phone (PII) for a caller without the pii grant', async () => {
    const searchByPhone = vi.fn().mockResolvedValue([{ id: 'c-1', full_name_en: 'Jane', phone_normalized: '+966500000001' }]);
    const c = controllerWith({ searchByPhone }, []);
    const res = await c.search(req, '0500000001');
    expect(res.items[0]).toEqual({ id: 'c-1', full_name_en: '***', phone_normalized: '***', masked: true });
  });

  it('includes health in the profile only when the caller holds the health grant', async () => {
    const getProfile = vi.fn().mockResolvedValue({ id: 'c-1', email: 'a@b', dob: '1990-01-01', phones: [], allergies: [] });
    const withHealth = controllerWith({ getProfile }, ['pii', 'health']);
    await withHealth.profile(req, 'c-1');
    expect(getProfile).toHaveBeenCalledWith(ctx, 'c-1', true);

    const noHealth = controllerWith({ getProfile }, ['pii']);
    await noHealth.profile(req, 'c-1');
    expect(getProfile).toHaveBeenLastCalledWith(ctx, 'c-1', false);
  });

  it('masks all PII columns + nested phones/addresses in the profile for a caller without pii', async () => {
    const getProfile = vi.fn().mockResolvedValue({
      id: 'c-1', full_name_en: 'Jane', full_name_ar: 'جين', email: 'a@b', dob: '1990-01-01', notes: 'vip',
      phones: [{ phone_normalized: '+966500000001', is_primary: true }],
      addresses: [{ id: 'addr-1', address_text: '12 Main St', delivery_notes: 'gate code 7', area_id: 'area-1' }],
    });
    const c = controllerWith({ getProfile }, ['health']); // health but NOT pii
    const res = await c.profile(req, 'c-1');
    expect(res.full_name_en).toBe('***');
    expect(res.full_name_ar).toBe('***');
    expect(res.email).toBe('***');
    expect(res.dob).toBe('***');
    expect(res.notes).toBe('***');
    expect((res.phones as Record<string, unknown>[])[0].phone_normalized).toBe('***');
    expect((res.addresses as Record<string, unknown>[])[0].address_text).toBe('***');
    expect((res.addresses as Record<string, unknown>[])[0].delivery_notes).toBe('***');
    expect((res.addresses as Record<string, unknown>[])[0].area_id).toBe('area-1'); // not PII
    expect(res.masked).toBe(true);
  });

  it('gates the HEALTH-class diet_status_id by the health grant, not customer.read alone', async () => {
    const getProfile = vi.fn().mockResolvedValue({ id: 'c-1', diet_status_id: 'diabetic', phones: [], addresses: [] });
    // support-agent shape: has pii (customer.read) but NOT health → diet_status_id masked
    const noHealth = controllerWith({ getProfile }, ['pii']);
    expect((await noHealth.profile(req, 'c-1')).diet_status_id).toBe('***');
    // a health-grant holder sees it
    const withHealth = controllerWith({ getProfile }, ['pii', 'health']);
    expect((await withHealth.profile(req, 'c-1')).diet_status_id).toBe('diabetic');
  });

  it('404s a missing profile', async () => {
    const getProfile = vi.fn().mockRejectedValue(new CustomerError('not_found'));
    const c = controllerWith({ getProfile });
    await expect(c.profile(req, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a customer via guided create', async () => {
    const createGuided = vi.fn().mockResolvedValue('c-9');
    const c = controllerWith({ createGuided });
    await expect(c.create(req, { full_name_en: 'New', phone: '0500000009' })).resolves.toEqual({ id: 'c-9' });
    expect(createGuided).toHaveBeenCalledWith(ctx, expect.objectContaining({ fullNameEn: 'New', phone: '0500000009' }));
  });

  it('requires name and phone on create', async () => {
    const c = controllerWith({ createGuided: vi.fn() });
    await expect(c.create(req, { full_name_en: 'New' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s an exact-phone duplicate with the existing id detail', async () => {
    const createGuided = vi.fn().mockRejectedValue(new CustomerError('duplicate_phone', { existing_customer_id: 'c-1' }));
    const c = controllerWith({ createGuided });
    await expect(c.create(req, { full_name_en: 'Dup', phone: '0500000001' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates, adds address, and sets allergy', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const addAddress = vi.fn().mockResolvedValue('addr-1');
    const setAllergy = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ update, addAddress, setAllergy });

    await expect(c.update(req, 'c-1', { email: 'new@b' })).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(ctx, 'c-1', expect.objectContaining({ email: 'new@b' }));

    await expect(c.addAddress(req, 'c-1', { address_text: '12 St', area_id: 'area-1' })).resolves.toEqual({ id: 'addr-1' });
    expect(addAddress).toHaveBeenCalledWith(ctx, 'c-1', expect.objectContaining({ addressText: '12 St', areaId: 'area-1' }));

    await expect(c.setAllergy(req, 'c-1', { allergen_id: 'alg-1', severity: 'severe' })).resolves.toEqual({ ok: true });
    expect(setAllergy).toHaveBeenCalledWith(ctx, 'c-1', expect.objectContaining({ allergenId: 'alg-1', severity: 'severe' }));
  });

  it('validates required fields on address and allergy', async () => {
    const c = controllerWith({ addAddress: vi.fn(), setAllergy: vi.fn() });
    await expect(c.addAddress(req, 'c-1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.setAllergy(req, 'c-1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges two customers via POST /customers/merge (WP-API-02)', async () => {
    const merge = vi.fn().mockResolvedValue('merge-1');
    const c = controllerWith({}, ['pii'], { merge });
    await expect(c.merge(req, { winner_id: 'w', loser_id: 'l' })).resolves.toEqual({ id: 'merge-1' });
    expect(merge).toHaveBeenCalledWith(ctx, 'w', 'l');
  });

  it('requires winner_id and loser_id on merge', async () => {
    const c = controllerWith({}, ['pii'], { merge: vi.fn() });
    await expect(c.merge(req, { winner_id: 'w' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps MergeError: self_merge→400, not_found→404, already_undone→409', async () => {
    const self = controllerWith({}, ['pii'], { merge: vi.fn().mockRejectedValue(new MergeError('self_merge')) });
    await expect(self.merge(req, { winner_id: 'x', loser_id: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    const missing = controllerWith({}, ['pii'], { merge: vi.fn().mockRejectedValue(new MergeError('not_found')) });
    await expect(missing.merge(req, { winner_id: 'w', loser_id: 'l' })).rejects.toBeInstanceOf(NotFoundException);
    const undone = controllerWith({}, ['pii'], { undo: vi.fn().mockRejectedValue(new MergeError('already_undone')) });
    await expect(undone.undoMerge(req, 'm')).rejects.toBeInstanceOf(ConflictException);
  });

  it('undoes a merge via POST /customers/merge/:id/undo', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({}, ['pii'], { undo });
    await expect(c.undoMerge(req, 'merge-1')).resolves.toEqual({ ok: true });
    expect(undo).toHaveBeenCalledWith(ctx, 'merge-1');
  });
});
