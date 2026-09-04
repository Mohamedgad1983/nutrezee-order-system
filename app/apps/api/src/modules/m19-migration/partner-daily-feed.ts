// WP-OPS-06 (A47) — Partner /integration/daily-deliveries → M19 import rows.
//
// Read-only client + pure contract normalization for the same Partner endpoint the Fleetbase
// bridge (ops/fleetbase/nutreeze-orders.php, A36/A46) consumes. The feed is the authority for
// "which customer receives which order on which day"; this module only turns it into rows for
// the governed batch runner (dry-run → apply, idempotent by order_number + delivery_date).
//
// The API key is sent only as an X-Api-Key header and is never logged. Customer PII is passed
// through to the importer inside the batch transaction and never written to the operational log.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_BASE_URL = 'https://nutreeze.com/integration';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 100;
const ID_RE = /^[A-Za-z0-9._-]+$/;

export type PartnerDailyFeedErrorCode =
  | 'not_configured'
  | 'response_invalid'
  | 'upstream_http'
  | 'unavailable'
  | 'contract_violation';

export class PartnerDailyFeedError extends Error {
  constructor(readonly code: PartnerDailyFeedErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PartnerDailyFeedError';
  }
}

/** One Partner delivery row after contract validation (mirrors validateDailyDeliveryRow in PHP). */
export interface PartnerDailyDelivery {
  deliveryId: number;
  orderId: number;
  orderNumber: string;
  deliveryDate: string;
  customerRef: string;
  customerName: string;
  customerPhone: string;
  addressText: string;
  areaEn: string | null;
  areaAr: string | null;
  locationPin: string | null;
  isCancelled: boolean;
  isOnHold: boolean;
  orderStatus: string;
  deliveryStatus: string;
  holdState: string;
  mealItemCount: number;
  partnerDriverId: string | null;
  partnerDriverName: string | null;
  deliveryMethod: string | null;
  timeSlotTitle: string | null;
  updatedAt: string;
}

export interface PartnerDailyCompleteness {
  deliveryDate: string;
  deliveries: number;
  distinctOrders: number;
  scheduled: number;
  onHold: number;
  cancelled: number;
}

export interface PartnerDailyFetchResult {
  rows: PartnerDailyDelivery[];
  completeness: PartnerDailyCompleteness;
  pages: number;
}

/** Flat row handed to the M19 batch runner (hashed for the apply gate, stored in the report). */
export interface PartnerDailyImportRow extends Record<string, unknown> {
  legacy_id: string;
  order_number: string;
  delivery_date: string;
  customer_ref: string;
  customer_name: string;
  customer_phone: string;
  address_text: string;
  area_en: string | null;
  area_ar: string | null;
  location_pin: string | null;
  order_status: string;
  delivery_status: string;
  is_cancelled: boolean;
  is_on_hold: boolean;
  meal_item_count: number;
  delivery_method: string | null;
  delivery_time: string | null;
  partner_driver_id: string | null;
  partner_driver_name: string | null;
  source_delivery_ids: number[];
  updated_at: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface PartnerDailyFeedConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface PartnerDailyFeedGateway {
  fetchDate(deliveryDate: string): Promise<PartnerDailyFetchResult>;
}

function violation(detail: string): never {
  throw new PartnerDailyFeedError('contract_violation', detail);
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function requiredString(obj: Record<string, unknown>, field: string, max: number): string {
  const value = obj[field];
  if (typeof value !== 'string') violation(`${field} must be a string`);
  const out = value.trim();
  if (!out || out.length > max || hasControlChars(out)) violation(`${field} invalid`);
  return out;
}

function optionalString(obj: Record<string, unknown>, field: string, max: number): string | null {
  const value = obj[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') violation(`${field} must be a string`);
  const out = value.trim();
  if (!out) return null;
  if (out.length > max || hasControlChars(out)) violation(`${field} invalid`);
  return out;
}

function requiredBoolean(obj: Record<string, unknown>, field: string): boolean {
  const value = obj[field];
  if (typeof value !== 'boolean') violation(`${field} must be boolean`);
  return value;
}

function requiredObject(obj: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = obj[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) violation(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) violation(`${field} must be a positive integer`);
  return value;
}

export function validateDeliveryDate(value: string): string {
  if (!DATE_RE.test(value)) throw new PartnerDailyFeedError('response_invalid', 'delivery_date');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PartnerDailyFeedError('response_invalid', 'delivery_date');
  }
  return value;
}

/** Partner driver ids are opaque identifiers (int or string); an empty value means unassigned. */
export function normalizePartnerDriverId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) violation('driver.id');
    return String(value);
  }
  if (typeof value !== 'string') violation('driver.id');
  const out = value.trim();
  if (!out) return null;
  if (out.length > 64 || !ID_RE.test(out)) violation('driver.id');
  return out;
}

