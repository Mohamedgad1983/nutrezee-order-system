// m22 meal-history — pure helpers (no I/O, no DB), unit-testable in isolation.
// The legacy source is the `/orders/getMealsDateWiseFilter/all/<id>` grid. Per-dish detail is
// secondary-ajax-gated, so the reliable, automation-safe signal is meal DATES + TYPES + meal_ids.
import crypto from 'node:crypto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEAL_TYPE_RE = /\b(breakfast|lunch|dinner|snack)\b/gi;

/** Canonical sha256 (hex) of a string/Buffer — the raw-archive dedup key. */
export function mealSha(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Validate a YYYY-MM-DD string; return it or null (never throws). */
export function normalizeDate(s) {
  if (!s || typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) ? s : null;
}

/**
 * Parse a legacy meal-grid HTML payload into its automation-safe skeleton:
 * the distinct meal DATES, meal TYPES, and legacy meal_ids. Dish names are NOT extracted
 * (ajax-gated) — they stay null in the clean model until a later phase.
 */
export function parseMealGrid(html) {
  const text = String(html || '');
  const dates = [...new Set((text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []))]
    .map(normalizeDate).filter(Boolean).sort();
  const mealTypes = [...new Set((text.match(MEAL_TYPE_RE) || []).map((s) => s.toLowerCase()))].sort();
  // two legacy forms: JS `'meal_id':N` and the input field `name="meal_id" value="N"`
  const mealIdRe = /meal_id["']?(?:\s*[:=]\s*|"?\s+value\s*=\s*)["']?(\d+)/gi;
  const mealIdSet = new Set();
  for (const m of text.matchAll(mealIdRe)) if (m[1] && m[1] !== '0') mealIdSet.add(m[1]);
  const mealIds = [...mealIdSet];
  return { dates, meal_types: mealTypes, meal_ids: mealIds };
}

/** scope -> [from, to] window (inclusive). `full` has from=null (unbounded). todayStr is YYYY-MM-DD. */
export function scopeToWindow(scope, todayStr) {
  const to = normalizeDate(todayStr);
  if (!to) throw new Error(`scopeToWindow: bad today '${todayStr}'`);
  const days = { last_30_days: 30, last_90_days: 90, last_year: 365, full: null }[scope];
  if (days === undefined) throw new Error(`scopeToWindow: unknown scope '${scope}'`);
  if (days === null) return { from: null, to };
  const d = new Date(to + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return { from: d.toISOString().slice(0, 10), to };
}

/** Is dateStr within [from,to]? from=null => unbounded-below. */
export function withinWindow(dateStr, window) {
  const d = normalizeDate(dateStr);
  if (!d) return false;
  if (window.to && d > window.to) return false;
  if (window.from && d < window.from) return false;
  return true;
}

/**
 * Classify one meal-day item for the clean model vs exceptions.
 * Returns 'clean' or an exception reason. Pure — links are pre-resolved by the caller.
 */
export function classifyItem({ meal_date, order_id, customer_id }) {
  if (!normalizeDate(meal_date)) return 'invalid_date';
  if (!order_id) return 'missing_order_link';
  if (!customer_id) return 'missing_customer_link';
  return 'clean';
}

/**
 * Plan a deterministic relink of missing_order_link exceptions. Pure — no I/O.
 * `exceptions`: [{ legacy_order_id, order_number, meal_date }] (open missing_order_link rows).
 * `syncMap`: Map(order_number(string) -> { order_id, customer_id }) from the CURRENT sync_record.
 * Returns the per-order resolution plan + counts. A link promotes ONLY when both order_id and
 * customer_id resolve from the exact chain — never by name/phone/guess.
 */
export function planRelink(exceptions, syncMap) {
  const byOrder = new Map();
  for (const e of exceptions) {
    const key = String(e.legacy_order_id);
    if (!byOrder.has(key)) byOrder.set(key, { legacy_order_id: key, order_number: e.order_number != null ? String(e.order_number) : null, dates: [] });
    if (e.meal_date) byOrder.get(key).dates.push(e.meal_date);
  }
  const resolvable = [];
  const unresolved = [];
  let would_promote_items = 0;
  let would_mark_resolved = 0;
  let still_missing_order_link = 0;
  for (const o of byOrder.values()) {
    const link = o.order_number ? syncMap.get(o.order_number) : null;
    if (link && link.order_id && link.customer_id) {
      resolvable.push({ ...o, order_id: link.order_id, customer_id: link.customer_id });
      would_promote_items += o.dates.length;
      would_mark_resolved += o.dates.length;
    } else {
      unresolved.push(o);
      still_missing_order_link += o.dates.length;
    }
  }
  return {
    exceptions_seen: exceptions.length, orders_seen: byOrder.size,
    resolvable, unresolved, would_promote_items, would_mark_resolved, still_missing_order_link,
  };
}

/** Empty counts object with every required key (so a 0 is always reported, never absent). */
export function emptyCounts() {
  return {
    records_seen: 0, records_candidate: 0, would_archive: 0, would_import_clean: 0,
    would_skip_duplicate: 0, would_exception: 0, missing_customer_link: 0,
    missing_order_link: 0, invalid_date: 0, duplicate_hash: 0,
  };
}
