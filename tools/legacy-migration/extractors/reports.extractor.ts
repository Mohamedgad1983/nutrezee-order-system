import { defineExtractor } from './base.ts';
import { normalizePassthrough } from '../normalizers/catalog.normalizer.ts';

// Legacy reports — captured ONLY for reconciliation counts (human review), never imported.
export const extractReports = defineExtractor('reports', normalizePassthrough('reports'));
