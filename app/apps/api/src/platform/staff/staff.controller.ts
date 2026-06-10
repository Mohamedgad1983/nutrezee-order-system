import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Req,
  ConflictException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { StaffAdminError, StaffService } from './staff.service';
import { RoleAdminError, RoleAdminService } from '../rbac/role-admin.service';
import { AccessService } from '../rbac/access.service';
import { requirePermission } from '../rbac/permission.util';
import { AuthError, SessionService, type StaffContext } from '../auth/session.service';
import { maskFields } from '../masking/masking';
import { UnauthorizedException } from '@nestjs/common';

// M12 staff admin + M13 grants (API surface; admin SPA screens consolidate at the
// intake UI WP). Mutations are POST/PATCH only — GET never mutates (guardrail 1).
@Controller()
export class StaffController {
  constructor(
    private readonly sessions: SessionService,
    private readonly staff: StaffService,
    private readonly roles: RoleAdminService,
    private readonly access: AccessService,
  ) {}

  @Get('staff')
  async list(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'staff.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    const rows = await this.staff.list();
    return rows.map((r) => {
      const { data, masked } = maskFields(r, { email: 'pii', phone: 'pii' }, grants);
      return { ...data, masked };
    });
  }

  @Post('staff')
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Body() body: { name_en?: string; name_ar?: string; email?: string; phone?: string; locale?: 'en' | 'ar'; password?: string },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'staff.create');
    if (!body?.name_en || !body?.email) {
      throw new BadRequestException({ error_code: 'validation_failed', field_errors: [{ field: 'name_en|email', rule: 'required' }] });
    }
    const id = await this.wrap(() =>
      this.staff.create(ctx, {
        nameEn: body.name_en as string, nameAr: body.name_ar, email: body.email as string,
        phone: body.phone, locale: body.locale, password: body.password,
      }),
    );
    return { id };
  }

  @Patch('staff/:id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name_en?: string; name_ar?: string; phone?: string; locale?: 'en' | 'ar'; reset_failed_logins?: boolean },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'staff.update');
    await this.wrap(() =>
      this.staff.update(ctx, id, {
        nameEn: body.name_en, nameAr: body.name_ar, phone: body.phone,
        locale: body.locale, resetFailedLogins: body.reset_failed_logins,
      }),
    );
    return { ok: true };
  }

  @Post('staff/:id/deactivate')
  @HttpCode(200)
  async deactivate(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'staff.deactivate');
    await this.wrap(() => this.staff.deactivate(ctx, id));
    return { ok: true };
  }

  @Post('rbac/grants')
  @HttpCode(200)
  async grant(@Req() req: Request, @Body() body: { staff_id?: string; role?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'rbac.role.grant');
    if (!body?.staff_id || !body?.role) throw new BadRequestException({ error_code: 'validation_failed' });
    await this.wrap(() => this.roles.grant(ctx, body.staff_id as string, body.role as string));
    return { ok: true };
  }

  @Post('rbac/revoke')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Body() body: { staff_id?: string; role?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'rbac.role.grant');
    if (!body?.staff_id || !body?.role) throw new BadRequestException({ error_code: 'validation_failed' });
    await this.wrap(() => this.roles.revoke(ctx, body.staff_id as string, body.role as string));
    return { ok: true };
  }

  @Get('rbac/matrix')
  async matrix(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'rbac.role.read');
    return this.roles.exportMatrix();
  }

  private async ctx(req: Request): Promise<StaffContext> {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.['nz_session'];
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
      if (e instanceof StaffAdminError) {
        if (e.code === 'email_taken') throw new ConflictException({ error_code: e.code });
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code });
        throw new ForbiddenException({ error_code: e.code });
      }
      if (e instanceof RoleAdminError) {
        if (e.code === 'unknown_role') throw new BadRequestException({ error_code: e.code });
        if (e.code === 'level_cap') throw new ForbiddenException({ error_code: e.code });
        throw new ConflictException({ error_code: e.code });
      }
      throw e;
    }
  }
}
