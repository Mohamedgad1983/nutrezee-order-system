import { readFileSync } from 'node:fs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KITCHEN_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SECTION_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const DEFAULT_BASE_URL = 'https://nutreeze.com/integration';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 50;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ITEMS = PAGE_LIMIT * MAX_PAGES;
const QUANTITY_SCALE = 1_000_000;

export type PartnerSourceErrorCode =
  | 'auth_failed'
  | 'not_configured'
  | 'pagination_invalid'
  | 'response_invalid'
  | 'unavailable'
  | 'upstream_http';

export class PartnerSourceError extends Error {
  constructor(readonly code: PartnerSourceErrorCode) {
    super(code);
    this.name = 'PartnerSourceError';
  }
}

export interface PartnerSection {
  sectionId: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  stepNo: number | null;
  isPacking: boolean;
}

export interface PartnerItem {
  itemRef: string;
  mealId: string;
  nameEn: string | null;
  nameAr: string | null;
  portionSize: string | null;
  quantity: number;
  sections: PartnerSection[];
}

export interface PartnerDay {
  items: PartnerItem[];
  serverTime: string;
}

export interface PartnerSourceGateway {
  itemsForDay(deliveryDate: string, kitchen: string): Promise<PartnerDay>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface PartnerSourceConfig {
  apiKey: string;
  baseUrl: string;
  cacheTtlMs?: number;
  fetchImpl?: FetchLike;
  maxTotalResponseBytes?: number;
  now?: () => number;
  timeoutMs?: number;
}

interface PageEnvelope {
  data: unknown[];
  nextCursor: string | number | null;
  responseBytes: number;
  serverTime: string;
}

interface CachedDay {
  expiresAt: number;
  day: PartnerDay;
}

/** Server-only, read-only client for Partner Kitchen & Labels v2 order items. */
export class PartnerSource implements PartnerSourceGateway {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly cache = new Map<string, CachedDay>();
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly inFlight = new Map<string, Promise<PartnerDay>>();
  private readonly maxTotalResponseBytes: number;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(config: PartnerSourceConfig) {
    this.apiKey = validateApiKey(config.apiKey);
    this.base = normalizeBaseUrl(config.baseUrl);
    this.cacheTtlMs = config.cacheTtlMs ?? 15_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxTotalResponseBytes = config.maxTotalResponseBytes ?? MAX_TOTAL_RESPONSE_BYTES;
    if (!Number.isSafeInteger(this.maxTotalResponseBytes) || this.maxTotalResponseBytes < 1
      || this.maxTotalResponseBytes > MAX_TOTAL_RESPONSE_BYTES) {
      throw new PartnerSourceError('response_invalid');
    }
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): PartnerSource {
    const apiKey = secretValue(env.KDS_PARTNER_API_KEY, env.KDS_PARTNER_API_KEY_FILE);
    if (!apiKey) throw new PartnerSourceError('not_configured');
    const baseUrl = env.KDS_PARTNER_API_BASE?.trim() || DEFAULT_BASE_URL;
    validateProductionEndpoint(baseUrl, env.NODE_ENV);
    return new PartnerSource({ apiKey, baseUrl });
  }

  async itemsForDay(deliveryDate: string, kitchen: string): Promise<PartnerDay> {
    if (!validCalendarDate(deliveryDate) || !KITCHEN_RE.test(kitchen)) {
      throw new PartnerSourceError('response_invalid');
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

  private async fetchAll(deliveryDate: string, kitchen: string): Promise<PartnerDay> {
    const items: PartnerItem[] = [];
    const itemRefs = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | number | null = null;
    let responseBytes = 0;
    let serverTime = '';

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(`${this.base}/order-items`);
      url.searchParams.set('delivery_date', deliveryDate);
      url.searchParams.set('kitchen', kitchen);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));

      const envelope = await this.requestPage(url);
      responseBytes += envelope.responseBytes;
      if (responseBytes > this.maxTotalResponseBytes) throw new PartnerSourceError('pagination_invalid');
      items.push(...normalizeItems(envelope.data, deliveryDate, itemRefs));
      if (items.length > MAX_TOTAL_ITEMS) throw new PartnerSourceError('pagination_invalid');
      serverTime = envelope.serverTime;
      if (envelope.nextCursor === null) {
        return { items, serverTime };
      }
      if (envelope.data.length === 0) throw new PartnerSourceError('pagination_invalid');
      const cursorKey = String(envelope.nextCursor);
      if (seenCursors.has(cursorKey)) throw new PartnerSourceError('pagination_invalid');
      seenCursors.add(cursorKey);
      cursor = envelope.nextCursor;
    }
    throw new PartnerSourceError('pagination_invalid');
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
        throw new PartnerSourceError('auth_failed');
      }
      if (!response.ok) throw new PartnerSourceError('upstream_http');
      const decoded = await readJsonLimited(response);
      return { ...validateEnvelope(decoded.payload), responseBytes: decoded.bytes };
    } catch (error) {
      if (error instanceof PartnerSourceError) throw error;
      throw new PartnerSourceError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateProductionEndpoint(raw: string, nodeEnv: string | undefined): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PartnerSourceError('response_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (nodeEnv === 'production' && (url.protocol !== 'https:' || url.hostname !== 'nutreeze.com'
    || url.port || path !== '/integration' || url.username || url.password || url.search || url.hash)) {
    throw new PartnerSourceError('response_invalid');
  }
}

