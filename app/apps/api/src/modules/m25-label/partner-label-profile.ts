import type { LabelAddressContract } from '@nutrezee/shared';

// WP-OPS-A78 — the customer part of the label, read from Partner at print time.
//
// The legacy label prints the customer's code ("User ID"), the local phone, the plan with its
// meals/snacks per day and the structured delivery address of the subscription. None of these are
// in the daily-deliveries mirror (it carries one free-text address line), so labels printed
// `Block: -, Street: -`, the phone with a country prefix and the phone again as "User ID"
// (owner's side-by-side photo, 2026-10-07). Verified on the whole day 2026-10-07 (941 deliveries):
// `daily.order_id` = `subscription_id` (941/941), its `delivery.delivery_address_id` resolves
// (941/941), `daily.customer.code` = `customers.customer_code` (941/941), and the address's
// `name` is the block (legacy "Block: 3" = name "3"), `house_no` the legacy "Building".
//
// Read-only. The key travels only in the X-Api-Key header; nothing from upstream is logged.
// Never a reason to stop printing (A70): any failure returns null and the label keeps its
// previous fields.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_BASE_URL = 'https://nutreeze.com/integration';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 200;

export interface PartnerLabelProfile {
  userId: string | null;
  phone: string | null;
  packageName: string | null;
  mealsPerDay: number | null;
  snacksPerDay: number | null;
  address: LabelAddressContract | null;
}

export interface PartnerLabelProfileGateway {
  profileForOrder(orderNumber: string, deliveryDate: string): Promise<PartnerLabelProfile | null>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface PartnerLabelProfileConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  /** Subscriptions + addresses (about 30 pages): refreshed in the background after this age. */
  referenceTtlMs?: number;
  dayTtlMs?: number;
}

interface SubscriptionRef {
  addressId: string | null;
  packageName: string | null;
  mealsPerDay: number | null;
  snacksPerDay: number | null;
}

interface Reference {
  subscriptions: Map<string, SubscriptionRef>;
  addresses: Map<string, LabelAddressContract>;
}

interface DayRow { subscriptionId: string; userId: string | null; phone: string | null; area: string | null }

interface Cached<T> { loadedAt: number; value: T }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Free text typed by people: control characters out, one line, bounded. `-` and empty mean "none". */
export function labelText(value: unknown, max = 120): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let out = '';
  for (const ch of String(value)) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return out && out !== '-' ? out : null;
}

function idText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value.trim())) return value.trim();
  return null;
}

function smallCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 50 ? value : null;
}

/** `+96598992558` / `0096598992558` / `98992558` → `98992558`: the legacy label prints the local number. */
export function localPhone(value: unknown): string | null {
  const text = labelText(value, 40);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 6) return null;
  const international = text.startsWith('+') || digits.startsWith('00');
  const trimmed = digits.replace(/^00/, '');
  // Kuwait numbers are 8 digits. `+966` here is the old import default, not a Saudi number.
  if (international && /^(965|966)\d{8}$/.test(trimmed)) return trimmed.slice(3);
  return international ? `+${trimmed}` : digits;
}

export function addressFromPartner(raw: unknown): LabelAddressContract | null {
  if (!isRecord(raw)) return null;
  return {
    area: labelText(raw.area_en) ?? labelText(raw.area_ar),
    block: labelText(raw.name),
    street: labelText(raw.street),
    building: labelText(raw.house_no),
    floor: null,
    flat: labelText(raw.flat_no),
    direction: labelText(raw.landmark),
  };
}

export class PartnerLabelProfileSource implements PartnerLabelProfileGateway {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly referenceTtlMs: number;
  private readonly dayTtlMs: number;
  private reference: Cached<Reference> | null = null;
  private referenceLoad: Promise<Reference> | null = null;
  private readonly days = new Map<string, Cached<Map<string, DayRow>>>();
  private readonly dayLoads = new Map<string, Promise<Map<string, DayRow>>>();

