import type { LabelMealRowContract } from '@nutrezee/shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_BASE_URL = 'https://nutreeze.com/integration';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 100;

export type PartnerLabelSourceErrorCode =
  | 'auth_failed'
  | 'catalog_item_missing'
  | 'dish_name_missing'
  | 'nutrition_incomplete'
  | 'not_configured'
  | 'order_items_missing'
  | 'pagination_invalid'
  | 'response_invalid'
  | 'unavailable'
  | 'upstream_http';

export class PartnerLabelSourceError extends Error {
  constructor(readonly code: PartnerLabelSourceErrorCode) {
    super(code);
    this.name = 'PartnerLabelSourceError';
  }
}

export interface PartnerLabelMealSourceGateway {
  mealsForOrder(orderNumber: string, deliveryDate: string): Promise<LabelMealRowContract[]>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface PartnerLabelSourceConfig {
  baseUrl: string;
  apiKey: string;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

interface PageEnvelope {
  data: unknown[];
  nextCursor: string | number | null;
}

type OrderMeals =
  | { ok: true; rows: LabelMealRowContract[] }
  | { ok: false; code: PartnerLabelSourceErrorCode };

interface DateSnapshot {
  orders: Map<string, OrderMeals>;
}

interface CachedSnapshot {
  expiresAt: number;
  snapshot: DateSnapshot;
}

/**
 * Server-only, read-only client for Partner Kitchen & Labels v2 (A29).
 *
 * The key is used only in an X-Api-Key request header. Upstream response bodies, URLs and the key
 * are never logged or propagated. Date loads are briefly cached and share one in-flight promise so
 * an eight-label preview chunk does not issue eight copies of the same paginated requests.
 */
export class PartnerLabelSource implements PartnerLabelMealSourceGateway {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly inFlight = new Map<string, Promise<DateSnapshot>>();
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(config: PartnerLabelSourceConfig) {
    this.base = normalizeBaseUrl(config.baseUrl);
    this.apiKey = validateApiKey(config.apiKey);
    this.cacheTtlMs = config.cacheTtlMs ?? 60_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /** Development can omit the integration; a production process fails startup without its key. */
  static fromEnv(): PartnerLabelSource | null {
    const apiKey = process.env.NUTREEZE_PARTNER_LABEL_API_KEY?.trim();
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new PartnerLabelSourceError('not_configured');
      }
      return null;
    }
    const baseUrl = process.env.NUTREEZE_PARTNER_LABEL_API_BASE?.trim() || DEFAULT_BASE_URL;
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (url.protocol !== 'https:' || url.hostname !== 'nutreeze.com' || url.port
      || path !== '/integration' || url.username || url.password || url.search || url.hash) {
      throw new PartnerLabelSourceError('response_invalid');
    }
    return new PartnerLabelSource({ baseUrl, apiKey });
  }

  async mealsForOrder(orderNumber: string, deliveryDate: string): Promise<LabelMealRowContract[]> {
    const exactOrderNumber = orderNumber.trim();
    if (!exactOrderNumber || !DATE_RE.test(deliveryDate)) {
      throw new PartnerLabelSourceError('response_invalid');
    }
    const snapshot = await this.dateSnapshot(deliveryDate);
    const result = snapshot.orders.get(exactOrderNumber);
    if (!result) throw new PartnerLabelSourceError('order_items_missing');
    if (!result.ok) throw new PartnerLabelSourceError(result.code);
    return result.rows.map((row) => ({ ...row }));
  }

  private async dateSnapshot(deliveryDate: string): Promise<DateSnapshot> {
    const cached = this.cache.get(deliveryDate);
    if (cached && cached.expiresAt > this.now()) return cached.snapshot;
    if (cached) this.cache.delete(deliveryDate);

    const active = this.inFlight.get(deliveryDate);
    if (active) return active;

    const load = this.fetchDate(deliveryDate)
      .then((snapshot) => {
        this.cache.set(deliveryDate, {
          expiresAt: this.now() + this.cacheTtlMs,
          snapshot,
        });
        return snapshot;
      })
      .finally(() => {
        if (this.inFlight.get(deliveryDate) === load) this.inFlight.delete(deliveryDate);
      });
    this.inFlight.set(deliveryDate, load);
    return load;
  }

  private async fetchDate(deliveryDate: string): Promise<DateSnapshot> {
    const [catalogRows, itemRows] = await Promise.all([
      this.fetchAll('meal-catalog-v2', {}),
      this.fetchAll('order-items', { delivery_date: deliveryDate }),
    ]);
    return buildSnapshot(deliveryDate, catalogRows, itemRows);
  }

  private async fetchAll(endpoint: string, query: Record<string, string>): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | number | null = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${this.base}/${endpoint}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));

      const envelope = await this.requestPage(url);
      rows.push(...envelope.data);
      if (envelope.nextCursor === null) return rows;
      if (envelope.data.length === 0) throw new PartnerLabelSourceError('pagination_invalid');
      const cursorKey = String(envelope.nextCursor);
      if (seenCursors.has(cursorKey)) throw new PartnerLabelSourceError('pagination_invalid');
      seenCursors.add(cursorKey);
      cursor = envelope.nextCursor;
    }
    throw new PartnerLabelSourceError('pagination_invalid');
  }

  private async requestPage(url: URL): Promise<PageEnvelope> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new PartnerLabelSourceError('auth_failed');
      }
      if (!response.ok) throw new PartnerLabelSourceError('upstream_http');
      const payload: unknown = await response.json().catch(() => null);
      return validateEnvelope(payload);
    } catch (error) {
      if (error instanceof PartnerLabelSourceError) throw error;
      throw new PartnerLabelSourceError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateEnvelope(payload: unknown): PageEnvelope {
  if (!isRecord(payload) || !Array.isArray(payload.data)
    || payload.mode !== 'live'
    || !Number.isInteger(payload.count) || Number(payload.count) < 0
    || Number(payload.count) !== payload.data.length
    || typeof payload.server_time !== 'string'
    || !Number.isFinite(Date.parse(payload.server_time))
    || !Object.prototype.hasOwnProperty.call(payload, 'next_cursor')) {
    throw new PartnerLabelSourceError('response_invalid');
  }
  const next = payload.next_cursor;
  if (next !== null && !(typeof next === 'string' && next.length > 0)
    && !(typeof next === 'number' && Number.isInteger(next))) {
    throw new PartnerLabelSourceError('pagination_invalid');
  }
  return { data: payload.data, nextCursor: next as string | number | null };
}

function buildSnapshot(deliveryDate: string, catalogRows: unknown[], itemRows: unknown[]): DateSnapshot {
  const catalog = new Map<string, Record<string, unknown>>();
  for (const raw of catalogRows) {
    if (!isRecord(raw)) throw new PartnerLabelSourceError('response_invalid');
    const mealId = sourceId(raw.meal_id);
    if (!mealId || catalog.has(mealId)) throw new PartnerLabelSourceError('response_invalid');
    catalog.set(mealId, raw);
  }

  const grouped = new Map<string, Record<string, unknown>[]>();
  const itemRefs = new Set<string>();
  for (const raw of itemRows) {
    if (!isRecord(raw)) throw new PartnerLabelSourceError('response_invalid');
    const orderNumber = nonEmptyString(raw.order_number);
    const itemRef = nonEmptyString(raw.item_ref);
    if (!orderNumber || !itemRef || raw.delivery_date !== deliveryDate || itemRefs.has(itemRef)) {
      throw new PartnerLabelSourceError('response_invalid');
    }
    itemRefs.add(itemRef);
    grouped.set(orderNumber, [...(grouped.get(orderNumber) ?? []), raw]);
  }

  const orders = new Map<string, OrderMeals>();
  for (const [orderNumber, items] of grouped) {
    const rows: LabelMealRowContract[] = [];
    let failure: PartnerLabelSourceErrorCode | null = null;
    for (const item of items) {
      const mealId = sourceId(item.meal_id);
      if (!mealId) {
        failure = 'response_invalid';
        break;
      }
      const meal = catalog.get(mealId);
      if (!meal) {
        failure = 'catalog_item_missing';
        break;
      }
      const nutrition = isRecord(meal.nutrition) ? meal.nutrition : null;
      const protein = authoritativeNumber(nutrition?.protein_g);
      const carbs = authoritativeNumber(nutrition?.carbs_g);
      const fat = authoritativeNumber(nutrition?.fat_g);
      const calories = authoritativeNumber(nutrition?.calories);
      if ([protein, carbs, fat, calories].some((value) => value === null)) {
        failure = 'nutrition_incomplete';
        break;
      }
      const dishName = nonEmptyString(item.meal_name_en)
        ?? nonEmptyString(item.meal_name_ar)
        ?? nonEmptyString(meal.name_en)
        ?? nonEmptyString(meal.name_ar);
      if (!dishName) {
        failure = 'dish_name_missing';
        break;
      }
      const qty = positiveQuantity(item.qty);
      if (qty === null) {
        failure = 'response_invalid';
        break;
      }
      // Catalog nutrition is authoritative per meal serving. The order item is authoritative for
      // quantity, so the row values and printed Total Nutrition use exact line totals.
      rows.push({
        dish_name: dishName,
        qty,
        protein: protein! * qty,
        carbs: carbs! * qty,
        fat: fat! * qty,
        calories: calories! * qty,
      });
    }
    orders.set(orderNumber, failure ? { ok: false, code: failure } : { ok: true, rows });
  }
  return { orders };
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PartnerLabelSourceError('response_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PartnerLabelSourceError('response_invalid');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function validateApiKey(raw: string): string {
  const key = raw.trim();
  if (!key || /[\r\n]/.test(key)) throw new PartnerLabelSourceError('auth_failed');
  return key;
}

function sourceId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return null;
}

function authoritativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveQuantity(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