function validateEnvelope(payload: unknown): Omit<PageEnvelope, 'responseBytes'> {
  if (!isRecord(payload) || !Array.isArray(payload.data)
    || payload.mode !== 'live'
    || !Number.isInteger(payload.count) || Number(payload.count) < 0
    || Number(payload.count) !== payload.data.length
    || typeof payload.server_time !== 'string'
    || !Number.isFinite(Date.parse(payload.server_time))
    || !Object.prototype.hasOwnProperty.call(payload, 'next_cursor')) {
    throw new PartnerSourceError('response_invalid');
  }
  const next = payload.next_cursor;
  if (next !== null && !(typeof next === 'string' && next.length > 0)
    && !(typeof next === 'number' && Number.isInteger(next))) {
    throw new PartnerSourceError('pagination_invalid');
  }
  return {
    data: payload.data,
    nextCursor: next as string | number | null,
    serverTime: payload.server_time,
  };
}

function normalizeItems(
  rows: unknown[],
  deliveryDate: string,
  itemRefs: Set<string> = new Set<string>(),
): PartnerItem[] {
  return rows.map((raw) => {
    if (!isRecord(raw)) throw new PartnerSourceError('response_invalid');
    const itemRef = nonEmptyString(raw.item_ref);
    const mealId = sourceId(raw.meal_id);
    const quantity = positiveQuantity(raw.qty);
    if (!itemRef || !mealId || quantity === null || raw.delivery_date !== deliveryDate
      || itemRefs.has(itemRef) || !Array.isArray(raw.sections)) {
      throw new PartnerSourceError('response_invalid');
    }
    itemRefs.add(itemRef);
    const sections = raw.sections.map(normalizeSection);
    const sectionKeys = new Set(sections.map((section) => `${section.sectionId}\u0000${section.code}`));
    if (sectionKeys.size !== sections.length) throw new PartnerSourceError('response_invalid');
    const nameEn = nonEmptyString(raw.meal_name_en);
    const nameAr = nonEmptyString(raw.meal_name_ar);
    if (!nameEn && !nameAr) throw new PartnerSourceError('response_invalid');
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

async function readJsonLimited(response: Response): Promise<{ payload: unknown; bytes: number }> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new PartnerSourceError('response_invalid');
  }
  if (!response.body) throw new PartnerSourceError('response_invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PartnerSourceError('response_invalid');
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    return { payload: JSON.parse(body) as unknown, bytes };
  } catch (error) {
    if (error instanceof PartnerSourceError) throw error;
    throw new PartnerSourceError('response_invalid');
  } finally {
    reader.releaseLock();
  }
}

function normalizeSection(raw: unknown): PartnerSection {
  if (!isRecord(raw)) throw new PartnerSourceError('response_invalid');
  const sectionId = sourceId(raw.section_id);
  const code = nonEmptyString(raw.code);
  if (!sectionId || !code || !SECTION_CODE_RE.test(code)) throw new PartnerSourceError('response_invalid');
  const stepNo = raw.step_no === null || raw.step_no === undefined
    ? null
    : typeof raw.step_no === 'number' && Number.isInteger(raw.step_no) && raw.step_no >= 0
      ? raw.step_no
      : Number.NaN;
  if (Number.isNaN(stepNo)) throw new PartnerSourceError('response_invalid');
  if (raw.is_packing !== undefined && typeof raw.is_packing !== 'boolean') {
    throw new PartnerSourceError('response_invalid');
  }
  return {
    sectionId,
    code,
    nameEn: boundedString(raw.name_en, 200),
    nameAr: boundedString(raw.name_ar, 200),
    stepNo,
    isPacking: raw.is_packing === true,
  };
}

function cloneDay(day: PartnerDay): PartnerDay {
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
    throw new PartnerSourceError('response_invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new PartnerSourceError('response_invalid');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function validateApiKey(raw: string): string {
  const key = raw.trim();
  if (!key || /[\r\n]/.test(key)) throw new PartnerSourceError('auth_failed');
  return key;
}

export function validCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function sourceId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() && value.trim().length <= 128) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() && value.trim().length <= 80) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === null || value === undefined) return null;
  throw new PartnerSourceError('response_invalid');
}

function positiveQuantity(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  const scaled = parsed * QUANTITY_SCALE;
  return Number.isFinite(parsed) && parsed > 0 && Number.isSafeInteger(scaled) ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  return boundedString(value, 200);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function secretValue(direct: string | undefined, filePath: string | undefined): string | undefined {
  if (direct?.trim() && filePath?.trim()) throw new PartnerSourceError('not_configured');
  if (filePath?.trim()) {
    try {
      const value = readFileSync(filePath.trim(), 'utf8').trim();
      return value || undefined;
    } catch {
      throw new PartnerSourceError('not_configured');
    }
  }
  return direct?.trim() || undefined;
}
