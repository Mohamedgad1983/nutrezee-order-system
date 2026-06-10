import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { CutoverFlagService } from './cutover-flag.service';
import { BridgeError, ReconciliationService } from './reconciliation.service';

const COOKIE = 'nz_session';

@Controller('bridge')
export class BridgeController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly reconciliation: ReconciliationService,
    private readonly cutover: CutoverFlagService,
  ) {}

  @Get('reconciliations')
  async reconciliations(@Req() req: Request, @Query('limit') limit?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.reconciliation.read');
    return { items: await this.reconciliation.list(limit ? Number(limit) : 100), page: { limit: limit ? Number(limit) : 100 } };
  }

  @Post('reconciliations')
  @HttpCode(201)
  async recordReconciliation(@Req() req: Request, @Body() body: ReconciliationBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.reconciliation.record');
    return this.wrap(() => this.reconciliation.record(ctx, {
      runType: body.run_type,
      counts: body.counts,
      diffs: body.diffs,
      state: body.state,
    }));
  }

  @Get('cutover-flags')
  async cutoverFlags(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.cutover.read');
    return { items: await this.cutover.list(), page: { limit: 100 } };
  }

  @Post('cutover-flags/:key')
  @HttpCode(200)
  async toggleCutover(@Req() req: Request, @Param('key') key: string, @Body() body: CutoverBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'bridge.cutover.toggle');
    if (typeof body.on_flag !== 'boolean') throw new BadRequestException({ error_code: 'validation_failed', field: 'on_flag' });
    const onFlag = body.on_flag;
    return this.wrap(() => this.cutover.toggle(ctx, key, onFlag, body.note));
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
      if (e instanceof BridgeError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
      throw e;
    }
  }
}

interface ReconciliationBody {
  run_type?: string;
  counts?: Record<string, unknown>;
  diffs?: Record<string, unknown>;
  state?: 'ok' | 'divergent';
}

interface CutoverBody {
  on_flag?: boolean;
  note?: string;
}
