import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { ImportError, ImportGateError, type BatchType } from './batch-runner';
import { MigrationService } from './migration.service';

const COOKIE = 'nz_session';
const IMPORT_TYPES = new Set<BatchType>(['customer', 'catalog', 'active_plans']);

@Controller('imports')
export class MigrationController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly migrations: MigrationService,
  ) {}

  @Post(':type/dry-run')
  @HttpCode(200)
  async dryRun(@Req() req: Request, @Param('type') type: BatchType, @Body() body: ImportBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.import.run');
    return this.wrap(() => this.migrations.run(ctx, this.type(type), this.rows(body), false));
  }

  @Post(':type/apply')
  @HttpCode(200)
  async apply(@Req() req: Request, @Param('type') type: BatchType, @Body() body: ImportBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.import.apply');
    return this.wrap(() => this.migrations.run(ctx, this.type(type), this.rows(body), true));
  }

  @Get(':batchId')
  async report(@Req() req: Request, @Param('batchId') batchId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.import.read');
    return this.wrap(() => this.migrations.report(batchId));
  }

  @Post(':batchId/rollback')
  @HttpCode(200)
  async rollback(@Req() req: Request, @Param('batchId') batchId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.import.rollback');
    await this.wrap(() => this.migrations.rollback(ctx, batchId));
    return { ok: true };
  }

  private type(type: BatchType): BatchType {
    if (!IMPORT_TYPES.has(type)) throw new BadRequestException({ error_code: 'validation_failed', field: 'type' });
    return type;
  }

  private rows(body: ImportBody): Array<Record<string, unknown>> {
    if (!Array.isArray(body.rows)) throw new BadRequestException({ error_code: 'validation_failed', field: 'rows' });
    return body.rows;
  }

  private async ctx(req: Request): Promise<StaffContext> {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
    if (!sessionId) throw new UnauthorizedException({ error_code: 'no_session' });
    try {
      return await this.sessions.validate(sessionId);
    } catch (e) {
      if (e instanceof AuthError) throw new UnauthorizedException({ error_code: e.code });
      throw e;
    }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ImportGateError) throw new BadRequestException({ error_code: 'import_gate_red', gate: e.gate, detail: e.detail });
      if (e instanceof ImportError) throw new BadRequestException({ error_code: e.code, detail: e.message });
      throw e;
    }
  }
}

interface ImportBody {
  rows?: Array<Record<string, unknown>>;
}