/** Contract check for one raw delivery row — the same fields the Fleetbase bridge enforces. */
export function normalizeDailyDelivery(raw: unknown, deliveryDate: string): PartnerDailyDelivery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) violation('row must be an object');
  const row = raw as Record<string, unknown>;
  const rowDate = requiredString(row, 'delivery_date', 10);
  if (rowDate !== deliveryDate) violation('delivery_date mismatch');
  const customerRef = requiredString(row, 'customer_ref', 120);
  if (!ID_RE.test(customerRef)) violation('customer_ref');
  const customer = requiredObject(row, 'customer');
  const address = requiredObject(row, 'address');
  const driver = requiredObject(row, 'driver');
  if (!('id' in driver)) violation('driver.id missing');
  const timeSlot = requiredObject(row, 'time_slot');
  const mealItemCount = row['meal_item_count'];
  if (typeof mealItemCount !== 'number' || !Number.isInteger(mealItemCount) || mealItemCount < 0 || mealItemCount > 1_000_000) {
    violation('meal_item_count');
  }
  const rawPin = row['location_pin'];
  if (rawPin !== undefined && rawPin !== null && typeof rawPin !== 'string') violation('location_pin');
  const updatedAt = requiredString(row, 'updated_at', 64);
  if (Number.isNaN(new Date(updatedAt).getTime())) violation('updated_at');

  const isCancelled = requiredBoolean(row, 'is_cancelled');
  const orderStatus = requiredString(row, 'order_status', 32);
  return {
    deliveryId: positiveInt(row['delivery_id'], 'delivery_id'),
    orderId: positiveInt(row['order_id'], 'order_id'),
    orderNumber: requiredString(row, 'order_number', 255),
    deliveryDate: rowDate,
    customerRef,
    customerName: requiredString(customer, 'name', 255),
    customerPhone: requiredString(customer, 'phone', 64),
    addressText: requiredString(address, 'text', 2000),
    areaEn: optionalString(address, 'area_en', 255),
    areaAr: optionalString(address, 'area_ar', 255),
    locationPin: typeof rawPin === 'string' && rawPin.trim() ? rawPin.trim() : null,
    isCancelled,
    isOnHold: requiredBoolean(row, 'is_on_hold'),
    orderStatus: isCancelled || orderStatus === 'cancel' ? 'cancel' : orderStatus,
    deliveryStatus: requiredString(row, 'delivery_status', 64),
    holdState: requiredString(row, 'hold_state', 64),
    mealItemCount,
    partnerDriverId: normalizePartnerDriverId(driver['id']),
    partnerDriverName: optionalString(driver, 'name', 255),
    deliveryMethod: optionalString(row, 'delivery_method', 255),
    timeSlotTitle: optionalString(timeSlot, 'title', 255),
    updatedAt,
  };
}

/**
 * Collapse repeated delivery rows of one order (Partner may emit several rows per order/day)
 * into one canonical row: the latest `updated_at` wins; identity fields must agree.
 */
