import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — pure ESM tools lib (no types); imported from the repo-root tools/ dir
import {
  mealSha, normalizeDate, parseMealGrid, scopeToWindow, withinWindow, classifyItem, emptyCounts,
} from '../../../tools/legacy-full-migration/meal-history-lib.mjs';

// TS-U — m22 meal-history pure parsing/mapping helpers (no DB, no I/O).

describe('TS-U meal-history lib', () => {
  it('mealSha is deterministic and content-sensitive', () => {
    expect(mealSha('abc')).toBe(mealSha('abc'));
    expect(mealSha('abc')).not.toBe(mealSha('abd'));
    expect(mealSha('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizeDate validates format and real dates', () => {
    expect(normalizeDate('2026-06-01')).toBe('2026-06-01');
    expect(normalizeDate('2026-13-01')).toBeNull();   // bad month
    expect(normalizeDate('01-06-2026')).toBeNull();   // wrong format
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });

  it('parseMealGrid extracts dates, meal types, and non-zero meal ids', () => {
    const html = `
      <script>pickDate = "2026-06-01"; pickDate1 = "2026-06-10";</script>
      <span>Breakfast</span><span>Snack</span>
      <input name="meal_id" value="0"/>
      <input name="meal_id" value="555"/>
      data:{'meal_id':777}`;
    const p = parseMealGrid(html);
    expect(p.dates).toEqual(['2026-06-01', '2026-06-10']);
    expect(p.meal_types).toEqual(['breakfast', 'snack']);
    expect(p.meal_ids.sort()).toEqual(['555', '777']);   // '0' excluded
  });

  it('scopeToWindow computes inclusive windows; full is unbounded-below', () => {
    expect(scopeToWindow('last_30_days', '2026-06-17')).toEqual({ from: '2026-05-18', to: '2026-06-17' });
    expect(scopeToWindow('last_90_days', '2026-06-17').from).toBe('2026-03-19');
    expect(scopeToWindow('full', '2026-06-17')).toEqual({ from: null, to: '2026-06-17' });
    expect(() => scopeToWindow('bogus', '2026-06-17')).toThrow();
  });

  it('withinWindow respects bounds', () => {
    const w = { from: '2026-05-18', to: '2026-06-17' };
    expect(withinWindow('2026-06-01', w)).toBe(true);
    expect(withinWindow('2026-05-01', w)).toBe(false);   // before window
    expect(withinWindow('2026-07-01', w)).toBe(false);   // after window
    expect(withinWindow('2026-06-01', { from: null, to: '2026-06-17' })).toBe(true);
  });

  it('classifyItem routes clean vs exception reasons', () => {
    expect(classifyItem({ meal_date: '2026-06-01', order_id: 'o1', customer_id: 'c1' })).toBe('clean');
    expect(classifyItem({ meal_date: 'nope', order_id: 'o1', customer_id: 'c1' })).toBe('invalid_date');
    expect(classifyItem({ meal_date: '2026-06-01', order_id: null, customer_id: 'c1' })).toBe('missing_order_link');
    expect(classifyItem({ meal_date: '2026-06-01', order_id: 'o1', customer_id: null })).toBe('missing_customer_link');
  });

  it('emptyCounts exposes every required summary key at 0', () => {
    const c = emptyCounts();
    for (const k of ['records_seen', 'records_candidate', 'would_archive', 'would_import_clean',
      'would_skip_duplicate', 'would_exception', 'missing_customer_link', 'missing_order_link',
      'invalid_date', 'duplicate_hash']) {
      expect(c[k]).toBe(0);
    }
  });
});
