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

/** Empty counts object with every required key (so a 0 is always reported, never absent). */
export function emptyCounts() {
  return {
    records_seen: 0, records_candidate: 0, would_archive: 0, would_import_clean: 0,
    would_skip_duplicate: 0, would_exception: 0, missing_customer_link: 0,
    missing_order_link: 0, invalid_date: 0, duplicate_hash: 0,
  };
}
