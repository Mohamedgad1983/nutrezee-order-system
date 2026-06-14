import { defineExtractor } from './base.ts';
import { normalizeOrders } from '../normalizers/orders.normalizer.ts';

// Legacy orders (active-plan scope). NEVER opens create/edit forms; list + detail reads only.
export const extractOrders = defineExtractor('orders', normalizeOrders);
