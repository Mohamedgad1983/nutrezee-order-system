import type { StaffContext } from '../../platform/auth/session.service';
import type { DriverLabelColorToken } from '@nutrezee/shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface FleetbaseOrderProjection {
  id: string;
  internal_id?: string | null;
  scheduled_at?: string | null;
  status?: string | null;
  meta?: Record<string, unknown> | null;
  driver_assigned?: {
    id?: string;
    public_id?: string;
    user_uuid?: string;
    internal_id?: string | null;
    name?: string | null;
    phone?: string | null;
    vehicle_uuid?: string | null;
    vehicle?: { plate_number?: string | null } | null;
    label_color?: DriverLabelColorToken | null;
  } | null;
  customer?: {
    name?: string | null;
    phone?: string | null;
    meta?: Record<string, unknown> | null;
  } | null;
  payload?: {
    meta?: Record<string, unknown> | null;
    dropoff?: {
      name?: string | null;
      phone?: string | null;
      location?: { type?: string; coordinates?: unknown } | null;
    } | null;
  } | null;
}

export interface FleetbaseAssignedOrder {
  fleetbaseOrderId: string;
  localOrderId?: string;
  orderNumber?: string;
  sourceCustomerRef?: string;
  customerName?: string;
  phone?: string;
  area?: string;
  callCustomerRequired?: boolean;
  authoritativePinValid?: boolean;
  fallbackSource?: 'known_stop_anchor' | 'area_centroid';
  fallbackLocation?: { latitude: number; longitude: number };
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

export interface FleetbaseDriverProjection {
  id?: string;
  public_id?: string;
  user_uuid?: string;
  internal_id?: string | null;
  name?: string | null;
  phone?: string | null;
  vehicle_uuid?: string | null;
  vehicle?: { plate_number?: string | null } | null;
}

export interface FleetbaseIdentityGateway {
  session(token: string): Promise<FleetbaseSession>;
  drivers(token: string): Promise<FleetbaseDriverProjection[]>;
  driversForUser(token: string, userUuid: string): Promise<FleetbaseDriverProjection[]>;
  assignedOrders(token: string, driverId: string): Promise<FleetbaseOrderProjection[]>;
  orders(token: string, deliveryDate: string): Promise<FleetbaseOrderProjection[]>;
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
 * Fleetbase password and never stores or logs the token. For drivers, the authenticated Fleetbase
 * driver session UUID is resolved to exactly one Fleetbase driver before any assigned-order query
 * is accepted. Fleetbase's driver password endpoint intentionally permits company-provisioned
 * driver users without email/SMS verification, so that unrelated verification flag is not used as
 * an authorization gate here.
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
    const safeToken = requireToken(token);
    const actor = await this.operatorContext(safeToken);
    const [order, drivers] = await Promise.all([
      this.client().order(safeToken, orderId),
      this.client().drivers(safeToken),
    ]);
    if (!order?.id) throw new FleetbaseIdentityError('upstream_unavailable');
    return { actor, order: enrichDriverAssignments([order], drivers)[0]! };
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
    const [sourceOrders, drivers] = await Promise.all([
      this.client().orders(safeToken, deliveryDate),
      this.client().drivers(safeToken),
    ]);
    const orders = enrichDriverAssignments(sourceOrders, drivers)
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
  private readonly orderPageSize: number;
  private readonly maxOrderPages: number;

  constructor(baseUrl?: string, timeoutMs = 15_000, orderPageSize = 100, maxOrderPages = 100) {
    const configured = baseUrl?.trim() || process.env.FLEETBASE_INTERNAL_API_BASE?.trim();
    this.base = (configured || 'https://ops.nutreeze.com').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.orderPageSize = Math.max(1, Math.min(500, Math.trunc(orderPageSize)));
    this.maxOrderPages = Math.max(1, Math.min(100, Math.trunc(maxOrderPages)));
  }

  session(token: string): Promise<FleetbaseSession> {
    return this.request('GET', '/int/v1/auth/session', token);
  }

  async drivers(token: string): Promise<FleetbaseDriverProjection[]> {
    const response = await this.request<unknown>(
      'GET', '/int/v1/drivers?limit=-1&with%5B%5D=vehicle', token,
    );
    return arrayPayload<FleetbaseDriverProjection>(response);
  }

