import type { PoolClient } from 'pg';
import { CustomerService } from '../m04-customers/customer.service';
import { CatalogService } from '../m05-catalog/catalog.service';
import { SyncRecordService } from '../m18-bridge/sync-record.service';
import { normalizePhone } from '../m04-customers/phone';
import type { StaffContext } from '../../platform/auth/session.service';
import type { RowImporter, RowResult } from './batch-runner';

// Importers per migration_mapping.md (screen-evidenced legacy fields only [V]).
// Imports go through the OWNING modules' import APIs — never raw foreign tables
// (ADR-010; the cross-module-write scan enforces it).

const IMPORT_ACTOR: StaffContext = {
  staffId: 'import', name: 'Importer', email: 'import@system', locale: 'en',
  roles: ['super_admin'], sessionId: 'import',
};

/** Batch 2 — customers (migration_execution_plan §2.2): dedup pipeline =
 *  normalize -> sync_record idempotency -> exact phone match -> fuzzy merge_review -> create. */
export function customerImporter(
  customers: CustomerService,
  sync: SyncRecordService,
  defaultCountryCode: string,
): RowImporter {
  return async (client: PoolClient, row, rowNo, batchId): Promise<RowResult> => {
    const messages: string[] = [];
    const legacyKey = String(row['legacy_id'] ?? `row-${rowNo}`);
    const name = String(row['name'] ?? '').trim();
    if (!name) return { rowNo, action: 'error', messages: ['missing name'] };

    const existing = await sync.lookup(client, 'customer', legacyKey);
    if (existing) return { rowNo, action: 'matched', targetRef: existing, messages: ['sync_record (idempotent re-run)'] };

    let phoneNormalized: string | undefined;
    if (row['phone']) {
      try {
        phoneNormalized = normalizePhone(String(row['phone']), defaultCountryCode);
      } catch {
        messages.push(`unparseable phone: ${String(row['phone'])}`);
      }
    }

    if (phoneNormalized) {
      const match = await customers.findActiveByPhone(client, phoneNormalized);
      if (match) {
        await sync.record(client, 'customer', legacyKey, match);
        return { rowNo, action: 'matched', targetRef: match, messages: ['exact phone match'] };
      }
    } else {
      // no usable phone -> fuzzy name+dob -> Ops merge-review queue, NEVER auto-merged
      const fuzzy = await customers.findFuzzy(client, name, row['dob'] ? String(row['dob']) : undefined);
      if (fuzzy.length > 0) {
        return { rowNo, action: 'merge_review', messages: [...messages, `fuzzy candidates: ${fuzzy.join(',')}`] };
      }
    }

    const unmapped = Object.keys(row).filter((k) => !['legacy_id', 'name', 'name_ar', 'email', 'dob', 'phone'].includes(k));
    if (unmapped.length > 0) messages.push(`import_notes: unmapped fields ${unmapped.join(',')} (TBD-pending-access)`);

    const id = await customers.createImported(client, {
      fullNameEn: name,
      fullNameAr: row['name_ar'] ? String(row['name_ar']) : undefined,
      email: row['email'] ? String(row['email']) : undefined,        // A1
      dob: row['dob'] ? String(row['dob']) : undefined,
      phoneNormalized,
      phoneRaw: row['phone'] ? String(row['phone']) : undefined,
    }, batchId);
    await sync.record(client, 'customer', legacyKey, id);
    return { rowNo, action: 'created', targetRef: id, messages };
  };
}

/** Batch 1 — catalog (plan §2.1): masters match-or-create by name; products;
 *  packages with parent-by-name (C7). Macros are NOT imported (GAP-DQ-02). */
export function catalogImporter(catalog: CatalogService, sync: SyncRecordService): RowImporter {
  return async (client: PoolClient, row, rowNo, batchId): Promise<RowResult> => {
    const kind = String(row['kind'] ?? '');
    const legacyKey = `${kind}:${String(row['legacy_id'] ?? `row-${rowNo}`)}`;
    const existing = await sync.lookup(client, kind === 'master' ? 'master' : (kind as 'product' | 'package'), legacyKey);
    if (existing) return { rowNo, action: 'matched', targetRef: existing, messages: ['sync_record'] };

    if (kind === 'master') {
      const table = String(row['master_table']);
      if (!['meal_type', 'diet_status', 'tag', 'package_for_type', 'ingredient', 'allergen'].includes(table)) {
        return { rowNo, action: 'error', messages: [`unknown master table ${table}`] };
      }
      const res = await catalog.importMaster(
        client, table as 'meal_type', String(row['name']), String(row['name_ar'] ?? row['name']), batchId,
      ); // M05 API (ADR-010)
      await sync.record(client, 'master', legacyKey, res.id);
      return { rowNo, action: res.matched ? 'matched' : 'created', targetRef: res.id, messages: res.matched ? ['name match'] : [] };
    }

    if (kind === 'product') {
      const id = await catalog.createProduct(IMPORT_ACTOR, {
        nameEn: String(row['name']), nameAr: String(row['name_ar'] ?? row['name']),
        price: row['price'] !== undefined ? Number(row['price']) : undefined,
        importBatchId: batchId,
      }, 'import', client);
      await sync.record(client, 'product', legacyKey, id);
      return { rowNo, action: 'created', targetRef: id, messages: [] };
    }

    if (kind === 'package') {
      let parentId: string | undefined;
      if (row['parent_name']) {
        const parent = await client.query(
          'SELECT id FROM package WHERE lower(name_en) = lower($1)', [String(row['parent_name'])],
        );
        if (parent.rowCount === 0) return { rowNo, action: 'error', messages: [`parent package not found: ${String(row['parent_name'])}`] };
        parentId = parent.rows[0].id;
      }
      const id = await catalog.createPackage(IMPORT_ACTOR, {
        nameEn: String(row['name']), nameAr: String(row['name_ar'] ?? row['name']),
        parentPackageId: parentId,
        price: row['price'] !== undefined ? Number(row['price']) : undefined,
        importBatchId: batchId,
      }, 'import', client);
      await sync.record(client, 'package', legacyKey, id);
      return { rowNo, action: 'created', targetRef: id, messages: [] };
    }

    return { rowNo, action: 'error', messages: [`unknown kind ${kind}`] };
  };
}
