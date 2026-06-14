// Compare legacy catalog ↔ new system. Catalog has list endpoints, so we match products
// and packages by name (the natural key pre-sync_record).

import type { ComparisonResult, NormalizedRecord } from '../lib/types.ts';
import type { NewApiClient } from '../lib/new-api.ts';
import { diff } from './compare-util.ts';

export async function compareCatalog(
  legacyProducts: NormalizedRecord[],
  legacyPackages: NormalizedRecord[],
  api: NewApiClient,
): Promise<{ products: ComparisonResult; packages: ComparisonResult }> {
  const fetchItems = async (path: string): Promise<Array<Record<string, unknown>>> => {
    try { return (await api.get<{ items: Array<Record<string, unknown>> }>(path)).items; } catch { return []; }
  };
  const newProducts = await fetchItems('/catalog/products');
  const newPackages = await fetchItems('/catalog/packages');

  const products = diff({
    entity: 'products', legacy: legacyProducts,
    legacyKey: (r) => (typeof r.data.name === 'string' ? r.data.name : null),
    newRecords: newProducts,
    newKey: (r) => (typeof r.nameEn === 'string' ? r.nameEn : null),
    requiredNewFields: ['name'],
  });
  const packages = diff({
    entity: 'packages', legacy: legacyPackages,
    legacyKey: (r) => (typeof r.data.name === 'string' ? r.data.name : null),
    newRecords: newPackages,
    newKey: (r) => (typeof r.nameEn === 'string' ? r.nameEn : null),
    requiredNewFields: ['name'],
  });
  return { products, packages };
}
