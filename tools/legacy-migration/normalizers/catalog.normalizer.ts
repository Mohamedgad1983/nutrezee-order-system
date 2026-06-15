// Catalog + ops-master normalizers. Products/packages → M19 import rows
// ({kind, name, name_ar, price, parent_name}); ops masters (area/slot/method) → the
// /settings/masters/:kind shape. Catalog stays import-only under mirror mode.

import type { NormalizedRecord, RawRow } from '../lib/types.ts';
import { pick, splitName, toFils, toInt } from '../lib/normalize-util.ts';

export function normalizeProducts(raw: RawRow[]): NormalizedRecord[] {
  return raw.map((r): NormalizedRecord => {
    const name = splitName(pick(r, 'name', 'product_name', 'title'));
    const notes: string[] = [];
    if (!pick(r, 'price')) notes.push('no price on legacy product → null (enrich after import)');
    return {
      legacy_id: pick(r, 'id', 'product_id'),
      data: { kind: 'product', name: name.en ?? pick(r, 'name'), name_ar: name.ar, price_fils: toFils(pick(r, 'price')), origin: 'legacy' },
      confidence: name.en || name.ar ? 'INFERRED' : 'NEEDS_MANUAL_REVIEW',
      notes,
    };
  });
}

export function normalizePackages(raw: RawRow[]): NormalizedRecord[] {
  return raw.map((r): NormalizedRecord => {
    const name = splitName(pick(r, 'name', 'package_name', 'title'));
    return {
      legacy_id: pick(r, 'id', 'package_id'),
      data: {
        kind: 'package', name: name.en ?? pick(r, 'name'), name_ar: name.ar,
        price_fils: toFils(pick(r, 'price')),
        duration_days: toInt(pick(r, 'duration', 'duration_days', 'days')),
        meals_per_day: toInt(pick(r, 'meals_per_day', 'meals')),
        parent_name: pick(r, 'parent', 'parent_package'),
        origin: 'legacy',
      },
      confidence: name.en || name.ar ? 'INFERRED' : 'NEEDS_MANUAL_REVIEW',
      notes: [],
    };
  });
}

/** Generic ops-master normalizer (area / delivery_slot / delivery_method). */
export function normalizeMaster(masterKind: string) {
  return (raw: RawRow[]): NormalizedRecord[] => raw.map((r): NormalizedRecord => {
    const name = splitName(pick(r, 'name', 'title', 'label'));
    return {
      legacy_id: pick(r, 'id'),
      data: { master: masterKind, code: pick(r, 'code'), name_en: name.en ?? pick(r, 'name'), name_ar: name.ar, origin: 'legacy' },
      confidence: name.en || name.ar ? 'INFERRED' : 'NEEDS_MANUAL_REVIEW',
      notes: [`ops master "${masterKind}" → /settings/masters/${masterKind} at import`],
    };
  });
}

/** Fallback normalizer for entities with no firm mapping yet (payment methods, coupons). */
export function normalizePassthrough(label: string) {
  return (raw: RawRow[]): NormalizedRecord[] => raw.map((r): NormalizedRecord => ({
    legacy_id: pick(r, 'id'),
    data: { ...r, origin: 'legacy' },
    confidence: 'NEEDS_MANUAL_REVIEW',
    notes: [`${label}: no firm new-system mapping yet — captured raw for manual review`],
  }));
}
