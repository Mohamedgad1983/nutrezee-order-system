import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetbaseCredentialClient } from '../../apps/api/src/modules/m24-fleetbase/fleetbase-credentials.client';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Fleetbase credential client', () => {
  it('uses the server token for internal driver reads and parses Fleetbase envelopes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ drivers: [{ public_id: 'driver_AAAAAA', user_uuid: 'user-1' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ driver: { public_id: 'driver_AAAAAA', user_uuid: 'user-1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FleetbaseCredentialClient({ baseUrl: 'https://fleet.example.test/', token: 'server-secret' });

    expect(await client.listDrivers()).toHaveLength(1);
    expect((await client.findDriver('driver_AAAAAA'))?.user_uuid).toBe('user-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://fleet.example.test/int/v1/drivers?limit=500');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer server-secret' });
  });

  it('posts only the derived user, matching password confirmation, and no email flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new FleetbaseCredentialClient({ baseUrl: 'https://fleet.example.test', token: 'server-secret' });
    await client.changePassword('user-1', 'Strong!Pass2026');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://fleet.example.test/int/v1/auth/change-user-password');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      user: 'user-1',
      password: 'Strong!Pass2026',
      password_confirmation: 'Strong!Pass2026',
      send_credentials: false,
    });
  });
});
