const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KITCHEN_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DEFAULT_BASE_URL = 'https://nutreeze.com/integration';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 100;

export type PartnerKdsSourceErrorCode =
  | 'auth_failed'
  | 'not_configured'
  | 'pagination_invalid'
  | 'response_invalid'
  | 'unavailable'
  | 'upstream_http';

export class PartnerKdsSourceError extends Error {
  constructor(readonly code: PartnerKdsSourceErrorCode) {
    super(code);
    this.name = 'PartnerKdsSourceError';
  }
}

export interface PartnerKdsSection {
  sectionId: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  stepNo: number | null;
  isPacking: boolean;
}

export interface PartnerKdsItem {
  itemRef: string;
  mealId: string;
  nameEn: string | null;
  nameAr: string | null;
  portionSize: string | null;
  quantity: number;
  sections: PartnerKdsSection[];
}

export interface PartnerKdsDay {
  items: PartnerKdsItem[];
  serverTime: string;
}

export interface PartnerKdsSourceGateway {
  itemsForDay(deliveryDate: string, kitchen: string): Promise<PartnerKdsDay>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface PartnerKdsSourceConfig {
  apiKey: string;
  baseUrl: string;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

interface PageEnvelope {
  data: unknown[];
  nextCursor: string | number | null;
  serverTime: string;
}

interface CachedDay {
  expiresAt: number;
  day: PartnerKdsDay;
}

/** Server-only, read-only client for Partner Kitchen & Labels v2 order items. */
export class PartnerKdsSource implements PartnerKdsSourceGateway {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly cache = new Map<string, CachedDay>();
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly inFlight = new Map<string, Promise<PartnerKdsDay>>();
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(config: PartnerKdsSourceConfig) {
    this.apiKey = validateApiKey(config.apiKey);
    this.base = normalizeBaseUrl(config.baseUrl);
    this.cacheTtlMs = config.cacheTtlMs ?? 15_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  static fromEnv(): PartnerKdsSource | null {
    // A29 provisioned one read-only Kitchen & Labels v2 credential. KDS deliberately reuses
    // that server-held credential; it is never sent to either browser application.
    const apiKey = process.env.NUTREEZE_PARTNER_LABEL_API_KEY?.trim();
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') throw new PartnerKdsSourceError('not_configured');
      return null;
    }
    const baseUrl = process.env.NUTREEZE_PARTNER_LABEL_API_BASE?.trim() || DEFAULT_BASE_URL;
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (url.protocol !== 'https:' || url.hostname !== 'nutreeze.com' || url.port
      || path !== '/integration' || url.username || url.password || url.search || url.hash) {
      throw new PartnerKdsSourceError('response_invalid');
    }
    return new PartnerKdsSource({ apiKey, baseUrl });
  }

  async itemsForDay(deliveryDate: string, kitchen: string): Promise<PartnerKdsDay> {
    if (!validCalendarDate(deliveryDate) || !KITCHEN_RE.test(kitchen)) {
      throw new PartnerKdsSourceError('response_invalid');
    }
    const key = `${deliveryDate}\u0000${kitchen}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cloneDay(cached.day);
    if (cached) this.cache.delete(key);
    const active = this.inFlight.get(key);
    if (active) return cloneDay(await active);

    const load = this.fetchAll(deliveryDate, kitchen)
      .then((day) => {
        this.cache.set(key, { expiresAt: this.now() + this.cacheTtlMs, day });
        return day;
      })
      .finally(() => {
        if (this.inFlight.get(key) === load) this.inFlight.delete(key);
      });
    this.inFlight.set(key, load);
    return cloneDay(await load);
  }

  private async fetchAll(deliveryDate: string, kitchen: string): Promise<PartnerKdsDay> {
    const rows: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | number | null = null;
    let serverTime = '';

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${this.base}/order-items`);
      url.searchParams.set('delivery_date', deliveryDate);
      url.searchParams.set('kitchen', kitchen);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));

