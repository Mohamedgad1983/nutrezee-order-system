import { defineExtractor } from './base.ts';
import { normalizeSubscriptions } from '../normalizers/subscriptions.normalizer.ts';

// Legacy subscribers (class D — flagged for scope decision before any migration).
export const extractSubscriptions = defineExtractor('subscriptions', normalizeSubscriptions);
