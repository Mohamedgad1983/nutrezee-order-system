// Ops-master / settings extractors needed for order creation: delivery areas, slots,
// methods, payment methods, coupons, and generic settings. Each is read-only.

import { defineExtractor } from './base.ts';
import { normalizeMaster, normalizePassthrough } from '../normalizers/catalog.normalizer.ts';

export const extractAreas = defineExtractor('areas', normalizeMaster('area'));
export const extractDeliverySlots = defineExtractor('delivery_slots', normalizeMaster('delivery_slot'));
export const extractDeliveryMethods = defineExtractor('delivery_methods', normalizeMaster('delivery_method'));
export const extractPaymentMethods = defineExtractor('payment_methods', normalizePassthrough('payment_methods'));
export const extractCoupons = defineExtractor('coupons', normalizePassthrough('coupons'));
export const extractSettings = defineExtractor('settings', normalizePassthrough('settings'));
