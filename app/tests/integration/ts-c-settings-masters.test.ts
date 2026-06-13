import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { SettingsController } from '../../apps/api/src/platform/settings/settings.controller';
import { SettingsError, type SettingsService } from '../../apps/api/src/platform/settings/settings.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'ops-1', name: 'Ops', email: 'ops@t', locale: 'en', roles: ['ops_manager'], sessionId: 's',
};
const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

function controllerWith(settings: Partial<SettingsService>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return new SettingsController(sessions, settings as SettingsService, access);
}

describe('TS-C API contract — settings masters & reason codes (WP-API-01)', () => {
  it('adds a whitelisted master and returns its id', async () => {
    const addMaster = vi.fn().mockResolvedValue('m-1');
    const c = controllerWith({ addMaster });
    await expect(c.addMaster(req, 'section_master', { columns: { code: 'hot', name_en: 'Hot' } }))
      .resolves.toEqual({ id: 'm-1' });
    expect(addMaster).toHaveBeenCalledWith(ctx, 'section_master', { code: 'hot', name_en: 'Hot' });
  });

  it('rejects an unknown master kind WITHOUT calling the service (SQL-injection guard)', async () => {
    const addMaster = vi.fn();
    const c = controllerWith({ addMaster });
    await expect(c.addMaster(req, 'customer; DROP TABLE setting', { columns: { x: 1 } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(addMaster).not.toHaveBeenCalled();
  });

  it('rejects empty/missing columns', async () => {
    const c = controllerWith({ addMaster: vi.fn() });
    await expect(c.addMaster(req, 'area', { columns: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.addMaster(req, 'area', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malicious column KEY without calling the service (identifier injection guard)', async () => {
    const addMaster = vi.fn();
    const c = controllerWith({ addMaster });
    await expect(
      c.addMaster(req, 'section_master', { columns: { "name_en) VALUES ('x'); DROP TABLE setting; --": 'v' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(addMaster).not.toHaveBeenCalled();
  });

  it('adds a reason code', async () => {
    const addReasonCode = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ addReasonCode });
    await expect(c.addReasonCode(req, { domain: 'rejection', code: 'spam', label_en: 'Spam' }))
      .resolves.toEqual({ ok: true });
    expect(addReasonCode).toHaveBeenCalledWith(ctx, 'rejection', 'spam', 'Spam', undefined);
  });

  it('requires domain/code/label_en on reason code', async () => {
    const c = controllerWith({ addReasonCode: vi.fn() });
    await expect(c.addReasonCode(req, { domain: 'rejection' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps an unknown reason-code domain to a 400', async () => {
    const addReasonCode = vi.fn().mockRejectedValue(new SettingsError('unknown_domain'));
    const c = controllerWith({ addReasonCode });
    await expect(c.addReasonCode(req, { domain: 'bogus', code: 'x', label_en: 'X' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists a whitelisted ops-master kind (intake needs area/slot/method)', async () => {
    const listMasters = vi.fn().mockResolvedValue([{ id: 's-1', label_en: 'Morning 8-10' }]);
    const c = controllerWith({ listMasters });
    await expect(c.listMasters(req, 'delivery_slot', 'true'))
      .resolves.toEqual({ items: [{ id: 's-1', label_en: 'Morning 8-10' }] });
    expect(listMasters).toHaveBeenCalledWith('delivery_slot', { activeOnly: true });
  });

  it('rejects an unknown kind on the read route without querying', async () => {
    const listMasters = vi.fn();
    const c = controllerWith({ listMasters });
    await expect(c.listMasters(req, 'setting', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(listMasters).not.toHaveBeenCalled();
  });

  it('lists reason codes, passing the domain filter through', async () => {
    const listReasonCodes = vi.fn().mockResolvedValue([{ id: 'rc-1', domain: 'rejection', code: 'spam', label_en: 'Spam' }]);
    const c = controllerWith({ listReasonCodes });
    await expect(c.listReasonCodes(req, 'rejection'))
      .resolves.toEqual({ items: [{ id: 'rc-1', domain: 'rejection', code: 'spam', label_en: 'Spam' }] });
    expect(listReasonCodes).toHaveBeenCalledWith('rejection');
  });
});
