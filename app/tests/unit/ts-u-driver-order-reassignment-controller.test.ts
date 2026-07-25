import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { DriverOrderReassignmentController } from '../../apps/api/src/modules/m24-fleetbase/driver-order-reassignment.controller';
import type { DriverOrderReassignmentService } from '../../apps/api/src/modules/m24-fleetbase/driver-order-reassignment.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

function request(): Request {
  return { cookies: { nz_session: 'session-1' } } as unknown as Request;
}

function makeController(roles: string[], permissionAllowed: boolean) {
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
  const service = {
    listDrivers: vi.fn().mockResolvedValue([]),
    listOrders: vi.fn().mockResolvedValue([]),
    reassign: vi.fn().mockResolvedValue({
      reassignment_id: 'batch-1', status: 'completed', requested_count: 1, completed_count: 1, failed_count: 0, failed_orders: [],
    }),
  } as unknown as DriverOrderReassignmentService;
  return { controller: new DriverOrderReassignmentController(sessions, access, service), service };
}

describe('DriverOrderReassignmentController fail-closed authorization', () => {
  it('rejects Operations Manager even if general RBAC is only logging', async () => {
    const test = makeController(['ops_manager'], true);
    await expect(test.controller.drivers(request())).rejects.toMatchObject({ status: 403 });
    expect(test.service.listDrivers).not.toHaveBeenCalled();
  });

  it('rejects Logistics Manager when the dedicated grant is missing', async () => {
    const test = makeController(['logistics_manager'], false);
    await expect(test.controller.drivers(request())).rejects.toMatchObject({ status: 403 });
    expect(test.service.listDrivers).not.toHaveBeenCalled();
  });

  it('allows Logistics Manager with the dedicated grant to reassign', async () => {
    const test = makeController(['logistics_manager'], true);
    await expect(test.controller.reassign(request(), {
      source_driver_id: SOURCE,
      target_driver_id: TARGET,
      order_ids: ['order_AAAAAA'],
    })).resolves.toMatchObject({ status: 'completed', completed_count: 1 });
    expect(test.service.reassign).toHaveBeenCalledOnce();
  });
});

const SOURCE = 'driver_AAAAAA';
const TARGET = 'driver_BBBBBB';
