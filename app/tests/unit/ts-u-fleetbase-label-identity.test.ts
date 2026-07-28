import { describe, expect, it } from 'vitest';
import {
  FleetbaseIdentityService,
  HttpFleetbaseIdentityGateway,
  type FleetbaseIdentityGateway,
  type FleetbaseOrderProjection,
} from '../../apps/api/src/modules/m25-label/fleetbase-identity.service';

// TS-U — A28 identity boundary. Nutrezee accepts only Fleetbase's verified user/driver identity,
// filters driver assignments to the requested Kuwait delivery date, and never trusts a browser
// supplied local driver, route, order id or delivery date.

class FakeGateway implements FleetbaseIdentityGateway {
  sessionResult: { user?: string; type?: string } = { user: 'user-1', type: 'driver' };
  driverResults = [{ public_id: 'driver_1', internal_id: 'A1', name: 'Driver One' }];
  orderResults: FleetbaseOrderProjection[] = [];
  oneOrder: FleetbaseOrderProjection = {
    id: 'order_1',
    scheduled_at: '2099-05-11T22:30:00.000Z',
    meta: { source_order_number: 'N-100' },
  };
  driverUserQuery: string | null = null;
  assignmentDriverQuery: string | null = null;
  fetchedOrderId: string | null = null;

  async session() {
    return this.sessionResult;
  }

  async driversForUser(_token: string, userUuid: string) {
    this.driverUserQuery = userUuid;
    return this.driverResults;
  }

  async assignedOrders(_token: string, driverId: string) {
    this.assignmentDriverQuery = driverId;
    return this.orderResults;
  }

  async order(_token: string, orderId: string) {
    this.fetchedOrderId = orderId;
    return this.oneOrder;
  }
}

describe('TS-U Fleetbase identity boundary', () => {
  it('derives one driver and exact date-scoped assigned-order references', async () => {
    const gateway = new FakeGateway();
    gateway.orderResults = [
      {
        id: 'order_a',
        scheduled_at: '2099-05-11T22:30:00.000Z',
        meta: { source_order_number: 'PARTNER-101' },
      },
      {
        id: 'order_b',
        meta: { delivery_date: '2099-05-12', nutrezee_order_id: 'local-102' },
      },
      {
        id: 'order_other_date',
        meta: { delivery_date: '2099-05-13', source_order_number: 'PARTNER-103' },
      },
      {
        id: 'order_without_exact_bridge_ref',
        meta: { delivery_date: '2099-05-12' },
      },
    ];
    const identity = new FleetbaseIdentityService(gateway);

    const ctx = await identity.driverContext('fleetbase-token', '2099-05-12');

    expect(gateway.driverUserQuery).toBe('user-1');
    expect(gateway.assignmentDriverQuery).toBe('driver_1');
    expect(ctx).toEqual({
      actorId: 'fleetbase:user-1',
      actorRole: 'fleetbase_driver',
      userUuid: 'user-1',
      driverId: 'driver_1',
      driverRef: 'A1',
      assignedOrders: [
        {
          fleetbaseOrderId: 'order_a',
          localOrderId: undefined,
          orderNumber: 'PARTNER-101',
        },
        {
          fleetbaseOrderId: 'order_b',
          localOrderId: 'local-102',
          orderNumber: undefined,
        },
      ],
    });
  });

  it('fails closed when the Fleetbase user is not exactly one driver', async () => {
    const gateway = new FakeGateway();
    gateway.driverResults = [];
    const identity = new FleetbaseIdentityService(gateway);

    await expect(identity.driverContext('token', '2099-05-12')).rejects.toMatchObject({
      code: 'identity_ambiguous',
      detail: { reason: 'fleetbase_user_has_no_driver' },
    });

    gateway.driverResults = [
      { public_id: 'driver_1' },
      { public_id: 'driver_2' },
    ];
    await expect(identity.driverContext('token', '2099-05-12')).rejects.toMatchObject({
      code: 'identity_ambiguous',
      detail: { reason: 'fleetbase_user_has_multiple_drivers' },
    });
  });

  it('rejects operations users from driver endpoints and drivers from Fleet-Ops endpoints', async () => {
    const gateway = new FakeGateway();
    const identity = new FleetbaseIdentityService(gateway);

    gateway.sessionResult = { user: 'ops-1', type: 'user' };
    await expect(identity.driverContext('token', '2099-05-12')).rejects.toMatchObject({
      code: 'forbidden',
      detail: { reason: 'driver_session_required' },
    });

    gateway.sessionResult = { user: 'driver-user', type: 'driver' };
    await expect(identity.operatorContext('token')).rejects.toMatchObject({
      code: 'forbidden',
      detail: { reason: 'operations_user_required' },
    });
  });

  it('fetches the Fleetbase order server-side and derives its Kuwait delivery date', async () => {
    const gateway = new FakeGateway();
    gateway.sessionResult = { user: 'ops-1', type: 'user' };
    const identity = new FleetbaseIdentityService(gateway);

    const verified = await identity.verifiedOrderForOperator('token', 'order_public_7');

    expect(gateway.fetchedOrderId).toBe('order_public_7');
    expect(verified.actor.staffId).toBe('fleetbase:ops-1');
    expect(identity.deliveryDateForOrder(verified.order)).toBe('2099-05-12');
  });

  it('rejects invalid dates and orders with no authoritative delivery date', async () => {
    const identity = new FleetbaseIdentityService(new FakeGateway());

    await expect(identity.driverContext('token', '12-05-2099')).rejects.toMatchObject({
      code: 'forbidden',
      detail: { reason: 'invalid_delivery_date' },
    });
    expect(() => identity.deliveryDateForOrder({ id: 'order_no_date' })).toThrowError(
      expect.objectContaining({
        code: 'upstream_unavailable',
        detail: { reason: 'fleetbase_order_has_no_delivery_date' },
      }),
    );
  });

  it('filters the protected Fleetbase driver projection by exact user_uuid itself', async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        data: [
          { public_id: 'driver_other', user_uuid: 'user-other' },
          { public_id: 'driver_exact', user_uuid: 'user-exact' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const gateway = new HttpFleetbaseIdentityGateway('https://fleetbase.test');
      await expect(gateway.driversForUser('token', 'user-exact')).resolves.toEqual([
        { public_id: 'driver_exact', user_uuid: 'user-exact' },
      ]);
      expect(requested).toEqual(['https://fleetbase.test/int/v1/drivers?limit=-1']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
