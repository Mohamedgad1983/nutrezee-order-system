import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FleetbaseOrderManagerClient,
} from '../../apps/api/src/modules/m24-fleetbase/fleetbase-order-manager.client';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Fleetbase order manager client', () => {
  it('reads drivers and assigned orders with the server token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ drivers: [{ uuid: 'driver-uuid', public_id: 'driver_AAAAAA' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        driver: { uuid: 'driver-uuid', public_id: 'driver_AAAAAA' },
        current: null,
        orders: [{ uuid: 'order-uuid', public_id: 'order_AAAAAA' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FleetbaseOrderManagerClient({ baseUrl: 'https://fleet.example.test/', token: 'order-server-secret' });

    expect(await client.listDrivers()).toHaveLength(1);
    expect((await client.listAssignedOrders('driver_AAAAAA')).orders).toHaveLength(1);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://fleet.example.test/int/v1/drivers/driver_AAAAAA/assigned-orders');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer order-server-secret' });
  });

  it('uses Fleetbase bulk assignment with derived UUIDs and notifications enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'OK', count: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FleetbaseOrderManagerClient({ baseUrl: 'https://fleet.example.test', token: 'order-server-secret' });
    await client.bulkAssignDriver(['order-uuid-1', 'order-uuid-2'], 'driver-uuid-2');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://fleet.example.test/int/v1/orders/bulk-assign-driver');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      ids: ['order-uuid-1', 'order-uuid-2'],
      driver: 'driver-uuid-2',
      silent: false,
    });
  });

  it('fails closed when Fleetbase reports a different assignment count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'OK', count: 1 }), { status: 200 }),
    ));
    const client = new FleetbaseOrderManagerClient({ baseUrl: 'https://fleet.example.test', token: 'order-server-secret' });
    await expect(client.bulkAssignDriver(['order-uuid-1', 'order-uuid-2'], 'driver-uuid-2'))
      .rejects.toMatchObject({ status: 502, code: 'fleetbase_assignment_count_mismatch' });
  });
});
