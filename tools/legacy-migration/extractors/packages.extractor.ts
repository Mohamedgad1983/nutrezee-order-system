import { defineExtractor } from './base.ts';
import { normalizePackages } from '../normalizers/catalog.normalizer.ts';

// Legacy packages → M19 catalog import rows (kind=package, parent_name for sub-packages).
export const extractPackages = defineExtractor('packages', normalizePackages);
