import type { StaffContext } from '../../platform/auth/session.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface FleetbaseOrderProjection {
  id: string;
  internal_id?: string | null;
  scheduled_at?: string | null;
  status?: string | null;
  meta?: Record<string, unknown> | null;
  driver_assigned?: { id?: string; public_id?: string; internal_id?: string; name?: string } | null;
}

export interface FleetbaseAssignedOrder {
  fleetbaseOrderId: string;
  localOrderId?: string;
  orderNumber?: string;
}

export interface FleetbaseDriverContext {
  actorId: string;
  actorRole: 'fleetbase_driver';
  userUuid: string;
  driverId: string;
  driverRef: string;
  assignedOrders: FleetbaseAssignedOrder[];
}

interface FleetbaseSession {
  user?: string;
  type?: string;
  verified?: boolean;
}

interface FleetbaseDriverProjection {
  id?: string;
  public_id?: string;
  user_uuid?: string;
  internal_id?: string | null;
  name?: string | null;
}

export interface FleetbaseIdentityGateway {
  session(token: string): Promise<FleetbaseSession>;
  driversForUser(token: string, userUuid: string): Promise<FleetbaseDriverProjection[]>;
  assignedOrders(token: string, driverId: string): Promise<FleetbaseOrderProjection[]>;
  orders(token: string): Promise<FleetbaseOrderProjection[]>;
  order(token: string, orderId: string): Promise<FleetbaseOrderProjection>;
}

