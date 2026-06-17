import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — pure ESM tools lib (no types); imported from the repo-root tools/ dir
import {
  mealSha, normalizeDate, parseMealGrid, scopeToWindow, withinWindow, classifyItem, emptyCounts, planRelink,
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

  it('planRelink resolves only orders present in the sync map, deterministically', () => {
    const syncMap = new Map([['24600', { order_id: 'o-1', customer_id: 'c-1' }]]);
    const exceptions = [
      { legacy_order_id: '23000', order_number: '24600', meal_date: '2026-06-01' }, // resolvable
      { legacy_order_id: '23000', order_number: '24600', meal_date: '2026-06-02' }, // same order, 2nd day
      { legacy_order_id: '23001', order_number: '24640', meal_date: '2026-06-03' }, // unresolved (not in map)
      { legacy_order_id: '23002', order_number: null, meal_date: '2026-06-04' },     // unresolved (no order_number)
    ];
    const p = planRelink(exceptions, syncMap);
    expect(p.exceptions_seen).toBe(4);
    expect(p.orders_seen).toBe(3);
    expect(p.resolvable.map((o) => o.legacy_order_id)).toEqual(['23000']);
    expect(p.resolvable[0]!.order_id).toBe('o-1');
    expect(p.resolvable[0]!.customer_id).toBe('c-1');
    expect(p.resolvable[0]!.dates).toEqual(['2026-06-01', '2026-06-02']);
    expect(p.would_promote_items).toBe(2);
    expect(p.would_mark_resolved).toBe(2);
    expect(p.unresolved.map((o) => o.legacy_order_id).sort()).toEqual(['23001', '23002']);
    expect(p.still_missing_order_link).toBe(2);
  });

  it('planRelink with an empty sync map resolves nothing (order-sync not advanced)', () => {
    const p = planRelink(
      [{ legacy_order_id: '23000', order_number: '24640', meal_date: '2026-06-01' }],
      new Map(),
    );
    expect(p.resolvable).toHaveLength(0);
    expect(p.unresolved).toHaveLength(1);
    expect(p.still_missing_order_link).toBe(1);
    expect(p.would_promote_items).toBe(0);
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
