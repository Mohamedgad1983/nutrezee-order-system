// m23 dish-per-day — pure parser helpers (no I/O, no DB), unit-testable in isolation.
// The legacy source is the SAME grid HTML m22 already captured
// (`/orders/getMealsDateWiseFilter/all/<internal_id>`). The ACTUAL assigned dish per day lives in the
// `selected` <option> of each `<select id="meal_select_<order_meal_id>">`, bound to a date via the
// sibling `<input id="datepciker_<order_meal_id>" value="YYYY-MM-DD">` (and the getMeals(...) onchange
// literal as a fallback). Components (carb/protein/eggs) are sibling selects. Macros are ajax-loaded
// (not in the static grid). UNKNOWN signals are preserved in `extra` — never dropped.
import crypto from 'node:crypto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical sha256 (hex) of a string/Buffer — the raw-archive dedup key. */
export function dishSha(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Validate YYYY-MM-DD; return it or null. */
export function normalizeDate(s) {
  if (!s || typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) ? s : null;
}

/** Light HTML entity decode + whitespace collapse for dish names. */
export function cleanText(s) {
  if (s == null) return null;
  const t = String(s)
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
}

/** Normalize a dish name for matching/dedup (lowercase, strip punctuation/extra spaces). */
export function normalizeDishName(s) {
  const t = cleanText(s);
  if (!t) return null;
  return t.toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

// --- attribute helpers (robust to attribute order) ---
function attr(tagAttrs, name) {
  const m = tagAttrs.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1] : null;
}
function hasFlag(tagAttrs, name) {
  return new RegExp('(^|\\s)' + name + '(\\s|=|$)', 'i').test(tagAttrs);
}

/**
 * Find the `selected` <option> inside a <select> inner HTML.
 * Returns { value, text } or null. Robust to `selected`, `selected="selected"`, attribute order.
 */
export function selectedOption(selectInner) {
  const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = optRe.exec(selectInner))) {
    const attrs = m[1] || '';
    if (hasFlag(attrs, 'selected')) {
      const value = attr(attrs, 'value');
      const text = cleanText(m[2]);
      // a real assigned dish has a non-empty, non-zero value; "" / "0" are placeholders → skip
      if (value !== null && value !== '' && value !== '0' && text) return { value, text };
    }
  }
  return null;
}

/** Map every `<select id="<prefix>_<omid>">` to its selected option. */
function selectsByPrefix(html, prefix) {
  const out = new Map(); // omid -> {value,text}
  const re = new RegExp('<select\\b[^>]*\\bid="' + prefix + '_(\\d+)"[^>]*>([\\s\\S]*?)<\\/select>', 'gi');
  let m;
  while ((m = re.exec(html))) {
    const omid = m[1];
    const sel = selectedOption(m[2]);
    if (sel) out.set(omid, sel);
    else if (!out.has(omid)) out.set(omid, null); // slot present but nothing selected
  }
  return out;
}

/** order_meal_id -> meal_date from datepciker inputs (primary) + getMeals(...) literals (fallback). */
function dateMap(html) {
  const out = new Map();
  // primary: <input id="datepciker_<omid>" ... value="YYYY-MM-DD">  (value may precede or follow id)
  const inpRe = /<input\b([^>]*\bid="datepciker_(\d+)"[^>]*)>/gi;
  let m;
  while ((m = inpRe.exec(html))) {
    const omid = m[2];
    const d = normalizeDate(attr(m[1], 'value'));
    if (d) out.set(omid, d);
  }
  // fallback: getMeals($(this), 'YYYY-MM-DD', <omid>, ...)
  const gmRe = /getMeals\([^,]*,\s*'(\d{4}-\d{2}-\d{2})'\s*,\s*(\d+)/gi;
  while ((m = gmRe.exec(html))) {
    const d = normalizeDate(m[1]); const omid = m[2];
    if (d && !out.has(omid)) out.set(omid, d);
  }
  return out;
}

const COMPONENT_PREFIXES = ['protein', 'prot', 'carb', 'raw_eggs', 'white_eggs', 'snack', 'salad'];

/**
 * Parse a legacy meal-grid HTML into dish-per-day slots. Pure.
 * @returns {{
 *   internal_id, order_number, slots: Array, dates: string[],
 *   warnings: string[], counts: {slots,dishes,dates,components,no_date,no_dish,unknown_fields}
 * }}
 * Each slot: { order_meal_id, meal_date, meal_slot, dish:{meal_id,name}|null, components:[...], extra:{} }
 */
export function parseDishGrid(html, { internal_id = null, order_number = null } = {}) {
  const text = String(html || '');
  const warnings = [];
  const dm = dateMap(text);
  const meals = selectsByPrefix(text, 'meal_select');
  const components = {};
  for (const p of COMPONENT_PREFIXES) components[p] = selectsByPrefix(text, p);

  // meal_type per slot: a <select id="meal_type_<omid>"> selected option (best-effort)
  const mealTypes = selectsByPrefix(text, 'meal_type');

  const allOmids = new Set([...meals.keys(), ...dm.keys()]);
  const slots = [];
  const counts = { slots: 0, dishes: 0, dates: 0, components: 0, no_date: 0, no_dish: 0, unknown_fields: 0 };

  for (const omid of allOmids) {
    const meal_date = dm.get(omid) || null;
    const dish = meals.get(omid) || null;
    const slotType = mealTypes.get(omid) || null;
    const comp = [];
    for (const p of COMPONENT_PREFIXES) {
      const c = components[p].get(omid);
      if (c && c.value) comp.push({ meal_component_type: p, legacy_meal_id: c.value, dish_name: c.text });
    }
    const extra = {};
    if (!meal_date) { counts.no_date += 1; warnings.push(`no_date:omid=${omid}`); }
    if (!dish || !dish.value) { counts.no_dish += 1; }

    counts.slots += 1;
    if (dish && dish.value) counts.dishes += 1;
    if (meal_date) counts.dates += 1;
    counts.components += comp.length;

    slots.push({
      order_meal_id: omid,
      meal_date,
      meal_slot: slotType ? slotType.value : null,
      meal_slot_label: slotType ? slotType.text : null,
      dish: dish && dish.value ? { meal_id: dish.value, name: dish.text } : null,
      components: comp,
      extra,
    });
  }

  const dates = [...new Set(slots.map((s) => s.meal_date).filter(Boolean))].sort();
  return { internal_id, order_number, slots, dates, warnings, counts };
}
