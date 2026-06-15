// Legacy customer row → new `customer` shape (full_name_en/ar, email, dob, phone→
// customer_phone, diet_status by name). Per migration_mapping.md §1 + ASM-007..009.

import type { NormalizedRecord, RawRow } from '../lib/types.ts';
import { normalizePhone, pick, splitName, toIsoDate } from '../lib/normalize-util.ts';

export function normalizeCustomers(raw: RawRow[]): NormalizedRecord[] {
  return raw.map((r): NormalizedRecord => {
    const notes: string[] = [];
    const name = splitName(pick(r, 'name', 'full_name', 'customer_name', 'username'));
    const phoneRaw = pick(r, 'phone', 'mobile', 'contact', 'phone_number');
    const { phone, ok: phoneOk } = normalizePhone(phoneRaw);
    const dob = toIsoDate(pick(r, 'dob', 'birthday', 'date_of_birth'));

    if (phoneRaw && !phoneOk) notes.push('phone not parseable to E.164 → dedup merge_review (ASM-008)');
    if (!name.en && name.ar) notes.push('name only in Arabic → full_name_en (required) missing → review (model A1)');
    if (!name.en && !name.ar) notes.push('no name on row → review');
    if (!dob.ok && pick(r, 'dob', 'birthday')) notes.push('DOB unparseable → import_notes (not blocking)');

    // full_name_en + a parseable phone are required to import safely; anything missing → review.
    const needsReview = (phoneRaw !== null && !phoneOk) || !name.en;
    const confidence: NormalizedRecord['confidence'] = needsReview ? 'NEEDS_MANUAL_REVIEW' : phoneOk ? 'VERIFIED' : 'INFERRED';

    return {
      legacy_id: pick(r, 'id', 'customer_id', 'user_id'),
      data: {
        full_name_en: name.en,
        full_name_ar: name.ar,
        email: pick(r, 'email'),
        dob: dob.date,
        phone,                                   // → customer_phone(is_primary)
        diet_status_name: pick(r, 'diet_status', 'diet'), // resolved to diet_status_id at import (by name)
        origin: 'legacy',
      },
      confidence,
      notes,
    };
  });
}
