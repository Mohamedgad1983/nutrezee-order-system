// Pure comparison core (NO network) — unit-tested. Given normalized legacy rows + the
// new-system rows (already fetched), compute matched / only-in-legacy / only-in-new,
// sample field diffs, missing-required-new-fields and migration blockers.

import type { ComparisonResult, EntityKey, NormalizedRecord } from '../lib/types.ts';

export interface DiffInput {
  entity: EntityKey;
  legacy: NormalizedRecord[];
  /** key for a legacy row (e.g. normalized phone or product name); null = unkeyable. */
  legacyKey: (r: NormalizedRecord) => string | null;
  newRecords: Array<Record<string, unknown>>;
  newKey: (r: Record<string, unknown>) => string | null;
  requiredNewFields?: string[];
  unmappedLegacyFields?: string[];
}

export function diff(input: DiffInput): ComparisonResult {
  const newByKey = new Map<string, Record<string, unknown>>();
  for (const n of input.newRecords) { const k = input.newKey(n); if (k) newByKey.set(k.toLowerCase(), n); }

  const legacyKeys = new Set<string>();
  let matched = 0;
  let onlyLegacy = 0;
  const fieldDiffs: ComparisonResult['field_diffs'] = [];

  for (const l of input.legacy) {
    const kRaw = input.legacyKey(l);
    if (!kRaw) { onlyLegacy++; continue; }
    const k = kRaw.toLowerCase();
    legacyKeys.add(k);
    const nrec = newByKey.get(k);
    if (!nrec) { onlyLegacy++; continue; }
    matched++;
    if (fieldDiffs.length < 20) {
      for (const [field, lv] of Object.entries(l.data)) {
        const nv = nrec[field];
        if (nv !== undefined && String(lv ?? '') !== String(nv ?? '')) {
          fieldDiffs.push({ key: k, field, legacy: lv, new: nv });
        }
      }
    }
  }

  let onlyNew = 0;
  for (const k of newByKey.keys()) if (!legacyKeys.has(k)) onlyNew++;

  const presentLegacyFields = new Set<string>();
  for (const l of input.legacy) {
    for (const [f, v] of Object.entries(l.data)) {
      if (v !== null && v !== undefined && v !== '') presentLegacyFields.add(f);
    }
  }
  const missingRequired = (input.requiredNewFields ?? []).filter((f) => !presentLegacyFields.has(f));

  const blockers: string[] = [];
  if (input.legacy.length === 0) blockers.push('no legacy rows (legacy access not provided yet, or selectors uncalibrated)');
  const needsReview = input.legacy.filter((l) => l.confidence === 'NEEDS_MANUAL_REVIEW').length;
  if (needsReview > 0) blockers.push(`${needsReview} legacy rows are NEEDS_MANUAL_REVIEW`);
  if (missingRequired.length) blockers.push(`new system requires fields legacy doesn't expose: ${missingRequired.join(', ')}`);

  return {
    entity: input.entity,
    compared_at: new Date().toISOString(),
    legacy_count: input.legacy.length,
    new_count: input.newRecords.length,
    matched,
    only_in_legacy: onlyLegacy,
    only_in_new: onlyNew,
    unmapped_legacy_fields: input.unmappedLegacyFields ?? [],
    missing_required_new_fields: missingRequired,
    field_diffs: fieldDiffs,
    blockers,
  };
}
