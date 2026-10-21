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
  /** The day's note typed in legacy for this delivery (`driver_instructions`). */
  notes: string | null;
  /** A78.3: the time slot and handover instruction of this delivery day (they can differ from the order's first day). */
  deliveryTime: string | null;
  deliveryMethod: string | null;
  /** A90: delivery days still ahead from this delivery date; null when Partner has no end date. */
  daysRemaining: number | null;
  /** A92: how many delivery rows legacy holds for this order on this day (2+ is a doubled row). */
  deliveryRows: number;
  /** A98: a Thursday double box — two boxes, one sticker each; meal lines per box in delivery order. */
  doubleBox: boolean;
  boxItemCounts: number[];
}

export interface PartnerLabelProfileGateway {
  profileForOrder(orderNumber: string, deliveryDate: string): Promise<PartnerLabelProfile | null>;
  /** A79: only the day's time slot (one day read, no large lists) — for the Batch Labels filter. */
  deliveryTimeForOrder?(orderNumber: string, deliveryDate: string): Promise<string | null>;
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
  /** Freeze records (about 50 pages): read in full after this age, only the changed ones in between. */
  freezeFullTtlMs?: number;
}

interface SubscriptionRef {
  addressId: string | null;
  packageName: string | null;
  mealsPerDay: number | null;
  snacksPerDay: number | null;
  endDate: string | null;
  offWeekdays: number[];
  /** A98: Friday's box goes out on Thursday next to Thursday's own (legacy "Thursday Double Box"). */
  doubleBox: boolean;
}

interface Reference {
  subscriptions: Map<string, SubscriptionRef>;
  addresses: Map<string, LabelAddressContract>;
}

interface DayRow {
  subscriptionId: string; userId: string | null; phone: string | null; area: string | null; notes: string | null;
  deliveryTime: string | null; deliveryMethod: string | null;
  deliveryRows: number;
  boxItemCounts: number[];
}

interface Cached<T> { loadedAt: number; value: T }

/** Freeze records by change id; `date` is null once the freeze was reverted or deleted. */
interface FreezeBook {
  changes: Map<string, { subscriptionId: string; date: string | null }>;
  bySubscription: Map<string, Set<string>>;
  fullLoadedAt: number;
}

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

/**
 * A90 — delivery days the customer still receives, counted from the delivery date to the current
 * end date: weekdays that are not the subscription's off days, minus the freezes that are still
 * ahead. The end date already carries the past freezes, so subtracting every frozen day (the legacy
 * admin's figure, A80) understates it: order 27902 on 2026-10-11 printed 10 with 21 boxes left
 * (55 bought, 34 delivered). Owner's decision 2026-10-11: print the real count.
 */
