import { describe, expect, it } from 'vitest';
import {
  FleetbaseIdentityService,
  HttpFleetbaseIdentityGateway,
  type FleetbaseDriverProjection,
  type FleetbaseIdentityGateway,
  type FleetbaseOrderProjection,
} from '../../apps/api/src/modules/m25-label/fleetbase-identity.service';

// TS-U — A28 identity boundary. Nutrezee accepts only Fleetbase's verified user/driver identity,
// filters driver assignments to the server-validated Kuwait delivery date, and never trusts a
// browser-supplied local driver, route, order id or delivery date.

class FakeGateway implements FleetbaseIdentityGateway {
  sessionResult: { user?: string; type?: string; verified?: boolean } = {
    user: 'user-1',
    type: 'driver',
    verified: true,
  };
  driverResults: FleetbaseDriverProjection[] = [
    { public_id: 'driver_1', internal_id: 'A1', name: 'Driver One' },
  ];
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

  async drivers() {
    return this.driverResults;
  }

  async driversForUser(_token: string, userUuid: string) {
    this.driverUserQuery = userUuid;
    return this.driverResults;
  }

  async assignedOrders(_token: string, driverId: string) {
    this.assignmentDriverQuery = driverId;
    return this.orderResults;
  }

  async orders() {
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

  it('rejects an unverified Fleetbase driver before resolving assignments', async () => {
    const gateway = new FakeGateway();
    gateway.sessionResult = { user: 'driver-user', type: 'driver', verified: false };
    const identity = new FleetbaseIdentityService(gateway);

    await expect(identity.driverContext('token', '2099-05-12')).rejects.toMatchObject({
      code: 'forbidden',
      detail: { reason: 'verified_driver_required' },
    });
    expect(gateway.driverUserQuery).toBeNull();
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

  it('accepts verified Fleetbase user and administrator sessions without fabricating local roles', async () => {
    const gateway = new FakeGateway();
    const identity = new FleetbaseIdentityService(gateway);

    gateway.sessionResult = { user: 'ops-1', type: 'user', verified: true };
    await expect(identity.operatorContext('token')).resolves.toMatchObject({
      staffId: 'fleetbase:ops-1',
      roles: ['fleetbase_operator'],
    });

    gateway.sessionResult = { user: 'admin-1', type: 'admin', verified: true };
    await expect(identity.operatorContext('token')).resolves.toMatchObject({
      staffId: 'fleetbase:admin-1',
      roles: ['fleetbase_admin'],
    });

    gateway.sessionResult = { user: 'ops-2', type: 'user', verified: false };
    await expect(identity.operatorContext('token')).rejects.toMatchObject({
      code: 'forbidden',
      detail: { reason: 'verified_operations_user_required' },
    });
  });

  it('fetches the Fleetbase order server-side and derives its Kuwait delivery date', async () => {
    const gateway = new FakeGateway();
    gateway.sessionResult = { user: 'ops-1', type: 'admin', verified: true };
    const identity = new FleetbaseIdentityService(gateway);

    const verified = await identity.verifiedOrderForOperator('token', 'order_public_7');

    expect(gateway.fetchedOrderId).toBe('order_public_7');
    expect(verified.actor.staffId).toBe('fleetbase:ops-1');
    expect(verified.actor.roles).toEqual(['fleetbase_admin']);
    expect(identity.deliveryDateForOrder(verified.order)).toBe('2099-05-12');
  });

  it('returns only current-day printable operator orders', async () => {
    const gateway = new FakeGateway();
    gateway.sessionResult = { user: 'ops-1', type: 'admin', verified: true };
    gateway.orderResults = [
      { id: 'today', meta: { delivery_date: '2099-05-12' }, status: 'dispatched' },
      { id: 'held', meta: { delivery_date: '2099-05-12', hold_reason: 'no_pin' }, status: 'created' },
      { id: 'cancelled', meta: { delivery_date: '2099-05-12' }, status: 'canceled' },
      { id: 'tomorrow', meta: { delivery_date: '2099-05-13' }, status: 'dispatched' },
    ];
    const identity = new FleetbaseIdentityService(gateway);

    await expect(identity.ordersForOperatorDate('token', '2099-05-12')).resolves.toMatchObject({
      actor: { staffId: 'fleetbase:ops-1' },
      orders: [{ id: 'today' }],
    });
  });

  it('assigns stable distinct colors and current vehicle/phone by immutable driver id', async () => {
    const gateway = new FakeGateway();
    gateway.sessionResult = { user: 'ops-1', type: 'admin', verified: true };
    gateway.driverResults = [
      {
        public_id: 'driver_b', name: 'Name Can Change', phone: '+96550000002',
        vehicle: { plate_number: 'KWT-202' },
      },
      {
        public_id: 'driver_a', name: 'Another Name', phone: '+96550000001',
        vehicle: { plate_number: 'KWT-101' },
      },
    ];
    gateway.orderResults = [
      {
        id: 'order_b', meta: { delivery_date: '2099-05-12' },
        driver_assigned: { public_id: 'driver_b', name: 'Stale Name' },
      },
      {
        id: 'order_a', meta: { delivery_date: '2099-05-12' },
        driver_assigned: { public_id: 'driver_a', name: 'Old Name' },
      },
    ];
    const identity = new FleetbaseIdentityService(gateway);

    const { orders } = await identity.ordersForOperatorDate('token', '2099-05-12');

    expect(orders[0]?.driver_assigned).toMatchObject({
      public_id: 'driver_b', phone: '+96550000002',
      vehicle: { plate_number: 'KWT-202' }, label_color: 'blue',
    });
    expect(orders[1]?.driver_assigned).toMatchObject({
      public_id: 'driver_a', phone: '+96550000001',
      vehicle: { plate_number: 'KWT-101' }, label_color: 'red',
    });
    expect(orders[0]?.driver_assigned?.label_color)
      .not.toBe(orders[1]?.driver_assigned?.label_color);
  });

  it('blocks an assigned label when the current Fleetbase vehicle plate is absent', async () => {
    const gateway = new FakeGateway();
    gateway.sessionResult = { user: 'ops-1', type: 'admin', verified: true };
    gateway.driverResults = [{ public_id: 'driver_1', phone: '+96550000001' }];
    gateway.orderResults = [{
      id: 'order_1', meta: { delivery_date: '2099-05-12' },
      driver_assigned: {
        public_id: 'driver_1',
        // An embedded order snapshot cannot substitute for the current driver directory.
        vehicle: { plate_number: 'STALE-PLATE' },
      },
    }];
    const identity = new FleetbaseIdentityService(gateway);

    await expect(identity.ordersForOperatorDate('token', '2099-05-12'))
      .rejects.toMatchObject({
        code: 'upstream_unavailable',
        detail: { reason: 'assigned_driver_vehicle_plate_missing' },
      });
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
      expect(requested).toEqual([
        'https://fleetbase.test/int/v1/drivers?limit=-1&with%5B%5D=vehicle',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetches the operator-visible company order list through the protected API', async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const page = new URL(url).searchParams.get('page');
      return new Response(JSON.stringify({
        data: page === '1'
          ? [
              { id: 'order_today_1', meta: { delivery_date: '2099-05-12' } },
              { id: 'order_today_2', meta: { delivery_date: '2099-05-12' } },
            ]
          : [{ id: 'order_today_3', meta: { delivery_date: '2099-05-12' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const gateway = new HttpFleetbaseIdentityGateway('https://fleetbase.test', 15_000, 2);
      await expect(gateway.orders('token', '2099-05-12')).resolves.toHaveLength(3);
      expect(requested).toEqual([
        'https://fleetbase.test/v1/orders?scheduled_at=2099-05-12&limit=2&page=1',
        'https://fleetbase.test/v1/orders?scheduled_at=2099-05-12&limit=2&page=2',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed if Fleetbase order pagination repeats a page', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        { id: 'order_repeat_1' },
        { id: 'order_repeat_2' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const gateway = new HttpFleetbaseIdentityGateway('https://fleetbase.test', 15_000, 2);
      await expect(gateway.orders('token', '2099-05-12')).rejects.toMatchObject({
        code: 'upstream_unavailable',
        detail: { reason: 'fleetbase_order_pagination_not_stable' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
