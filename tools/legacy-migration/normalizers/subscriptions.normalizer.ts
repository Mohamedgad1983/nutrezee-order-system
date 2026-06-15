// Legacy subscribers/subscriptions. Per the coverage matrix, Subscribers = class D
// (marketing list, OFF the order-ops cutover path) — so every row is flagged for a
// human scope decision before any migration.

import type { NormalizedRecord, RawRow } from '../lib/types.ts';
import { normalizePhone, pick } from '../lib/normalize-util.ts';

export function normalizeSubscriptions(raw: RawRow[]): NormalizedRecord[] {
  return raw.map((r): NormalizedRecord => ({
    legacy_id: pick(r, 'id', 'subscriber_id'),
    data: {
      name: pick(r, 'name', 'full_name'),
      phone: normalizePhone(pick(r, 'phone', 'mobile')).phone,
      email: pick(r, 'email'),
      status: pick(r, 'status', 'state'),
      origin: 'legacy',
    },
    confidence: 'NEEDS_MANUAL_REVIEW',
    notes: ['Subscribers = legacy class D (marketing list), off the order-ops cutover path — confirm migration scope first (Legacy_Core_Gap_To_Cutover §1.6)'],
  }));
}
