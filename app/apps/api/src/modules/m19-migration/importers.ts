import type { PoolClient } from 'pg';
import { CustomerService } from '../m04-customers/customer.service';
import { CatalogService } from '../m05-catalog/catalog.service';
import { SyncRecordService } from '../m18-bridge/sync-record.service';
import { normalizePhone } from '../m04-customers/phone';
import type { StaffContext } from '../../platform/auth/session.service';
import type { RowImporter, RowResult } from './batch-runner';
import { OrderService, type OrderStatus } from '../m03-orders/order.service';
import { PaymentService } from '../m07-payments/payment.service';

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
        // package lookup via the M05 owning-module API, not a raw table read (ADR-010)
        const parent = await catalog.packageByNameInTx(client, String(row['parent_name']));
        if (!parent) return { rowNo, action: 'error', messages: [`parent package not found: ${String(row['parent_name'])}`] };
        parentId = parent.id;
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

/** Batch 3 — active plans (WP-13): legacy orders are imported through M03/M07
 * owner APIs, not by M19 writing order/payment tables. Real legacy apply remains
 * blocked until export/access exists; this importer is fixture-driven and dry-run
 * reviewable. */
export function activePlanImporter(
  customers: CustomerService,
  catalog: CatalogService,
  orders: OrderService,
  payments: PaymentService,
  sync: SyncRecordService,
  defaultCountryCode: string,
): RowImporter {
  return async (client: PoolClient, row, rowNo, batchId): Promise<RowResult> => {
    const messages: string[] = [];
    const legacyKey = String(row['legacy_id'] ?? `row-${rowNo}`);
    // Frozen legacy delivery snapshot (method/time/area) — also backfilled onto already-imported
    // orders so a delivery-only re-import enriches existing rows idempotently.
    const delivery = {
      deliveryMethodFrozen: stringField(row['delivery_method']) ?? undefined,
      deliveryTimeFrozen: stringField(row['delivery_time']) ?? undefined,
      deliveryAreaFrozen: stringField(row['area']) ?? undefined,
    };
    const existing = await sync.lookup(client, 'order', legacyKey);
    if (existing) {
      const filled = await orders.setFrozenDeliveryInTx(client, IMPORT_ACTOR.staffId, existing, delivery);
      return { rowNo, action: 'matched', targetRef: existing, messages: filled ? ['sync_record', 'delivery_backfilled'] : ['sync_record'] };
    }

    const orderNumber = String(row['order_number'] ?? legacyKey).trim();
    if (!orderNumber) return { rowNo, action: 'error', messages: ['missing order_number'] };
    const byOrderNumber = await orders.findByOrderNumberInTx(client, orderNumber);
    if (byOrderNumber) {
      await sync.record(client, 'order', legacyKey, byOrderNumber);
      const filled = await orders.setFrozenDeliveryInTx(client, IMPORT_ACTOR.staffId, byOrderNumber, delivery);
      return { rowNo, action: 'matched', targetRef: byOrderNumber, messages: filled ? ['order_number match', 'delivery_backfilled'] : ['order_number match'] };
    }

    const customerId = await resolveCustomer(client, customers, sync, row, defaultCountryCode);
    if (!customerId) return { rowNo, action: 'error', messages: ['customer not found by legacy id or phone'] };

    const startDate = stringField(row['start_date']);
    const endDate = stringField(row['end_date']);
    if (!startDate) return { rowNo, action: 'error', messages: ['missing start_date'] };
    if (!endDate) return { rowNo, action: 'error', messages: ['missing end_date'] };

    const packageResolved = await resolvePackage(client, catalog, sync, row);
    if (!packageResolved.id && !packageResolved.nameEn) messages.push('package unresolved; frozen legacy package name retained if present');

    const offDays = parseOffDays(row['off_days']);
    if (offDays.unverified) messages.push('off_days_unverified=true; sponsor review required');
    const orderStatus = parseOrderStatus(row['status']);
    if (orderStatus.unverified) messages.push(`legacy order status defaulted to active: ${String(row['status'])}`);

    const created = await orders.createImportedActivePlanInTx(client, 'import', {
      orderNumber,
      customerId,
      packageId: packageResolved.id,
      packageNameEn: packageResolved.nameEn,
      packageNameAr: packageResolved.nameAr ?? undefined,
      status: orderStatus.value,
      startDate,
      endDate,
      offDays: offDays.values,
      offDaysUnverified: offDays.unverified,
      channel: stringField(row['channel']) ?? 'legacy',
      total: numberField(row['total']),
      currency: stringField(row['currency']) ?? 'SAR',
      importBatchId: batchId,
      addressFrozen: {
        legacy_import: true,
        address_unverified: true,
        address_text: stringField(row['address']) ?? null,
        area: stringField(row['area']) ?? null,
      },
      ...delivery,
    });
    await sync.record(client, 'order', legacyKey, created.id);

    if (row['payment_status']) {
      const payment = await payments.importLegacyPaymentInTx(client, 'import', {
        orderId: created.id,
        legacyStatus: String(row['payment_status']),
        method: stringField(row['payment_method']),
        amount: numberField(row['payment_amount']) ?? numberField(row['total']),
        currency: stringField(row['currency']) ?? 'SAR',
        transactionRef: stringField(row['transaction_ref']),
        evidenceNote: stringField(row['payment_note']),
        importBatchId: batchId,
      });
      await sync.record(client, 'payment', legacyKey, payment.paymentId);
      if (payment.unmapped) messages.push(`legacy payment status queued for finance review: ${String(row['payment_status'])}`);
      else messages.push(`legacy payment status mapped: ${payment.mappedStatus}`);
    }

    return { rowNo, action: 'created', targetRef: created.id, messages };
  };
}

