import { defineExtractor } from './base.ts';
import { normalizeProducts } from '../normalizers/catalog.normalizer.ts';

// Legacy products → M19 catalog import rows (kind=product). Mirror-mode safe (import-only).
export const extractProducts = defineExtractor('products', normalizeProducts);
