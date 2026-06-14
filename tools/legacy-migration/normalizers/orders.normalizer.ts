// Legacy order row → new `customer_order` (active-plan import scope). Only active/pause
// import; others stay legacy. Status/payment/off-day per ASM-037/038/043/050.

import type { NormalizedRecord, RawRow } from '../lib/types.ts';
import { normalizePhone, pick, toIsoDate } from '../lib/normalize-util.ts';

// legacy status → new order status (null = not in active-plan import scope)
const STATUS_MAP: Record<string, string | null> = {
  active: 'active', pause: 'paused', paused: 'paused',
  pending: null, expired: null, cancel: null, cancelled: null, completed: null, closed: null,
};

export function normalizeOrders(raw: RawRow[]): NormalizedRecord[] {
  return raw.map((r): NormalizedRecord => {
    const notes: string[] = [];
    const legacyStatus = (pick(r, 'status', 'order_status') ?? '').toLowerCase().trim();
    const mapped = legacyStatus in STATUS_MAP ? STATUS_MAP[legacyStatus] : undefined;
    if (mapped === undefined) notes.push(`unknown legacy status "${legacyStatus}" → review, not imported`);
    else if (mapped === null) notes.push(`status "${legacyStatus}" outside active-plan scope → stays legacy`);

    const start = toIsoDate(pick(r, 'start_date', 'start'));
    const end = toIsoDate(pick(r, 'end_date', 'end'));
    if (!start.ok) notes.push('start_date required for active-plan import but unparseable');
    if (!end.ok) notes.push('end_date missing → derive from package duration (ASM-015)');
    notes.push('off_days unknown → off_days_unverified=true (ASM-038); address/slot may be unverified (ASM-050)');

    const confidence: NormalizedRecord['confidence'] = mapped && start.ok ? 'INFERRED' : 'NEEDS_MANUAL_REVIEW';
    return {
      legacy_id: pick(r, 'id', 'order_id'),
      data: {
        legacy_status: legacyStatus || null,
        status: mapped ?? null,
        customer_phone: normalizePhone(pick(r, 'phone', 'customer_phone')).phone,
        package_name: pick(r, 'package', 'package_name'),
        start_date: start.date,
        end_date: end.date,
        payment_status_legacy: pick(r, 'payment_status', 'payment'), // mapped at import (ASM-037)
        off_days_unverified: true,
        address_unverified: true,
        origin: 'legacy',
      },
      confidence,
      notes,
    };
  });
}