export function canonicalizeDailyDeliveries(rows: PartnerDailyDelivery[]): PartnerDailyImportRow[] {
  const groups = new Map<string, PartnerDailyDelivery[]>();
  for (const row of rows) {
    const list = groups.get(row.orderNumber) ?? [];
    list.push(row);
    groups.set(row.orderNumber, list);
  }
  const out: PartnerDailyImportRow[] = [];
  for (const [orderNumber, group] of groups) {
    const first = group[0]!;
    for (const member of group) {
      if (member.orderId !== first.orderId
        || member.customerRef !== first.customerRef
        || member.customerPhone !== first.customerPhone
        || member.deliveryDate !== first.deliveryDate) {
        violation(`conflicting rows for order ${orderNumber}`);
      }
    }
    const sorted = [...group].sort((a, b) =>
      (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) || (a.deliveryId - b.deliveryId));
    const selected = sorted[sorted.length - 1]!;
    out.push({
      legacy_id: selected.orderNumber,
      order_number: selected.orderNumber,
      delivery_date: selected.deliveryDate,
      customer_ref: selected.customerRef,
      customer_name: selected.customerName,
      customer_phone: selected.customerPhone,
      address_text: selected.addressText,
      area_en: selected.areaEn,
      area_ar: selected.areaAr,
      location_pin: selected.locationPin,
      order_status: selected.orderStatus,
      delivery_status: selected.deliveryStatus,
      is_cancelled: group.some((m) => m.isCancelled) || selected.orderStatus === 'cancel',
      is_on_hold: selected.isOnHold,
      meal_item_count: selected.mealItemCount,
      delivery_method: selected.deliveryMethod,
      delivery_time: selected.timeSlotTitle,
      partner_driver_id: selected.partnerDriverId,
      partner_driver_name: selected.partnerDriverName,
      source_delivery_ids: group.map((m) => m.deliveryId).sort((a, b) => a - b),
      updated_at: selected.updatedAt,
    });
  }
  out.sort((a, b) => a.order_number.localeCompare(b.order_number));
  return out;
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, '');
  if (url.protocol !== 'https:' || url.hostname !== 'nutreeze.com' || url.port
    || path !== '/integration' || url.username || url.password || url.search || url.hash) {
    throw new PartnerDailyFeedError('response_invalid', 'base_url');
  }
  return `${url.origin}${path}`;
}

/** Server-only, read-only client for /integration/daily-deliveries (cursor-paginated, live mode). */
export class PartnerDailyFeedClient implements PartnerDailyFeedGateway {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(config: PartnerDailyFeedConfig) {
    this.base = normalizeBaseUrl(config.baseUrl);
    const key = config.apiKey.trim();
    if (!key || key.length > 4096 || hasControlChars(key) || /\s/.test(key)) {
      throw new PartnerDailyFeedError('not_configured');
    }
    this.apiKey = key;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /** Same protected key as the label source (one Partner integration key per environment). */
  static fromEnv(): PartnerDailyFeedClient | null {
    const apiKey = (process.env.NUTREEZE_PARTNER_DAILY_API_KEY ?? process.env.NUTREEZE_PARTNER_LABEL_API_KEY)?.trim();
    if (!apiKey) return null;
    const baseUrl = process.env.NUTREEZE_PARTNER_LABEL_API_BASE?.trim() || DEFAULT_BASE_URL;
    return new PartnerDailyFeedClient({ baseUrl, apiKey });
  }

  async fetchDate(deliveryDate: string): Promise<PartnerDailyFetchResult> {
    const date = validateDeliveryDate(deliveryDate);
    const rows: PartnerDailyDelivery[] = [];
    const seenDeliveryIds = new Set<number>();
    let cursor: string | number | null = null;
    let page = 0;
    let completeness: PartnerDailyCompleteness | null = null;
    do {
      page += 1;
      if (page > MAX_PAGES) throw new PartnerDailyFeedError('response_invalid', 'page_guard');
      const params = new URLSearchParams({ delivery_date: date, limit: String(PAGE_LIMIT) });
      if (cursor !== null) params.set('cursor', String(cursor));
      const payload = await this.request(`${this.base}/daily-deliveries?${params.toString()}`);
      const envelope = parseEnvelope(payload);
      const pageCompleteness = parseCompleteness(envelope.completeness, date, envelope.data.length === 0);
      if (completeness && JSON.stringify(completeness) !== JSON.stringify(pageCompleteness)) {
        throw new PartnerDailyFeedError('response_invalid', 'completeness_changed');
      }
      completeness = pageCompleteness;
      for (const raw of envelope.data) {
        const row = normalizeDailyDelivery(raw, date);
        if (seenDeliveryIds.has(row.deliveryId)) violation(`duplicate delivery_id ${row.deliveryId}`);
        seenDeliveryIds.add(row.deliveryId);
        rows.push(row);
      }
      if (envelope.nextCursor !== null && String(envelope.nextCursor) === String(cursor)) {
        throw new PartnerDailyFeedError('response_invalid', 'cursor_no_progress');
      }
      cursor = envelope.nextCursor;
    } while (cursor !== null);
    if (!completeness) throw new PartnerDailyFeedError('response_invalid', 'completeness_missing');
    if (completeness.deliveries !== rows.length) {
      throw new PartnerDailyFeedError('response_invalid', 'completeness_mismatch');
    }
    return { rows, completeness, pages: page };
  }