  constructor(config: PartnerLabelProfileConfig) {
    const url = new URL(config.baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (url.protocol !== 'https:' || url.hostname !== 'nutreeze.com' || url.port
      || path !== '/integration' || url.username || url.password || url.search || url.hash) {
      throw new Error('partner_label_profile_base_url');
    }
    this.base = `${url.origin}${path}`;
    const key = config.apiKey.trim();
    if (!key || key.length > 4096 || /\s/.test(key)) throw new Error('partner_label_profile_key');
    this.apiKey = key;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.referenceTtlMs = config.referenceTtlMs ?? 20 * 60_000;
    this.dayTtlMs = config.dayTtlMs ?? 5 * 60_000;
  }

  /** Same Partner key as the meal source; without it the label keeps its previous fields. */
  static fromEnv(): PartnerLabelProfileSource | null {
    const apiKey = process.env.NUTREEZE_PARTNER_LABEL_API_KEY?.trim();
    if (!apiKey) return null;
    try {
      const source = new PartnerLabelProfileSource({
        baseUrl: process.env.NUTREEZE_PARTNER_LABEL_API_BASE?.trim() || DEFAULT_BASE_URL, apiKey,
      });
      // Warm the large lists once so the first print preview does not wait for them.
      void source.loadReference().catch(() => undefined);
      return source;
    } catch {
      return null;
    }
  }

  async profileForOrder(orderNumber: string, deliveryDate: string): Promise<PartnerLabelProfile | null> {
    const number = orderNumber.trim();
    if (!number || !DATE_RE.test(deliveryDate)) return null;
    try {
      const day = (await this.day(deliveryDate)).get(number);
      if (!day) return null;
      const reference = await this.currentReference().catch(() => null);
      const subscription = reference?.subscriptions.get(day.subscriptionId) ?? null;
      const stored = subscription?.addressId ? reference?.addresses.get(subscription.addressId) ?? null : null;
      return {
        userId: day.userId,
        phone: day.phone,
        packageName: subscription?.packageName ?? null,
        mealsPerDay: subscription?.mealsPerDay ?? null,
        snacksPerDay: subscription?.snacksPerDay ?? null,
        // The area of the day is the one the driver was assigned by; the rest is the stored address.
        address: stored ? { ...stored, area: day.area ?? stored.area } : null,
      };
    } catch {
      return null;
    }
  }

  /** A fresh copy when possible; an older copy rather than nothing while Partner is slow or down. */
  private async currentReference(): Promise<Reference> {
    const cached = this.reference;
    if (!cached) return this.loadReference();
    if (this.now() - cached.loadedAt > this.referenceTtlMs) void this.loadReference().catch(() => undefined);
    return cached.value;
  }

  private loadReference(): Promise<Reference> {
    if (this.referenceLoad) return this.referenceLoad;
    const load = (async () => {
      const [subscriptionRows, addressRows] = await Promise.all([
        this.fetchAll('subscriptions', {}), this.fetchAll('customer-addresses', {}),
      ]);
      const subscriptions = new Map<string, SubscriptionRef>();
      for (const raw of subscriptionRows) {
        if (!isRecord(raw) || raw.deleted === true) continue;
        const id = idText(raw.subscription_id);
        if (!id) continue;
        const pack = isRecord(raw.package) ? raw.package : {};
        const delivery = isRecord(raw.delivery) ? raw.delivery : {};
        subscriptions.set(id, {
          addressId: idText(delivery.delivery_address_id),
          // The legacy label prints the Arabic plan name.
          packageName: labelText(pack.name_ar) ?? labelText(pack.name_en),
          mealsPerDay: smallCount(pack.meals_per_day),
          snacksPerDay: smallCount(pack.snacks_per_day),
        });
      }
      const addresses = new Map<string, LabelAddressContract>();
      for (const raw of addressRows) {
        if (!isRecord(raw) || raw.deleted === true) continue;
        const id = idText(raw.address_id);
        const address = addressFromPartner(raw);
        if (id && address) addresses.set(id, address);
      }
      // An empty answer is a Partner fault, never "nobody has an address": keep the previous copy.
      if (subscriptions.size === 0 || addresses.size === 0) throw new Error('partner_label_profile_empty');
      const value = { subscriptions, addresses };
      this.reference = { loadedAt: this.now(), value };
      return value;
    })().finally(() => { this.referenceLoad = null; });
    this.referenceLoad = load;
    return load;
  }

  private async day(deliveryDate: string): Promise<Map<string, DayRow>> {
    const cached = this.days.get(deliveryDate);
    if (cached && this.now() - cached.loadedAt <= this.dayTtlMs) return cached.value;
    const active = this.dayLoads.get(deliveryDate);
    if (active) return cached ? cached.value : active;
    const load = (async () => {
      const rows = new Map<string, DayRow>();
      const newest = new Map<string, number>();
      for (const raw of await this.fetchAll('daily-deliveries', { delivery_date: deliveryDate })) {
        if (!isRecord(raw)) continue;
        const number = labelText(raw.order_number, 255);
        const subscriptionId = idText(raw.order_id);
        if (!number || !subscriptionId) continue;
        const updated = typeof raw.updated_at === 'string' ? new Date(raw.updated_at).getTime() || 0 : 0;
        if (rows.has(number) && updated < (newest.get(number) ?? 0)) continue;
        const customer = isRecord(raw.customer) ? raw.customer : {};
        const address = isRecord(raw.address) ? raw.address : {};
        newest.set(number, updated);
        rows.set(number, {
          subscriptionId,
          userId: labelText(customer.code, 40),
          phone: localPhone(customer.phone),
          area: labelText(address.area_en) ?? labelText(address.area_ar),
        });
      }
      if (this.days.size > 40) this.days.clear();
      this.days.set(deliveryDate, { loadedAt: this.now(), value: rows });
      return rows;
    })().finally(() => { this.dayLoads.delete(deliveryDate); });
    this.dayLoads.set(deliveryDate, load);
    if (cached) { void load.catch(() => undefined); return cached.value; }
    return load;
  }

  private async fetchAll(endpoint: string, query: Record<string, string>): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | number | null = null;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(`${this.base}/${endpoint}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let payload: unknown;
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET', headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
          redirect: 'error', signal: controller.signal,
        });
        if (!response.ok) throw new Error('partner_label_profile_http');
        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }
      if (!isRecord(payload) || !Array.isArray(payload.data) || payload.mode !== 'live') {
        throw new Error('partner_label_profile_envelope');
      }
      rows.push(...payload.data);
      const next = payload.next_cursor;
      if (next === null || next === undefined) return rows;
      if ((typeof next !== 'string' && typeof next !== 'number') || payload.data.length === 0 || seen.has(String(next))) {
        throw new Error('partner_label_profile_pagination');
      }
      seen.add(String(next));
      cursor = next;
    }
    throw new Error('partner_label_profile_pagination');
  }
}
