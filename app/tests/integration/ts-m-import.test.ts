import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditReadQueue, AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { SyncRecordService } from '../../apps/api/src/modules/m18-bridge/sync-record.service';
import { BatchRunner, ImportGateError } from '../../apps/api/src/modules/m19-migration/batch-runner';
import { catalogImporter, customerImporter } from '../../apps/api/src/modules/m19-migration/importers';

// TS-M — migration suite against synthetic legacy fixtures (test_strategy:
// "synthetic legacy CSVs matching screen-evidenced fields"). Real legacy data
// stays blocked on access/export (WP-13).
let pool: Pool;
let runner: BatchRunner;
let importCustomers: ReturnType<typeof customerImporter>;
let importCatalog: ReturnType<typeof catalogImporter>;
const sa: StaffContext = { staffId: 'sa-1', name: 'SA', email: 'sa@t', locale: 'en', roles: ['super_admin'], sessionId: 's' };

const CUSTOMER_FIXTURE = [
  { legacy_id: 'u-1', name: 'Aisha Noor', email: 'aisha@legacy.example', dob: '1992-03-04', phone: '0501110001' },
  { legacy_id: 'u-2', name: 'Badr Salem', phone: '0501110002', loyalty_points: 250 }, // unmapped field -> import_notes
  { legacy_id: 'u-3', name: 'Copy Of Aisha', phone: '050 111 0001' },                 // exact-phone dup of u-1 (in-batch)
  { legacy_id: 'u-4', name: 'No Phone Person', dob: '1980-05-05' },                   // no phone, no fuzzy -> created
];

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  const settings = new SettingsReader(pool, 0);
  const customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), new OutboxService(), settings);
  const catalog = new CatalogService(pool, audit, settings);
  const sync = new SyncRecordService();
  runner = new BatchRunner(pool, audit, sync);
  importCustomers = customerImporter(customers, sync, '+966');
  importCatalog = catalogImporter(catalog, sync);
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-M migration — dry-run produces a reviewable report without business writes', () => {
  it('dry-run: counts computed, batch + row results persisted, NO customers created', async () => {
    const report = await runner.run(sa, 'customer', CUSTOMER_FIXTURE, importCustomers);
    expect(report.dryRun).toBe(true);
    expect(report.counts).toMatchObject({ created: 3, matched: 1 }); // u-3 matches u-1 in-batch
    const persisted = await pool.query('SELECT count(*)::int AS n FROM customer');
    expect(persisted.rows[0].n).toBe(0); // business writes rolled back
    const batch = await pool.query(`SELECT state, counts FROM import_batch WHERE id = $1`, [report.batchId]);
    expect(batch.rows[0].state).toBe('dry_run');
    const rows = await pool.query('SELECT count(*)::int AS n FROM import_row_result WHERE batch_id = $1', [report.batchId]);
    expect(rows.rows[0].n).toBe(4); // reviewable per-row report
    const noted = await pool.query(
      `SELECT messages FROM import_row_result WHERE batch_id = $1 AND row_no = 2`, [report.batchId],
    );
    expect(JSON.stringify(noted.rows[0].messages)).toMatch(/loyalty_points/); // nothing silently dropped
  });
});

