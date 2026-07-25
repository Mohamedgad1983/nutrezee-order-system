import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { DriverCredentialController } from '../../apps/api/src/modules/m24-fleetbase/driver-credential.controller';
import type { DriverCredentialService } from '../../apps/api/src/modules/m24-fleetbase/driver-credential.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

function request(): Request {
  return { cookies: { nz_session: 'session-1' } } as unknown as Request;
}

function controller(roles: string[], permissionAllowed: boolean) {
  const context: StaffContext = {
    staffId: 'staff-1',
    name: 'Manager',
    email: 'manager@example.test',
    locale: 'en',
    roles,
    sessionId: 'session-1',
  };
  const sessions = { validate: vi.fn().mockResolvedValue(context) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: permissionAllowed, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  const credentials = {
    listDrivers: vi.fn().mockResolvedValue([]),
    rotate: vi.fn().mockResolvedValue({ rotation_id: 'rotation-1', status: 'completed' }),
  } as unknown as DriverCredentialService;
  return { controller: new DriverCredentialController(sessions, access, credentials), credentials };
}

describe('DriverCredentialController fail-closed authorization', () => {
  it('rejects Operations Manager even while general RBAC is in log mode', async () => {
    const test = controller(['ops_manager'], true);
    await expect(test.controller.list(request())).rejects.toMatchObject({ status: 403 });
    expect(test.credentials.listDrivers).not.toHaveBeenCalled();
  });

  it('rejects Logistics Manager when the dedicated grant is missing', async () => {
    const test = controller(['logistics_manager'], false);
    await expect(test.controller.list(request())).rejects.toMatchObject({ status: 403 });
    expect(test.credentials.listDrivers).not.toHaveBeenCalled();
  });

  it('allows only a Logistics Manager with the dedicated grant', async () => {
    const test = controller(['logistics_manager'], true);
    await expect(test.controller.list(request())).resolves.toEqual({ items: [], page: { limit: 500 } });
    expect(test.credentials.listDrivers).toHaveBeenCalledOnce();
  });
});
