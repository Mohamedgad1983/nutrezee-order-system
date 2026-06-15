// Compare legacy orders ↔ new system. Row-level matching needs sync_record (only exists
// post-import), so pre-import this is count + scope based, with the right blockers surfaced.

import type { ComparisonResult, NormalizedRecord } from '../lib/types.ts';
import type { NewApiClient } from '../lib/new-api.ts';
import { diff } from './compare-util.ts';

export async function compareOrders(legacy: NormalizedRecord[], api: NewApiClient): Promise<ComparisonResult> {
  let newRecords: Array<Record<string, unknown>> = [];
  try {
    const res = await api.get<{ items: Array<Record<string, unknown>> }>('/orders');
    newRecords = res.items;
  } catch { /* counts to 0, blocker added by diff */ }

  const inScope = legacy.filter((l) => l.data.status === 'active' || l.data.status === 'paused');
  const result = diff({
    entity: 'orders',
    legacy,
    legacyKey: () => null, // no shared key until sync_record exists
    newRecords,
    newKey: () => null,
    requiredNewFields: ['status', 'start_date', 'customer_phone'],
    unmappedLegacyFields: [],
  });
  result.blockers.push('order row-level match requires sync_record (post-import) — pre-import is count/scope only');
  result.blockers.push(`${inScope.length}/${legacy.length} legacy orders are in active-plan import scope (active/paused)`);
  return result;
}
