// Compare legacy customers ↔ new system. There is no "list all customers" endpoint
// (PII), so we sample-check existence by normalized phone via GET /customers?phone=.

import type { ComparisonResult, NormalizedRecord } from '../lib/types.ts';
import type { NewApiClient } from '../lib/new-api.ts';
import { diff } from './compare-util.ts';
import { log } from '../lib/logger.ts';

const SAMPLE = 50; // throttle: only probe a sample of phones in dry-run

export async function compareCustomers(legacy: NormalizedRecord[], api: NewApiClient): Promise<ComparisonResult> {
  const newRecords: Array<Record<string, unknown>> = [];
  const withPhone = legacy.filter((l) => typeof l.data.phone === 'string' && l.data.phone);
  for (const l of withPhone.slice(0, SAMPLE)) {
    const phone = l.data.phone as string;
    try {
      const res = await api.get<{ items: Array<{ phone_normalized?: string }> }>(`/customers?phone=${encodeURIComponent(phone)}`);
      for (const it of res.items) newRecords.push({ phone: it.phone_normalized ?? phone });
    } catch (e) { log.warn(`compareCustomers: probe failed: ${String(e)}`); }
  }
  const result = diff({
    entity: 'customers',
    legacy,
    legacyKey: (r) => (typeof r.data.phone === 'string' ? r.data.phone : null),
    newRecords,
    newKey: (r) => (typeof r.phone === 'string' ? r.phone : null),
    requiredNewFields: ['full_name_en', 'phone'],
    unmappedLegacyFields: [],
  });
  if (withPhone.length > SAMPLE) result.blockers.push(`only sampled ${SAMPLE}/${withPhone.length} phones (throttled) — full match-rate computed at import dry-run`);
  return result;
}
