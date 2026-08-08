import { describe, expect, it } from 'vitest';
import { aggregateDay, TotalsError } from '../src/api/totals.js';
import type { PartnerDay, PartnerSection } from '../src/api/partner-source.js';

const DATE = '2026-08-08';

function route(id: string, code: string, stepNo: number, isPacking = false): PartnerSection {
  return { sectionId: id, code, nameEn: `${code} EN`, nameAr: `${code} AR`, stepNo, isPacking };
}

function row(
  itemRef: string,
  quantity: number,
  sections: PartnerSection[],
  portionSize: string | null = 'regular',
) {
  return {
    itemRef,
    mealId: 'meal-1',
    nameEn: 'Meal one',
    nameAr: 'وجبة واحد',
    portionSize,
    quantity,
    sections,
  };
}

describe('totals-only section projection', () => {
  it('groups exact meal and portion totals and counts every multi-section assignment', () => {
    const hot = route('hot-id', 'hot', 1);
    const packing = route('pack-id', 'packing', 9, true);
    const day: PartnerDay = {
      serverTime: '2026-08-08T10:00:00+03:00',
      items: [
        row('one', 2, [hot, packing], 'large'),
        row('two', 3, [hot], 'large'),
        row('three', 4, [hot], 'small'),
      ],
    };
    const totals = aggregateDay(day, DATE, 'main', '2026-08-08T07:01:00.000Z', ['hot', 'packing']);
    expect(totals.summary).toEqual({
      assigned_section_count: 2,
      assigned_quantity_total: 11,
      unrouted_quantity_total: 0,
    });
    expect(totals.sections.map((entry) => [entry.code, entry.total_qty])).toEqual([
      ['hot', 9], ['packing', 2],
    ]);
    expect(totals.sections[0]?.meals.map((meal) => [meal.portion_size, meal.total_qty])).toEqual([
      ['large', 5], ['small', 4],
    ]);
  });

  it('keeps missing routing visible and emits no physical/order/customer identifiers', () => {
    const day: PartnerDay = {
      serverTime: '2026-08-08T10:00:00+03:00',
      items: [row('SENSITIVE-ITEM', 3, [])],
    };
    const totals = aggregateDay(day, DATE, 'main', '2026-08-08T07:01:00.000Z', ['unrouted']);
    expect(totals.sections).toMatchObject([{ code: 'unrouted', unrouted: true, total_qty: 3 }]);
    expect(totals.summary.unrouted_quantity_total).toBe(3);
    const serialized = JSON.stringify(totals);
    expect(serialized).not.toContain('SENSITIVE-ITEM');
    expect(serialized).not.toContain('item_ref');
    expect(serialized).not.toContain('order_number');
    expect(serialized).not.toContain('customer');
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('address');
  });

  it('returns only the authenticated user assignment and no global quantity metadata', () => {
    const hot = route('hot-id', 'hot', 1);
    const packing = route('pack-id', 'packing', 9, true);
    const totals = aggregateDay({
      serverTime: '2026-08-08T10:00:00+03:00',
      items: [row('one', 3, [hot]), row('two', 7, [packing])],
    }, DATE, 'main', '2026-08-08T07:01:00.000Z', ['hot']);
    expect(totals.sections).toMatchObject([{ code: 'hot', total_qty: 3 }]);
    expect(totals.summary).toEqual({
      assigned_section_count: 1,
      assigned_quantity_total: 3,
      unrouted_quantity_total: 0,
    });
    const serialized = JSON.stringify(totals);
    expect(serialized).not.toContain('"code":"packing"');
    expect(serialized).not.toContain('source_quantity_total');
    expect(serialized).not.toContain('source_item_rows');
  });

  it('fails closed on contradictory section or meal metadata', () => {
    const hot = route('hot-id', 'hot', 1);
    const changed = { ...hot, stepNo: 2 };
    expect(() => aggregateDay({
      serverTime: new Date().toISOString(),
      items: [row('one', 1, [hot]), row('two', 1, [changed])],
    }, DATE, 'main', new Date().toISOString(), ['hot'])).toThrowError(TotalsError);

    expect(() => aggregateDay({
      serverTime: new Date().toISOString(),
      items: [row('one', 1, [hot]), { ...row('two', 1, [hot]), nameEn: 'Different name' }],
    }, DATE, 'main', new Date().toISOString(), ['hot'])).toThrowError(
      expect.objectContaining({ code: 'response_invalid' }),
    );
  });

  it('fails closed when section identity or meal names conflict across different sections', () => {
    const hot = route('same-id', 'hot', 1);
    const changedCode = route('same-id', 'renamed-hot', 2);
    expect(() => aggregateDay({
      serverTime: new Date().toISOString(),
      items: [row('one', 1, [hot]), row('two', 1, [changedCode])],
    }, DATE, 'main', new Date().toISOString(), ['hot', 'renamed-hot'])).toThrowError(
      expect.objectContaining({ code: 'response_invalid' }),
    );

    const cold = route('cold-id', 'cold', 2);
    expect(() => aggregateDay({
      serverTime: new Date().toISOString(),
      items: [row('one', 1, [hot]), { ...row('two', 1, [cold]), nameAr: 'اسم متناقض' }],
    }, DATE, 'main', new Date().toISOString(), ['hot', 'cold'])).toThrowError(
      expect.objectContaining({ code: 'response_invalid' }),
    );
  });

  it('preserves safe fractional quantities without floating-point drift', () => {
    const hot = route('hot-id', 'hot', 1);
    const totals = aggregateDay({
      serverTime: new Date().toISOString(),
      items: [row('one', 0.1, [hot]), row('two', 0.2, [hot])],
    }, DATE, 'main', new Date().toISOString(), ['hot']);
    expect(totals.sections[0]?.total_qty).toBe(0.3);
  });

  it('keeps six-decimal scaled totals internally consistent', () => {
    const hot = route('hot-id', 'hot', 1);
    const totals = aggregateDay({
      serverTime: new Date().toISOString(),
      items: [row('one', 0.000001, [hot]), row('two', 0.000002, [hot])],
    }, DATE, 'main', new Date().toISOString(), ['hot']);
    expect(totals.summary.assigned_quantity_total).toBe(0.000003);
    expect(totals.sections[0]?.total_qty).toBe(0.000003);
    expect(totals.sections[0]?.meals[0]?.total_qty).toBe(0.000003);
  });
});