export class FleetbaseIdentityError extends Error {
  constructor(
    readonly code: 'invalid_token' | 'forbidden' | 'identity_ambiguous' | 'upstream_unavailable',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

/**
 * Validates Fleetbase bearer tokens against Fleetbase itself. The Nutrezee API never receives a
 * Fleetbase password and never stores or logs the token. For drivers, the verified session UUID is
 * resolved to exactly one Fleetbase driver before any assigned-order query is accepted.
 */
export class FleetbaseIdentityService {
  private gateway: FleetbaseIdentityGateway | null;

  constructor(gateway?: FleetbaseIdentityGateway) {
    this.gateway = gateway ?? null;
  }

  async operatorContext(token: string): Promise<StaffContext> {
    const session = await this.client().session(requireToken(token));
    if (!session.user) throw new FleetbaseIdentityError('invalid_token');
    if (session.verified === false) {
      throw new FleetbaseIdentityError('forbidden', { reason: 'verified_operations_user_required' });
    }
    if (session.type !== 'user' && session.type !== 'admin') {
      throw new FleetbaseIdentityError('forbidden', { reason: 'operations_user_required' });
    }
    return {
      staffId: `fleetbase:${session.user}`,
      name: 'Fleet-Ops user',
      email: '',
      locale: 'en',
      // Do not fabricate a Nutrezee RBAC role. The same token must successfully fetch the
      // Fleetbase order in verifiedOrderForOperator(), which is the upstream authorization gate.
      roles: [session.type === 'admin' ? 'fleetbase_admin' : 'fleetbase_operator'],
      sessionId: 'fleetbase',
    };
  }

  async driverContext(token: string, deliveryDate: string): Promise<FleetbaseDriverContext> {
    if (!DATE_RE.test(deliveryDate)) {
      throw new FleetbaseIdentityError('forbidden', { reason: 'invalid_delivery_date' });
    }
    const safeToken = requireToken(token);
    const session = await this.client().session(safeToken);
    if (!session.user) throw new FleetbaseIdentityError('invalid_token');
    if (session.verified === false) {
      throw new FleetbaseIdentityError('forbidden', { reason: 'verified_driver_required' });
    }
    if (session.type !== 'driver') {
      throw new FleetbaseIdentityError('forbidden', { reason: 'driver_session_required' });
    }

    const drivers = await this.client().driversForUser(safeToken, session.user);
    if (drivers.length !== 1) {
      throw new FleetbaseIdentityError('identity_ambiguous', {
        reason: drivers.length === 0 ? 'fleetbase_user_has_no_driver' : 'fleetbase_user_has_multiple_drivers',
      });
    }
    const driver = drivers[0]!;
    const driverId = driver.public_id ?? driver.id;
    if (!driverId) throw new FleetbaseIdentityError('identity_ambiguous', { reason: 'driver_has_no_public_id' });

    const orders = await this.client().assignedOrders(safeToken, driverId);
    const assignedOrders = orders
      .filter((order) => fleetbaseOrderDate(order) === deliveryDate)
      .map(toAssignedOrder)
      .filter((order): order is FleetbaseAssignedOrder => Boolean(order));

    return {
      actorId: `fleetbase:${session.user}`,
      actorRole: 'fleetbase_driver',
      userUuid: session.user,
      driverId,
      driverRef: driver.internal_id?.trim() || driver.name?.trim() || driverId,
      assignedOrders,
    };
  }

  async verifiedOrderForOperator(token: string, orderId: string): Promise<{
    actor: StaffContext;
    order: FleetbaseOrderProjection;
  }> {
    const actor = await this.operatorContext(token);
    const order = await this.client().order(requireToken(token), orderId);
    if (!order?.id) throw new FleetbaseIdentityError('upstream_unavailable');
    return { actor, order };
  }

  /**
   * The operator-visible Fleetbase orders for one server-selected delivery date. The response is
   * the complete operational batch authority; held/cancelled orders can never become printable
   * driver work and a partial local fulfillment set is never substituted.
   */
  async ordersForOperatorDate(token: string, deliveryDate: string): Promise<{
    actor: StaffContext;
    orders: FleetbaseOrderProjection[];
  }> {
    if (!DATE_RE.test(deliveryDate)) {
      throw new FleetbaseIdentityError('forbidden', { reason: 'invalid_delivery_date' });
    }
    const safeToken = requireToken(token);
    const actor = await this.operatorContext(safeToken);
    const orders = (await this.client().orders(safeToken))
      .filter((order) => order.id && fleetbaseOrderDate(order) === deliveryDate)
      .filter((order) => !isHeldOrCancelled(order));
    return { actor, orders };
  }

  /** Delivery date is sourced from the server-fetched Fleetbase order, never from the browser. */
  deliveryDateForOrder(order: FleetbaseOrderProjection): string {
    const deliveryDate = fleetbaseOrderDate(order);
    if (!deliveryDate) {
      throw new FleetbaseIdentityError('upstream_unavailable', {
        reason: 'fleetbase_order_has_no_delivery_date',
      });
    }
    return deliveryDate;
  }

  private client(): FleetbaseIdentityGateway {
    if (!this.gateway) this.gateway = new HttpFleetbaseIdentityGateway();
    return this.gateway;
  }
}

export class HttpFleetbaseIdentityGateway implements FleetbaseIdentityGateway {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs = 15_000) {
    const configured = baseUrl?.trim() || process.env.FLEETBASE_INTERNAL_API_BASE?.trim();
    this.base = (configured || 'https://ops.nutreeze.com').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  session(token: string): Promise<FleetbaseSession> {
    return this.request('GET', '/int/v1/auth/session', token);
  }

  async driversForUser(token: string, userUuid: string): Promise<FleetbaseDriverProjection[]> {
    const response = await this.request<unknown>(
      // Fleetbase 0.7.48 exposes user_uuid in the protected internal driver projection, but its
      // DriverFilter silently ignores a user_uuid query parameter. Fetch the current company's
      // bounded driver set and enforce the exact UUID comparison here rather than trusting a
      // non-functional upstream filter.
      'GET', '/int/v1/drivers?limit=-1', token,
    );
    return arrayPayload<FleetbaseDriverProjection>(response)
      .filter((driver) => driver.user_uuid === userUuid);
  }

  async assignedOrders(token: string, driverId: string): Promise<FleetbaseOrderProjection[]> {
    const response = await this.request<unknown>(
      'GET', `/v1/orders?driver=${encodeURIComponent(driverId)}&limit=-1`, token,
    );
    return arrayPayload<FleetbaseOrderProjection>(response);
  }

  async orders(token: string): Promise<FleetbaseOrderProjection[]> {
    const response = await this.request<unknown>('GET', '/v1/orders?limit=-1', token);
    return arrayPayload<FleetbaseOrderProjection>(response);
  }

  order(token: string, orderId: string): Promise<FleetbaseOrderProjection> {
    return this.request('GET', `/v1/orders/${encodeURIComponent(orderId)}`, token);
  }

  private async request<T>(method: 'GET', path: string, token: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await response.text();
      const body = safeJson(text);
      if (response.status === 401 || response.status === 403) {
        throw new FleetbaseIdentityError(
          response.status === 401 ? 'invalid_token' : 'forbidden',
        );
      }
      if (!response.ok || body === null) {
        throw new FleetbaseIdentityError('upstream_unavailable', { status: response.status });
      }
      return body as T;
    } catch (error) {
      if (error instanceof FleetbaseIdentityError) throw error;
      throw new FleetbaseIdentityError('upstream_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}

function requireToken(token: string): string {
  const value = String(token ?? '').trim();
  if (!value || value.length > 4096) throw new FleetbaseIdentityError('invalid_token');
  return value;
}

function arrayPayload<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data as T[];
  }
  return [];
}

function safeJson(text: string): unknown | null {
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    return null;
  }
}

function fleetbaseOrderDate(order: FleetbaseOrderProjection): string | null {
  const metaDate = order.meta?.delivery_date;
  if (typeof metaDate === 'string' && DATE_RE.test(metaDate)) return metaDate;
  if (!order.scheduled_at) return null;
  const date = new Date(order.scheduled_at);
  if (Number.isNaN(date.getTime())) return null;
  const kuwait = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return kuwait.toISOString().slice(0, 10);
}

function isHeldOrCancelled(order: FleetbaseOrderProjection): boolean {
  const status = String(order.status ?? '').toLowerCase();
  if (status.includes('cancel')) return true;
  const holdReason = order.meta?.hold_reason;
  return typeof holdReason === 'string' && holdReason.trim().length > 0;
}

function toAssignedOrder(order: FleetbaseOrderProjection): FleetbaseAssignedOrder | null {
  if (!order.id) return null;
  const localOrderId = stringMeta(order.meta, 'nutrezee_order_id');
  const orderNumber = stringMeta(order.meta, 'source_order_number')
    ?? stringMeta(order.meta, 'external_ref')
    ?? order.internal_id?.trim()
    ?? undefined;
  if (!localOrderId && !orderNumber) return null;
  return { fleetbaseOrderId: order.id, localOrderId, orderNumber };
}

function stringMeta(meta: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
