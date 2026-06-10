import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { ReportError, ReportService, type ReportName } from './report.service';

const COOKIE = 'nz_session';

@Controller()
export class ReportController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly reports: ReportService,
  ) {}

  @Get('reports/:name')
  async report(@Req() req: Request, @Param('name') name: ReportName, @Query('date') date?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, this.permissionFor(name));
    return this.wrap(async () => ({
      report: name,
      data: await this.reports.report(name, { date }),
    }));
  }

  @Post('exports')
  @HttpCode(200)
  async export(@Req() req: Request, @Body() body: ExportBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'report.export');
    const name = body.report as ReportName;
    await requirePermission(this.access, ctx, this.permissionFor(name));
    return this.wrap(() => this.reports.exportReport(ctx, name, { date: body.date }));
  }

  private permissionFor(name: ReportName): string {
    switch (name) {
      case 'intake-funnel': return 'report.view.intake_funnel';
      case 'daily-ops': return 'report.view.daily_ops';
      case 'kitchen-day-list': return 'report.view.kitchen_day_list';
      default: throw new BadRequestException({ error_code: 'validation_failed', field: 'report' });
    }
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
      if (e instanceof ReportError) throw new BadRequestException({ error_code: e.code });
      throw e;
    }
  }
}

interface ExportBody {
  report?: string;
  date?: string;
}
