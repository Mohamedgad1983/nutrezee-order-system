import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BridgeController } from '../../apps/api/src/modules/m18-bridge/bridge.controller';
import { BridgeError, type ReconciliationService } from '../../apps/api/src/modules/m18-bridge/reconciliation.service';
import type { CutoverFlagService } from '../../apps/api/src/modules/m18-bridge/cutover-flag.service';
import { ImportGateError, type BatchReport } from '../../apps/api/src/modules/m19-migration/batch-runner';
import { MigrationController } from '../../apps/api/src/modules/m19-migration/migration.controller';
import type { MigrationService } from '../../apps/api/src/modules/m19-migration/migration.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'sa-c13', name: 'SA C13', email: 'sa-c13@t', locale: 'en', roles: ['super_admin'], sessionId: 's-c13',
};
const req = { cookies: { nz_session: 'session-c13' } } as unknown as Request;

function platform() {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return { sessions, access };
}

const report: BatchReport = {
  batchId: 'batch-1',
  dryRun: true,
  sourceHash: 'hash',
  counts: { created: 1, matched: 0, merge_review: 0, skipped: 0, error: 0 },
  rows: [{ rowNo: 1, action: 'created', messages: [] }],
};

describe('TS-C API contract — bridge and imports (WP-13)', () => {
  it('maps import dry-run/apply/report/rollback endpoints to M19 service calls and permissions', async () => {
    const { sessions, access } = platform();
    const migrations = {
      run: vi.fn().mockResolvedValue(report),
      report: vi.fn().mockResolvedValue(report),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as unknown as MigrationService;
    const c = new MigrationController(sessions, access, migrations);

    await expect(c.dryRun(req, 'active_plans', { rows: [{ legacy_id: 'p1' }] })).resolves.toEqual(report);
    await expect(c.apply(req, 'active_plans', { rows: [{ legacy_id: 'p1' }] })).resolves.toEqual(report);
    await expect(c.report(req, 'batch-1')).resolves.toEqual(report);
    await expect(c.rollback(req, 'batch-1')).resolves.toEqual({ ok: true });

    expect(migrations.run).toHaveBeenCalledWith(ctx, 'active_plans', [{ legacy_id: 'p1' }], false);
    expect(migrations.run).toHaveBeenCalledWith(ctx, 'active_plans', [{ legacy_id: 'p1' }], true);
    expect(migrations.rollback).toHaveBeenCalledWith(ctx, 'batch-1');
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.import.run', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.import.apply', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.import.read', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.import.rollback', ctx.staffId);
  });

  it('maps import gate failures and validates rows', async () => {
    const { sessions, access } = platform();
    const migrations = {
      run: vi.fn().mockRejectedValue(new ImportGateError('error_rate', '100% > 0%')),
    } as unknown as MigrationService;
    const c = new MigrationController(sessions, access, migrations);

    await expect(c.dryRun(req, 'active_plans', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.apply(req, 'active_plans', { rows: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps reconciliation and cutover endpoints to M18 services and permissions', async () => {
    const { sessions, access } = platform();
    const reconciliation = {
      list: vi.fn().mockResolvedValue([{ id: 'rec-1' }]),
      record: vi.fn().mockResolvedValue({ id: 'rec-2', state: 'divergent' }),
    } as unknown as ReconciliationService;
    const cutover = {
      list: vi.fn().mockResolvedValue([{ key: 'cutover_intake' }]),
      toggle: vi.fn().mockResolvedValue({ key: 'cutover_intake', on_flag: true }),
    } as unknown as CutoverFlagService;
    const c = new BridgeController(sessions, access, reconciliation, cutover);

    await expect(c.reconciliations(req, '25')).resolves.toEqual({ items: [{ id: 'rec-1' }], page: { limit: 25 } });
    await expect(c.recordReconciliation(req, {
      run_type: 'payments',
      counts: { legacy: 2 },
      diffs: { missing: ['x'] },
    })).resolves.toEqual({ id: 'rec-2', state: 'divergent' });
    await expect(c.cutoverFlags(req)).resolves.toEqual({ items: [{ key: 'cutover_intake' }], page: { limit: 100 } });
    await expect(c.toggleCutover(req, 'cutover_intake', { on_flag: true, note: 'go' }))
      .resolves.toEqual({ key: 'cutover_intake', on_flag: true });

    expect(reconciliation.record).toHaveBeenCalledWith(ctx, {
      runType: 'payments',
      counts: { legacy: 2 },
      diffs: { missing: ['x'] },
      state: undefined,
    });
    expect(cutover.toggle).toHaveBeenCalledWith(ctx, 'cutover_intake', true, 'go');
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.reconciliation.read', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.reconciliation.record', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.cutover.read', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'bridge.cutover.toggle', ctx.staffId);
  });

  it('maps M18 validation errors to bad requests', async () => {
    const { sessions, access } = platform();
    const reconciliation = {
      record: vi.fn().mockRejectedValue(new BridgeError('validation_failed', { field: 'run_type' })),
    } as unknown as ReconciliationService;
    const c = new BridgeController(
      sessions,
      access,
      reconciliation,
      { list: vi.fn(), toggle: vi.fn() } as unknown as CutoverFlagService,
    );

    await expect(c.recordReconciliation(req, { run_type: 'unknown' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.toggleCutover(req, 'cutover_intake', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
