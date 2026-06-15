import { describe, it, expect } from 'vitest';
import { diff } from '../comparators/compare-util.ts';
import type { NormalizedRecord } from '../lib/types.ts';

const legacy = (name: string, conf: NormalizedRecord['confidence'] = 'VERIFIED'): NormalizedRecord => ({
  legacy_id: name, data: { name, origin: 'legacy' }, confidence: conf, notes: [],
});

describe('diff (comparison core)', () => {
  it('counts matched / only-legacy / only-new by key', () => {
    const r = diff({
      entity: 'products',
      legacy: [legacy('Kabsa'), legacy('Salad'), legacy('OnlyLegacy')],
      legacyKey: (x) => x.data.name as string,
      newRecords: [{ nameEn: 'Kabsa' }, { nameEn: 'Salad' }, { nameEn: 'OnlyNew' }],
      newKey: (x) => x.nameEn as string,
      requiredNewFields: ['name'],
    });
    expect(r.legacy_count).toBe(3);
    expect(r.new_count).toBe(3);
    expect(r.matched).toBe(2);
    expect(r.only_in_legacy).toBe(1);
    expect(r.only_in_new).toBe(1);
  });

  it('is case-insensitive on the key', () => {
    const r = diff({
      entity: 'products', legacy: [legacy('KABSA')],
      legacyKey: (x) => x.data.name as string,
      newRecords: [{ nameEn: 'kabsa' }], newKey: (x) => x.nameEn as string,
    });
    expect(r.matched).toBe(1);
  });

  it('surfaces NEEDS_MANUAL_REVIEW + empty-legacy blockers', () => {
    const empty = diff({ entity: 'customers', legacy: [], legacyKey: () => null, newRecords: [], newKey: () => null });
    expect(empty.blockers.join(' ')).toMatch(/no legacy rows/);

    const review = diff({
      entity: 'customers', legacy: [legacy('X', 'NEEDS_MANUAL_REVIEW')],
      legacyKey: (x) => x.data.name as string, newRecords: [], newKey: () => null,
    });
    expect(review.blockers.join(' ')).toMatch(/NEEDS_MANUAL_REVIEW/);
  });

  it('reports new-required fields legacy never exposes', () => {
    const r = diff({
      entity: 'customers',
      legacy: [{ legacy_id: '1', data: { full_name_en: 'A' }, confidence: 'VERIFIED', notes: [] }],
      legacyKey: (x) => x.data.full_name_en as string,
      newRecords: [], newKey: () => null,
      requiredNewFields: ['full_name_en', 'phone'],
    });
    expect(r.missing_required_new_fields).toContain('phone');
    expect(r.missing_required_new_fields).not.toContain('full_name_en');
  });
});
