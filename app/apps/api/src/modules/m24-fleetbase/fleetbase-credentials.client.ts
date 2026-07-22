// WP-OPS-02 — least-privilege Fleetbase credential-management client.
// The bearer token is server-only and must never be returned or logged.

export interface FleetbaseCredentialDriver {
  id?: string;
  uuid?: string;
  public_id?: string;
  user_uuid?: string;
  name?: string;
  phone?: string;
  status?: string;
  online?: boolean;
}

export interface FleetbaseCredentialGateway {
  listDrivers(): Promise<FleetbaseCredentialDriver[]>;
  findDriver(id: string): Promise<FleetbaseCredentialDriver | null>;
  changePassword(userUuid: string, password: string): Promise<void>;
}

export class FleetbaseCredentialClientError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = 'FleetbaseCredentialClientError';
  }
}

export class FleetbaseCredentialClient implements FleetbaseCredentialGateway {
  private readonly base: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl: string; token: string; timeoutMs?: number }) {
    this.base = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  static fromEnv(): FleetbaseCredentialClient {
    const baseUrl = process.env.FLEETBASE_INTERNAL_API_BASE;
    const token = process.env.FLEETBASE_CREDENTIAL_MANAGER_TOKEN;
    if (!baseUrl || !token) {
      throw new FleetbaseCredentialClientError(503, 'credential_integration_not_configured');
    }
    return new FleetbaseCredentialClient({ baseUrl, token });
  }

  async listDrivers(): Promise<FleetbaseCredentialDriver[]> {
    const payload = await this.request<unknown>('GET', '/int/v1/drivers?limit=500');
    return extractDriverList(payload);
  }

  async findDriver(id: string): Promise<FleetbaseCredentialDriver | null> {
    const payload = await this.request<unknown>('GET', `/int/v1/drivers/${encodeURIComponent(id)}`);
    return extractDriver(payload);
  }

  async changePassword(userUuid: string, password: string): Promise<void> {
    await this.request('POST', '/int/v1/auth/change-user-password', {
      user: userUuid,
      password,
      password_confirmation: password,
      send_credentials: false,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? safeJson(text) : null;
      if (!response.ok) {
        // Deliberately discard the upstream body: it can contain account details.
        throw new FleetbaseCredentialClientError(response.status, `fleetbase_http_${response.status}`);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof FleetbaseCredentialClientError) throw error;
      throw new FleetbaseCredentialClientError(503, 'fleetbase_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractDriverList(payload: unknown): FleetbaseCredentialDriver[] {
  if (Array.isArray(payload)) return payload as FleetbaseCredentialDriver[];
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  for (const key of ['drivers', 'data']) {
    if (Array.isArray(object[key])) return object[key] as FleetbaseCredentialDriver[];
  }
  return [];
}

function extractDriver(payload: unknown): FleetbaseCredentialDriver | null {
  if (!payload || typeof payload !== 'object') return null;
  const object = payload as Record<string, unknown>;
  const candidate = object.driver ?? object.data ?? object;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as FleetbaseCredentialDriver
    : null;
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