async function resolveCustomer(
  client: PoolClient,
  customers: CustomerService,
  sync: SyncRecordService,
  row: Record<string, unknown>,
  defaultCountryCode: string,
): Promise<string | null> {
  const legacyCustomer = stringField(row['customer_legacy_id']);
  if (legacyCustomer) {
    const mapped = await sync.lookup(client, 'customer', legacyCustomer);
    if (mapped) return mapped;
  }
  const phone = stringField(row['customer_phone']);
  if (!phone) return null;
  try {
    // `return await` so an async rejection is caught here (unparseable phone -> null)
    return await customers.findActiveByPhone(client, normalizePhone(phone, defaultCountryCode));
  } catch {
    return null;
  }
}

async function resolvePackage(
  client: PoolClient,
  catalog: CatalogService,
  sync: SyncRecordService,
  row: Record<string, unknown>,
): Promise<{ id?: string; nameEn?: string; nameAr?: string | null }> {
  const legacyPackage = stringField(row['package_legacy_id']);
  if (legacyPackage) {
    const mapped = await sync.lookup(client, 'package', `package:${legacyPackage}`);
    if (mapped) {
      const pkg = await catalog.packageForOrder(mapped);
      if (pkg) return { id: pkg.id, nameEn: pkg.nameEn, nameAr: pkg.nameAr };
    }
  }
  const packageName = stringField(row['package_name']);
  if (!packageName) return {};
  const pkg = await catalog.packageByNameInTx(client, packageName);
  if (pkg) return { id: pkg.id, nameEn: pkg.nameEn, nameAr: pkg.nameAr };
  return { nameEn: packageName, nameAr: stringField(row['package_name_ar']) };
}

function parseOrderStatus(value: unknown): { value: OrderStatus; unverified: boolean } {
  if (value === undefined || value === null || value === '') return { value: 'active', unverified: false };
  const status = String(value ?? 'active').trim().toLowerCase();
  if (['approved', 'active', 'paused', 'completed', 'expired', 'cancelled', 'rejected'].includes(status)) {
    return { value: status as OrderStatus, unverified: false };
  }
  return { value: 'active', unverified: true };
}

function parseOffDays(value: unknown): { values: string[]; unverified: boolean } {
  if (value === undefined || value === null || value === '') return { values: [], unverified: false };
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return { values: value, unverified: false };
  if (typeof value !== 'string') return { values: [], unverified: true };
  const trimmed = value.trim();
  if (!trimmed) return { values: [], unverified: false };
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return { values: parsed, unverified: false };
      }
    } catch {
      return { values: [], unverified: true };
    }
  }
  const normalized = trimmed.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  if (normalized.length > 0 && normalized.every((v) => allowed.has(v))) return { values: normalized, unverified: false };
  return { values: [], unverified: true };
}

function stringField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const out = String(value).trim();
  return out ? out : undefined;
}

function numberField(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const out = Number(value);
  return Number.isFinite(out) ? out : undefined;
}