  private async request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Api-Key': this.apiKey },
        signal: controller.signal,
      });
    } catch {
      throw new PartnerDailyFeedError('unavailable');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) throw new PartnerDailyFeedError('upstream_http', 'auth');
    if (!response.ok) throw new PartnerDailyFeedError('upstream_http', String(response.status));
    try {
      return await response.json();
    } catch {
      throw new PartnerDailyFeedError('response_invalid', 'json');
    }
  }
}

interface Envelope {
  data: unknown[];
  nextCursor: string | number | null;
  completeness: unknown;
}

function parseEnvelope(payload: unknown): Envelope {
  if (!payload || typeof payload !== 'object') throw new PartnerDailyFeedError('response_invalid', 'envelope');
  const body = payload as Record<string, unknown>;
  const data = body['data'];
  const count = body['count'];
  if (!Array.isArray(data) || typeof count !== 'number' || count !== data.length
    || typeof body['server_time'] !== 'string' || !('next_cursor' in body) || body['mode'] !== 'live') {
    throw new PartnerDailyFeedError('response_invalid', 'envelope');
  }
  const next = body['next_cursor'];
  if (next !== null && typeof next !== 'string' && typeof next !== 'number') {
    throw new PartnerDailyFeedError('response_invalid', 'cursor');
  }
  return { data, nextCursor: next as string | number | null, completeness: body['completeness'] };
}

function parseCompleteness(raw: unknown, date: string, emptyPage: boolean): PartnerDailyCompleteness {
  if (!raw || typeof raw !== 'object') throw new PartnerDailyFeedError('response_invalid', 'completeness');
  const completeness = raw as Record<string, unknown>;
  const perDate = completeness['per_date'];
  const windowFrom = completeness['window_from'];
  const windowTo = completeness['window_to'];
  if (!Array.isArray(perDate) || typeof windowFrom !== 'string' || typeof windowTo !== 'string') {
    throw new PartnerDailyFeedError('response_invalid', 'completeness');
  }
  if (date < windowFrom || date > windowTo) throw new PartnerDailyFeedError('response_invalid', 'window');
  const matching = perDate.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && (item as Record<string, unknown>)['delivery_date'] === date);
  if (matching.length > 1) throw new PartnerDailyFeedError('response_invalid', 'completeness_date');
  let daily: Record<string, unknown>;
  if (matching.length === 0) {
    // The live endpoint omits zero-delivery dates inside its window.
    if (!emptyPage) throw new PartnerDailyFeedError('response_invalid', 'completeness_date');
    daily = { deliveries: 0, distinct_orders: 0, scheduled: 0, on_hold: 0, cancelled: 0 };
  } else {
    daily = matching[0]!;
  }
  const counts: Record<string, number> = {};
  for (const field of ['deliveries', 'distinct_orders', 'scheduled', 'on_hold', 'cancelled']) {
    const value = daily[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new PartnerDailyFeedError('response_invalid', `completeness_${field}`);
    }
    counts[field] = value;
  }
  if (counts['scheduled']! + counts['on_hold']! + counts['cancelled']! !== counts['deliveries']) {
    throw new PartnerDailyFeedError('response_invalid', 'completeness_total');
  }
  return {
    deliveryDate: date,
    deliveries: counts['deliveries']!,
    distinctOrders: counts['distinct_orders']!,
    scheduled: counts['scheduled']!,
    onHold: counts['on_hold']!,
    cancelled: counts['cancelled']!,
  };
}
