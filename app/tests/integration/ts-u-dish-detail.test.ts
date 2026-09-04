import { describe, expect, it } from 'vitest';
// TS-U — m23 dish-detail parser unit tests. The parser is proven CORRECT here against synthetic
// fixtures that DO contain a selected dish; the real legacy grids contain no selected dish (source
// limitation, doc 01), which the parser reports as no_dish (never a crash, never a silent drop).
import {
  parseDishGrid, selectedOption, normalizeDate, cleanText, normalizeDishName, dishSha,
} from '../../../tools/legacy-full-migration/dish-detail-lib.mjs';

// A synthetic grid row WITH an assigned dish (what a real dish source would look like).
const GRID_WITH_DISH = `
<table><tr>
  <td><input type="text" id="datepciker_5001" value="2026-03-19"></td>
  <td><select id="meal_type_5001"><option value="">--</option><option value="1" selected >Lunch</option></select></td>
  <td><select id="meal_select_5001">
        <option value="">-- Select Meal --</option>
        <option value="900">Grilled Chicken</option>
        <option value="901" selected >Beef &amp; Rice Bowl</option>
      </select></td>
  <td><select id="protein_5001"><option value="">--</option><option value="50" selected >Chicken 150g</option></select></td>
  <td><select id="carb_5001"><option value="">--</option><option value="70" selected >Rice 200g</option></select></td>
</tr>
<tr>
  <td><input type="text" id="datepciker_5002" value="2026-03-20"></td>
  <td><select id="meal_select_5002">
        <option value="">-- Select Meal --</option>
        <option value="902" selected >Salmon Salad</option>
      </select></td>
</tr></table>`;

// A real-shaped grid where meal_select is the editable catalog with NO selected pick (the blocker).
const GRID_NO_SELECTED = `
<tr><td><input id="datepciker_6001" value="2026-04-01"></td>
  <td><select id="meal_select_6001">
        <option value="">-- Select Meal --</option>
        <option value="900">Grilled Chicken</option>
        <option value="901">Beef Bowl</option>
      </select></td></tr>`;

describe('TS-U dish-detail parser', () => {
  it('extracts the assigned dish, date, slot, and components when present', () => {
    const r = parseDishGrid(GRID_WITH_DISH, { internal_id: '4001', order_number: '5001' });
    expect(r.counts.slots).toBe(2);
    expect(r.counts.dishes).toBe(2);          // both days have a selected dish
    expect(r.dates).toEqual(['2026-03-19', '2026-03-20']);
    const day1 = r.slots.find((s) => s.order_meal_id === '5001');
    expect(day1.meal_date).toBe('2026-03-19');
    expect(day1.dish).toEqual({ meal_id: '901', name: 'Beef & Rice Bowl' });  // entity-decoded
    expect(day1.meal_slot_label).toBe('Lunch');
    // components (protein/carb) captured, not dropped
    const comps = day1.components.map((c) => c.meal_component_type).sort();
    expect(comps).toContain('protein');
    expect(comps).toContain('carb');
  });

  it('records a slot with NO selected dish as no_dish (never crashes, never drops)', () => {
    const r = parseDishGrid(GRID_NO_SELECTED, { internal_id: '4002' });
    expect(r.counts.slots).toBe(1);
    expect(r.counts.dishes).toBe(0);          // the real-world blocker shape
    expect(r.counts.no_dish).toBe(1);
    expect(r.slots[0].meal_date).toBe('2026-04-01');  // date still recovered
    expect(r.slots[0].dish).toBeNull();
  });

  it('binds date from a getMeals(...) literal when datepciker is absent', () => {
    const html = `<select id="meal_select_7001"><option value="12" selected >X</option></select>
      <select id="mt_7001" onchange="getMeals($(this), '2026-05-05', 7001, 3, 99 )"></select>`;
    const r = parseDishGrid(html);
    expect(r.slots[0].meal_date).toBe('2026-05-05');
    expect(r.slots[0].dish.meal_id).toBe('12');
  });

  it('selectedOption skips placeholders (value "" / "0")', () => {
    expect(selectedOption('<option value="" selected >-- Select --</option><option value="5">Real</option>')).toBeNull();
    expect(selectedOption('<option value="0" selected >-- none --</option>')).toBeNull();
    expect(selectedOption('<option value="7" selected >Dish</option>')).toEqual({ value: '7', text: 'Dish' });
  });

  it('handles empty / malformed input gracefully', () => {
    expect(parseDishGrid('').counts.slots).toBe(0);
    expect(parseDishGrid('<html><body>no meals</body></html>').counts.slots).toBe(0);
    expect(() => parseDishGrid('<select id="meal_select_1"><option value="2" selected >')).not.toThrow();
  });

  it('helpers: normalizeDate, cleanText, normalizeDishName, dishSha', () => {
    expect(normalizeDate('2026-03-19')).toBe('2026-03-19');
    expect(normalizeDate('2026-13-40')).toBeNull();
    expect(cleanText('  Beef &amp; Rice  ')).toBe('Beef & Rice');
    expect(normalizeDishName('Beef & Rice Bowl!!')).toBe('beef rice bowl');
    expect(dishSha('x')).toHaveLength(64);
  });
});
