// WP-OPS-03 / A22 — server-only Fleetbase order reassignment client.
// The browser never receives the service token or upstream UUIDs.

import type { FleetbaseCredentialDriver } from './fleetbase-credentials.client';

export interface FleetbaseAssignedOrder {
  uuid?: string;
  public_id?: string;
  driver_assigned_uuid?: string;
  tracking?: string | null;
  status?: string | null;
  dispatched?: boolean;
  scheduled_at?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
}

export interface FleetbaseAssignedOrders {
  driver: FleetbaseCredentialDriver | null;
  current: string | null;
  orders: FleetbaseAssignedOrder[];
}

export interface FleetbaseOrderManagerGateway {
  listDrivers(): Promise<FleetbaseCredentialDriver[]>;
  listAssignedOrders(driverPublicId: string): Promise<FleetbaseAssignedOrders>;
  bulkAssignDriver(orderUuids: string[], targetDriverUuid: string): Promise<void>;
}

export class FleetbaseOrderManagerClientError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = 'FleetbaseOrderManagerClientError';
  }
}

export class FleetbaseOrderManagerClient implements FleetbaseOrderManagerGateway {
  private readonly base: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl: string; token: string; timeoutMs?: number }) {
    this.base = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  static fromEnv(): FleetbaseOrderManagerClient {
    const baseUrl = process.env.FLEETBASE_INTERNAL_API_BASE;
    const token = process.env.FLEETBASE_ORDER_MANAGER_TOKEN;
    if (!baseUrl || !token) {
      throw new FleetbaseOrderManagerClientError(503, 'order_manager_integration_not_configured');
    }
    return new FleetbaseOrderManagerClient({ baseUrl, token });
  }

  async listDrivers(): Promise<FleetbaseCredentialDriver[]> {
    const payload = await this.request<unknown>('GET', '/int/v1/drivers?limit=500');
    if (Array.isArray(payload)) return payload as FleetbaseCredentialDriver[];
    if (!payload || typeof payload !== 'object') return [];
    const object = payload as Record<string, unknown>;
    for (const key of ['drivers', 'data']) {
      if (Array.isArray(object[key])) return object[key] as FleetbaseCredentialDriver[];
    }
    return [];
  }

  async listAssignedOrders(driverPublicId: string): Promise<FleetbaseAssignedOrders> {
    const payload = await this.request<unknown>(
      'GET',
      `/int/v1/drivers/${encodeURIComponent(driverPublicId)}/assigned-orders`,
    );
    if (!payload || typeof payload !== 'object') {
      return { driver: null, current: null, orders: [] };
    }
    const object = payload as Record<string, unknown>;
    return {
      driver: object.driver && typeof object.driver === 'object'
        ? object.driver as FleetbaseCredentialDriver
        : null,
      current: typeof object.current === 'string' ? object.current : null,
      orders: Array.isArray(object.orders) ? object.orders as FleetbaseAssignedOrder[] : [],
    };
  }

  async bulkAssignDriver(orderUuids: string[], targetDriverUuid: string): Promise<void> {
    const unique = [...new Set(orderUuids)];
    const payload = await this.request<unknown>('PATCH', '/int/v1/orders/bulk-assign-driver', {
      ids: unique,
      driver: targetDriverUuid,
      silent: false,
    });
    const count = payload && typeof payload === 'object'
      ? Number((payload as Record<string, unknown>).count)
      : Number.NaN;
    if (!Number.isInteger(count) || count !== unique.length) {
      throw new FleetbaseOrderManagerClientError(502, 'fleetbase_assignment_count_mismatch');
    }
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
        // Upstream bodies can contain operational/customer details; never propagate them.
        throw new FleetbaseOrderManagerClientError(response.status, `fleetbase_http_${response.status}`);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof FleetbaseOrderManagerClientError) throw error;
      throw new FleetbaseOrderManagerClientError(503, 'fleetbase_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