  async driversForUser(token: string, userUuid: string): Promise<FleetbaseDriverProjection[]> {
    // Fleetbase 0.7.48 exposes user_uuid in the protected internal driver projection, but its
    // DriverFilter silently ignores a user_uuid query parameter. Fetch the current company's
    // bounded driver set and enforce the exact UUID comparison here rather than trusting a
    // non-functional upstream filter.
    return (await this.drivers(token))
      .filter((driver) => driver.user_uuid === userUuid);
  }

  async assignedOrders(token: string, driverId: string): Promise<FleetbaseOrderProjection[]> {
    const response = await this.request<unknown>(
      'GET', `/v1/orders?driver=${encodeURIComponent(driverId)}&limit=-1`, token,
    );
    return arrayPayload<FleetbaseOrderProjection>(response);
  }

  async orders(token: string, deliveryDate: string): Promise<FleetbaseOrderProjection[]> {
    const orders: FleetbaseOrderProjection[] = [];
    const seen = new Set<string>();

    // Fleetbase's unfiltered order history grows indefinitely and even one history page can exceed
    // the per-request timeout. Apply Fleetbase's supported scheduled_at filter at the source, then
    // use its standard paginator so each protected read stays bounded while still collecting the
    // complete operator-visible set for this date. Duplicate/missing ids or a non-terminating
    // paginator fail closed.
    for (let page = 1; page <= this.maxOrderPages; page += 1) {
      const response = await this.request<unknown>(
        'GET',
        `/v1/orders?scheduled_at=${encodeURIComponent(deliveryDate)}&limit=${this.orderPageSize}&page=${page}`,
        token,
      );
      const pageOrders = arrayPayload<FleetbaseOrderProjection>(response);
      for (const order of pageOrders) {
        if (!order.id) {
          throw new FleetbaseIdentityError('upstream_unavailable', {
            reason: 'fleetbase_order_has_no_id',
          });
        }
        if (seen.has(order.id)) {
          throw new FleetbaseIdentityError('upstream_unavailable', {
            reason: 'fleetbase_order_pagination_not_stable',
          });
        }
        seen.add(order.id);
        orders.push(order);
      }

      const lastPage = paginationLastPage(response);
      if ((lastPage !== null && page >= lastPage) || pageOrders.length < this.orderPageSize) {
        return orders;
      }
    }

    throw new FleetbaseIdentityError('upstream_unavailable', {
      reason: 'fleetbase_order_page_limit_exceeded',
    });
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

function paginationLastPage(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const meta = (value as Record<string, unknown>).meta;
  if (!meta || typeof meta !== 'object') return null;
  const lastPage = (meta as Record<string, unknown>).last_page;
  return typeof lastPage === 'number' && Number.isInteger(lastPage) && lastPage > 0
    ? lastPage
    : null;
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

const DRIVER_LABEL_COLORS: readonly DriverLabelColorToken[] = [
  'red', 'blue', 'green', 'orange', 'purple', 'teal', 'pink', 'navy',
  'brown', 'cyan', 'olive', 'amber', 'magenta', 'slate', 'lime', 'coral',
];

function enrichDriverAssignments(
  orders: FleetbaseOrderProjection[],
  drivers: FleetbaseDriverProjection[],
): FleetbaseOrderProjection[] {
  const directory = new Map<string, FleetbaseDriverProjection>();
  for (const driver of drivers) {
    const id = cleanString(driver.public_id) ?? cleanString(driver.id);
    if (!id || directory.has(id)) {
      throw new FleetbaseIdentityError('upstream_unavailable', {
        reason: id ? 'fleetbase_driver_directory_duplicate' : 'fleetbase_driver_public_id_missing',
      });
    }
    directory.set(id, driver);
  }
  if (directory.size > DRIVER_LABEL_COLORS.length) {
    throw new FleetbaseIdentityError('upstream_unavailable', {
      reason: 'driver_label_color_capacity_exceeded',
      capacity: DRIVER_LABEL_COLORS.length,
    });
  }
  const colors = new Map(
    [...directory.keys()].sort().map((id, index) => [id, DRIVER_LABEL_COLORS[index]!] as const),
  );

  return orders.map((order) => {
    const assigned = order.driver_assigned;
    if (!assigned) return order;
    const id = cleanString(assigned.public_id) ?? cleanString(assigned.id);
    if (!id) {
      throw new FleetbaseIdentityError('upstream_unavailable', {
        reason: 'assigned_driver_public_id_missing',
      });
    }
    const profile = directory.get(id);
    if (!profile) {
      throw new FleetbaseIdentityError('upstream_unavailable', {
        reason: 'assigned_driver_not_in_company_directory',
      });
    }
    const phone = cleanString(profile.phone);
    if (!phone) {
      throw new FleetbaseIdentityError('upstream_unavailable', {
        reason: 'assigned_driver_phone_missing',
      });
    }
    const plateNumber = cleanString(profile.vehicle?.plate_number);
    if (!plateNumber) {
      throw new FleetbaseIdentityError('upstream_unavailable', {
        reason: 'assigned_driver_vehicle_plate_missing',
      });
    }
    return {
      ...order,
      driver_assigned: {
        ...assigned,
        ...profile,
        public_id: id,
        phone,
        vehicle: { ...(assigned.vehicle ?? {}), ...(profile.vehicle ?? {}), plate_number: plateNumber },
        label_color: colors.get(id)!,
      },
    };
  });
}

function toAssignedOrder(order: FleetbaseOrderProjection): FleetbaseAssignedOrder | null {
  if (!order.id) return null;
  const localOrderId = stringMeta(order.meta, 'nutrezee_order_id');
  const orderNumber = stringMeta(order.meta, 'source_order_number')
    ?? stringMeta(order.meta, 'external_ref')
    ?? order.internal_id?.trim()
    ?? undefined;
  if (!localOrderId && !orderNumber) return null;
  const payloadMeta = order.payload?.meta;
  const sourceCustomerRef = stringMeta(order.meta, 'source_customer_ref')
    ?? stringMeta(order.customer?.meta, 'source_customer_ref')
    ?? stringMeta(payloadMeta, 'source_customer_ref');
  const customerName = cleanString(order.customer?.name) ?? cleanString(order.payload?.dropoff?.name);
  const phone = cleanString(order.customer?.phone) ?? cleanString(order.payload?.dropoff?.phone);
  const area = stringMeta(order.meta, 'routing_area')
    ?? stringMeta(order.meta, 'area_en')
    ?? stringMeta(payloadMeta, 'routing_area')
    ?? stringMeta(payloadMeta, 'area_en');
  const callCustomerRequired = booleanMeta(order.meta, 'call_customer_required')
    ?? booleanMeta(payloadMeta, 'call_customer_required');
  const pinSource = stringMeta(order.meta, 'pin_source') ?? stringMeta(payloadMeta, 'pin_source');
  const locationAccuracy = stringMeta(order.meta, 'location_accuracy')
    ?? stringMeta(payloadMeta, 'location_accuracy');
  const authoritativePinValid = pinSource === 'vendor' && locationAccuracy === 'customer_pin';
  const fallbackSourceRaw = stringMeta(order.meta, 'fallback_source')
    ?? stringMeta(payloadMeta, 'fallback_source')
    ?? pinSource;
  const fallbackSource = fallbackSourceRaw === 'known_stop_anchor'
    ? 'known_stop_anchor' : (fallbackSourceRaw === 'area_fallback' ? 'area_centroid' : undefined);
  const fallbackLocation = coordinateMeta(order.meta)
    ?? coordinateMeta(payloadMeta)
    ?? geoJsonPoint(order.payload?.dropoff?.location?.coordinates);
  const assignment: FleetbaseAssignedOrder = { fleetbaseOrderId: order.id, localOrderId, orderNumber };
  if (sourceCustomerRef) assignment.sourceCustomerRef = sourceCustomerRef;
  if (customerName) assignment.customerName = customerName;
  if (phone) assignment.phone = phone;
  if (area) assignment.area = area;
  if (callCustomerRequired !== undefined) assignment.callCustomerRequired = callCustomerRequired;
  if (pinSource || locationAccuracy) assignment.authoritativePinValid = authoritativePinValid;
  if (fallbackSource) assignment.fallbackSource = fallbackSource;
  if (fallbackLocation) assignment.fallbackLocation = fallbackLocation;
  return assignment;
}

function stringMeta(meta: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanMeta(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): boolean | undefined {
  const value = meta?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function coordinateMeta(
  meta: Record<string, unknown> | null | undefined,
): { latitude: number; longitude: number } | undefined {
  const latitude = meta?.fallback_latitude;
  const longitude = meta?.fallback_longitude;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)
    || typeof longitude !== 'number' || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude };
}

function geoJsonPoint(value: unknown): { latitude: number; longitude: number } | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [longitude, latitude] = value;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)
    || typeof longitude !== 'number' || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude };
}