export function daysRemaining(
  deliveryDate: string,
  subscription: { endDate: string | null; offWeekdays: number[]; doubleBox?: boolean },
  upcomingFreezes: ReadonlySet<string> = new Set(),
): number | null {
  // A98: a double-box customer still receives Friday's meals (on Thursday), as the legacy count shows.
  const offWeekdays = subscription.doubleBox ? subscription.offWeekdays.filter((d) => d !== 5) : subscription.offWeekdays;
  if (!subscription.endDate || !DATE_RE.test(deliveryDate)) return null;
  const end = Date.parse(`${subscription.endDate}T00:00:00Z`);
  let cursor = Date.parse(`${deliveryDate}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(cursor) || end - cursor > 3660 * 86_400_000) return null;
  let days = 0;
  for (; cursor <= end; cursor += 86_400_000) {
    const date = new Date(cursor);
    if (offWeekdays.includes(date.getUTCDay())) continue;
    if (!upcomingFreezes.has(date.toISOString().slice(0, 10))) days += 1;
  }
  return days;
}

/**
 * A91 (owner, 2026-10-11): a note that starts the pickup wording for Qurain means the customer
 * collects the box from the central kitchen — the label must not name a driver. Other branches
 * ("pick up from jahra branch") are still carried by a driver and are left alone.
 */
export function isKitchenPickup(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\bpick\s*-?\s*up\s+(from\s+)?(al[\s-]*)?qurain\b/i.test(notes)
    || /استلام\s+(من\s+)?(فرع\s+)?القرين/.test(notes);
}

/**
 * A92 — legacy sometimes holds the same delivery twice for one order and day (order 30781 on
 * 2026-10-12: two delivery rows, the six meal lines listed twice); its own label prints the meals
 * once. Only when Partner shows that many delivery rows AND the lines are that many exact copies
 * is one copy kept — a customer who really ordered a dish twice keeps both lines.
 */
export function mealsOfOneDelivery<T extends { dish_name: string; qty: number | null }>(meals: T[], deliveryRows: number): T[] {
  if (!Number.isInteger(deliveryRows) || deliveryRows < 2 || meals.length === 0 || meals.length % deliveryRows !== 0) return meals;
  const size = meals.length / deliveryRows;
  for (let index = size; index < meals.length; index += 1) {
    const first = meals[index % size];
    const copy = meals[index];
    if (!first || !copy || copy.dish_name !== first.dish_name || copy.qty !== first.qty) return meals;
  }
  return meals.slice(0, size);
}

function itemCountsInOrder(byDelivery: Map<string, number>): number[] {
  return [...byDelivery.entries()]
    .sort((a, b) => (Number(a[0]) - Number(b[0])) || a[0].localeCompare(b[0]))
    .map(([, count]) => count);
}

/**
 * A98 — the meal lines of a Thursday double box, one list per box, in delivery order (legacy prints
 * "BOX 1 OF 2" and "BOX 2 OF 2"). Partner lists the order's lines in delivery order and gives each
 * delivery's line count; null when they do not add up, so the label keeps one sticker.
 */
export function mealsPerBox<T>(meals: T[], boxItemCounts: number[]): T[][] | null {
  if (boxItemCounts.length < 2 || boxItemCounts.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  if (boxItemCounts.reduce((a, b) => a + b, 0) !== meals.length) return null;
  const boxes: T[][] = [];
  let at = 0;
  for (const n of boxItemCounts) { boxes.push(meals.slice(at, at + n)); at += n; }
  return boxes;
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
  private readonly freezeFullTtlMs: number;
  private freezes: Cached<FreezeBook> | null = null;
  private freezeLoad: Promise<FreezeBook> | null = null;
  private freezeFailedAt: number | null = null;
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
    this.freezeFullTtlMs = config.freezeFullTtlMs ?? 24 * 3_600_000;
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
      void source.loadFreezes().catch(() => undefined);
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
      const freezes = subscription ? await this.currentFreezes().catch(() => null) : null;
      const stored = subscription?.addressId ? reference?.addresses.get(subscription.addressId) ?? null : null;
      return {
        userId: day.userId,
        phone: day.phone,
        packageName: subscription?.packageName ?? null,
        mealsPerDay: subscription?.mealsPerDay ?? null,
        snacksPerDay: subscription?.snacksPerDay ?? null,
        // The area of the day is the one the driver was assigned by; the rest is the stored address.
        address: stored ? { ...stored, area: day.area ?? stored.area } : null,
        notes: day.notes,
        deliveryTime: day.deliveryTime,
        deliveryMethod: day.deliveryMethod,
        deliveryRows: day.deliveryRows,
        doubleBox: !!subscription?.doubleBox && day.deliveryRows >= 2,
        boxItemCounts: day.boxItemCounts,
        daysRemaining: subscription
          ? daysRemaining(deliveryDate, subscription, freezes?.bySubscription.get(day.subscriptionId)) : null,
      };
    } catch {
      return null;
    }
  }

  async deliveryTimeForOrder(orderNumber: string, deliveryDate: string): Promise<string | null> {
    const number = orderNumber.trim();
    if (!number || !DATE_RE.test(deliveryDate)) return null;
    try {
      return (await this.day(deliveryDate)).get(number)?.deliveryTime ?? null;
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
          endDate: typeof raw.end_date === 'string' && DATE_RE.test(raw.end_date) ? raw.end_date : null,
          offWeekdays: Array.isArray(delivery.off_weekdays)
            ? delivery.off_weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6) : [],
          doubleBox: delivery.thursday_double_box === true,
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

  /** Same rule as the reference lists: an older copy rather than waiting; printing never waits twice. */
  private async currentFreezes(): Promise<FreezeBook> {
    const cached = this.freezes;
    if (!cached) {
      // A batch asks once per label: one failed read is not repeated for each of them.
      if (this.freezeFailedAt !== null && this.now() - this.freezeFailedAt < 60_000) throw new Error('partner_label_profile_freezes');
      return this.loadFreezes();
    }
    if (this.now() - cached.loadedAt > this.referenceTtlMs) void this.loadFreezes().catch(() => undefined);
    return cached.value;
  }

  private loadFreezes(): Promise<FreezeBook> {
    if (this.freezeLoad) return this.freezeLoad;
    const load = (async () => {
      const startedAt = this.now();
      const previous = this.freezes?.value ?? null;
      const full = !previous || startedAt - previous.fullLoadedAt > this.freezeFullTtlMs;
      const query: Record<string, string> = { change_type: 'freeze' };
      // Partner refreshes its copy hourly; two hours of overlap never misses a revert.
      if (!full) query.since = new Date(this.freezes!.loadedAt - 2 * 3_600_000).toISOString();
      const rows = await this.fetchAll('subscription-changes', query);
      if (full && rows.length === 0) throw new Error('partner_label_profile_empty');
      const changes = full ? new Map<string, { subscriptionId: string; date: string | null }>() : new Map(previous!.changes);
      // Freezes of days long gone can no longer change a label.
      const oldest = new Date(startedAt - 3 * 86_400_000).toISOString().slice(0, 10);
      for (const raw of rows) {
        if (!isRecord(raw) || raw.change_type !== 'freeze') continue;
        const id = idText(raw.change_id);
        const subscriptionId = idText(raw.subscription_id);
        if (!id || !subscriptionId) continue;
        const from = typeof raw.effective_from === 'string' && DATE_RE.test(raw.effective_from) ? raw.effective_from : null;
        const to = typeof raw.effective_to === 'string' && DATE_RE.test(raw.effective_to) ? raw.effective_to : from;
        const live = raw.is_reverted !== true && raw.deleted !== true && from !== null && to !== null && to >= oldest;
        changes.delete(id);
        for (let index = 1; changes.delete(`${id}#${index}`); index += 1) { /* a range read earlier */ }
        if (!live) continue;
        // One record per frozen day today; a range is still read as every day in it.
        let cursor = Date.parse(`${from}T00:00:00Z`);
        const end = Math.min(Date.parse(`${to}T00:00:00Z`), cursor + 370 * 86_400_000);
        for (let index = 0; cursor <= end; cursor += 86_400_000, index += 1) {
          const date = new Date(cursor).toISOString().slice(0, 10);
          if (date >= oldest) changes.set(index === 0 ? id : `${id}#${index}`, { subscriptionId, date });
        }
      }
      const bySubscription = new Map<string, Set<string>>();
      for (const change of changes.values()) {
        if (!change.date) continue;
        const dates = bySubscription.get(change.subscriptionId) ?? new Set<string>();
        dates.add(change.date);
        bySubscription.set(change.subscriptionId, dates);
      }
      const value = { changes, bySubscription, fullLoadedAt: full ? startedAt : previous!.fullLoadedAt };
      this.freezes = { loadedAt: startedAt, value };
      return value;
    })().then(
      (value) => { this.freezeFailedAt = null; return value; },
      (error: unknown) => { this.freezeFailedAt = this.now(); throw error; },
    ).finally(() => { this.freezeLoad = null; });
    this.freezeLoad = load;
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
      const deliveryIds = new Map<string, Map<string, number>>();
      for (const raw of await this.fetchAll('daily-deliveries', { delivery_date: deliveryDate })) {
        if (!isRecord(raw)) continue;
        const number = labelText(raw.order_number, 255);
        const subscriptionId = idText(raw.order_id);
        if (!number || !subscriptionId) continue;
        const updated = typeof raw.updated_at === 'string' ? new Date(raw.updated_at).getTime() || 0 : 0;
        const deliveryId = idText(raw.delivery_id);
        const seen = deliveryIds.get(number) ?? new Map<string, number>();
        if (deliveryId) seen.set(deliveryId, smallCount(raw.meal_item_count) ?? 0);
        deliveryIds.set(number, seen);
        if (rows.has(number) && updated < (newest.get(number) ?? 0)) {
          rows.get(number)!.deliveryRows = Math.max(1, seen.size);
          rows.get(number)!.boxItemCounts = itemCountsInOrder(seen);
          continue;
        }
        const customer = isRecord(raw.customer) ? raw.customer : {};
        const address = isRecord(raw.address) ? raw.address : {};
        newest.set(number, updated);
        rows.set(number, {
          subscriptionId,
          userId: labelText(customer.code, 40),
          phone: localPhone(customer.phone),
          area: labelText(address.area_en) ?? labelText(address.area_ar),
          notes: labelText(raw.driver_instructions, 240),
          deliveryTime: labelText(isRecord(raw.time_slot) ? raw.time_slot.title : null),
          deliveryMethod: labelText(raw.delivery_method),
          deliveryRows: Math.max(1, seen.size),
          boxItemCounts: itemCountsInOrder(seen),
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