      const envelope = await this.requestPage(url);
      rows.push(...envelope.data);
      serverTime = envelope.serverTime;
      if (envelope.nextCursor === null) {
        return { items: normalizeItems(rows, deliveryDate), serverTime };
      }
      if (envelope.data.length === 0) throw new PartnerKdsSourceError('pagination_invalid');
      const cursorKey = String(envelope.nextCursor);
      if (seenCursors.has(cursorKey)) throw new PartnerKdsSourceError('pagination_invalid');
      seenCursors.add(cursorKey);
      cursor = envelope.nextCursor;
    }
    throw new PartnerKdsSourceError('pagination_invalid');
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
        throw new PartnerKdsSourceError('auth_failed');
      }
      if (!response.ok) throw new PartnerKdsSourceError('upstream_http');
      const payload: unknown = await response.json().catch(() => null);
      return validateEnvelope(payload);
    } catch (error) {
      if (error instanceof PartnerKdsSourceError) throw error;
      throw new PartnerKdsSourceError('unavailable');
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
    throw new PartnerKdsSourceError('response_invalid');
  }
  const next = payload.next_cursor;
  if (next !== null && !(typeof next === 'string' && next.length > 0)
    && !(typeof next === 'number' && Number.isInteger(next))) {
    throw new PartnerKdsSourceError('pagination_invalid');
  }
  return {
    data: payload.data,
    nextCursor: next as string | number | null,
    serverTime: payload.server_time,
  };
}

function normalizeItems(rows: unknown[], deliveryDate: string): PartnerKdsItem[] {
  const itemRefs = new Set<string>();
  return rows.map((raw) => {
    if (!isRecord(raw)) throw new PartnerKdsSourceError('response_invalid');
    const itemRef = nonEmptyString(raw.item_ref);
    const mealId = sourceId(raw.meal_id);
    const quantity = positiveQuantity(raw.qty);
    if (!itemRef || !mealId || quantity === null || raw.delivery_date !== deliveryDate
      || itemRefs.has(itemRef) || !Array.isArray(raw.sections)) {
      throw new PartnerKdsSourceError('response_invalid');
    }
    itemRefs.add(itemRef);
    const sections = raw.sections.map(normalizeSection);
    const sectionKeys = new Set(sections.map((section) => `${section.sectionId}\u0000${section.code}`));
    if (sectionKeys.size !== sections.length) throw new PartnerKdsSourceError('response_invalid');
    const nameEn = nonEmptyString(raw.meal_name_en);
    const nameAr = nonEmptyString(raw.meal_name_ar);
    if (!nameEn && !nameAr) throw new PartnerKdsSourceError('response_invalid');
    return {
      itemRef,
      mealId,
      nameEn,
      nameAr,
      portionSize: scalarString(raw.portion_size),
      quantity,
      sections,
    };
  });
}

function normalizeSection(raw: unknown): PartnerKdsSection {
  if (!isRecord(raw)) throw new PartnerKdsSourceError('response_invalid');
  const sectionId = sourceId(raw.section_id);
  const code = nonEmptyString(raw.code);
  if (!sectionId || !code) throw new PartnerKdsSourceError('response_invalid');
  const stepNo = raw.step_no === null || raw.step_no === undefined
    ? null
    : typeof raw.step_no === 'number' && Number.isInteger(raw.step_no) && raw.step_no >= 0
      ? raw.step_no
      : Number.NaN;
  if (Number.isNaN(stepNo)) throw new PartnerKdsSourceError('response_invalid');
  if (raw.is_packing !== undefined && typeof raw.is_packing !== 'boolean') {
    throw new PartnerKdsSourceError('response_invalid');
  }
  return {
    sectionId,
    code,
    nameEn: nonEmptyString(raw.name_en),
    nameAr: nonEmptyString(raw.name_ar),
    stepNo,
    isPacking: raw.is_packing === true,
  };
}

function cloneDay(day: PartnerKdsDay): PartnerKdsDay {
  return {
    serverTime: day.serverTime,
    items: day.items.map((item) => ({
      ...item,
      sections: item.sections.map((section) => ({ ...section })),
    })),
  };
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PartnerKdsSourceError('response_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PartnerKdsSourceError('response_invalid');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function validateApiKey(raw: string): string {
  const key = raw.trim();
  if (!key || /[\r\n]/.test(key)) throw new PartnerKdsSourceError('auth_failed');
  return key;
}

function validCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function sourceId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === null || value === undefined) return null;
  throw new PartnerKdsSourceError('response_invalid');
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