describe('TS-M migration — apply gate + idempotent re-run + audit', () => {
  it('apply without a prior dry-run of the same snapshot is refused', async () => {
    const other = [{ legacy_id: 'x-1', name: 'Never Dry Ran', phone: '0509990001' }];
    await expect(runner.run(sa, 'customer', other, importCustomers, { apply: true }))
      .rejects.toMatchObject({ code: 'dry_run_required' });
  });

  it('apply after dry-run persists rows (origin=legacy, batch stamp, sync_record); re-apply = all matched', async () => {
    const applied = await runner.run(sa, 'customer', CUSTOMER_FIXTURE, importCustomers, { apply: true });
    expect(applied.counts.created).toBe(3);
    const persisted = await pool.query(
      `SELECT count(*)::int AS n FROM customer WHERE origin = 'legacy' AND import_batch_id = $1`,
      [applied.batchId],
    );
    expect(persisted.rows[0].n).toBe(3);
    const audit = await pool.query(
      `SELECT severity FROM audit_event WHERE event_type = 'bridge.import_run' AND entity_id = $1`,
      [applied.batchId],
    );
    expect(audit.rows[0].severity).toBe('high');

    // idempotent re-run: needs its own dry-run gate first, then everything matches
    const rerun = await runner.run(sa, 'customer', CUSTOMER_FIXTURE, importCustomers, { apply: true });
    expect(rerun.counts).toMatchObject({ created: 0, matched: 4 });
    const total = await pool.query(`SELECT count(*)::int AS n FROM customer`);
    expect(total.rows[0].n).toBe(3); // no duplicates
  });

  it('merge_review gate blocks apply when fuzzy-dup rate exceeds the threshold', async () => {
    // existing "No Phone Person" makes every phoneless same-name row a merge_review
    const risky = [
      { legacy_id: 'm-1', name: 'No Phone Person', dob: '1980-05-05' },
      { legacy_id: 'm-2', name: 'No Phone Person', dob: '1980-05-05' },
    ];
    const dry = await runner.run(sa, 'customer', risky, importCustomers);
    expect(dry.counts.merge_review).toBe(2); // 100% > 10% gate
    await expect(runner.run(sa, 'customer', risky, importCustomers, { apply: true }))
      .rejects.toBeInstanceOf(ImportGateError);
    // exactly the ONE pre-existing u-4 row from the earlier applied fixture — the
    // gate-blocked apply added nothing
    const persisted = await pool.query(`SELECT count(*)::int AS n FROM customer WHERE full_name_en = 'No Phone Person' AND origin = 'legacy'`);
    expect(persisted.rows[0].n).toBe(1);
  });
});

describe('TS-M migration — catalog batch + rollback', () => {
  const CATALOG_FIXTURE = [
    { kind: 'master', master_table: 'meal_type', legacy_id: 'mt-1', name: 'Lunch', name_ar: 'غداء' },
    { kind: 'product', legacy_id: 'p-1', name: 'Imported Kabsa', name_ar: 'كبسة', price: 4500 },
    { kind: 'package', legacy_id: 'pk-1', name: 'Monthly Plan', name_ar: 'شهري', price: 120000 },
    { kind: 'package', legacy_id: 'pk-2', name: 'Monthly Lite', name_ar: 'لايت', parent_name: 'Monthly Plan' },
  ];

  it('error rows are reported in dry-run (never silently dropped) and trip the error gate on apply', async () => {
    const withOrphan = [...CATALOG_FIXTURE, { kind: 'package', legacy_id: 'pk-3', name: 'Orphan Sub', parent_name: 'Does Not Exist' }];
    const dry = await runner.run(sa, 'catalog', withOrphan, importCatalog);
    expect(dry.counts.error).toBe(1); // 20% error rate
    await expect(runner.run(sa, 'catalog', withOrphan, importCatalog, { apply: true }))
      .rejects.toBeInstanceOf(ImportGateError); // error gate (2%) blocks the apply
  });

  it('catalog import: masters match-or-create, products/packages via M05 import path, parent-by-name (C7)', async () => {
    await runner.run(sa, 'catalog', CATALOG_FIXTURE, importCatalog);
    const applied = await runner.run(sa, 'catalog', CATALOG_FIXTURE, importCatalog, { apply: true });
    expect(applied.counts).toMatchObject({ created: 4, error: 0 });
    const child = await pool.query(
      `SELECT p.parent_package_id FROM package p WHERE p.name_en = 'Monthly Lite'`,
    );
    const parent = await pool.query(`SELECT id FROM package WHERE name_en = 'Monthly Plan'`);
    expect(child.rows[0].parent_package_id).toBe(parent.rows[0].id);
  });

  it('rollback deletes the batch rows child-first, clears sync_records, audits HIGH', async () => {
    const fixture = [{ kind: 'product', legacy_id: 'rb-1', name: 'Rollback Me', name_ar: 'تراجع' }];
    await runner.run(sa, 'catalog', fixture, importCatalog);
    const applied = await runner.run(sa, 'catalog', fixture, importCatalog, { apply: true });
    await runner.rollback(sa, applied.batchId);
    const gone = await pool.query(`SELECT 1 FROM product WHERE name_en = 'Rollback Me'`);
    expect(gone.rowCount).toBe(0);
    const sync = await pool.query(`SELECT 1 FROM sync_record WHERE legacy_key = 'product:rb-1'`);
    expect(sync.rowCount).toBe(0);
    const state = await pool.query('SELECT state FROM import_batch WHERE id = $1', [applied.batchId]);
    expect(state.rows[0].state).toBe('rolled_back');
    await expect(runner.rollback(sa, applied.batchId)).rejects.toMatchObject({ code: 'not_applied' });
  });
});
