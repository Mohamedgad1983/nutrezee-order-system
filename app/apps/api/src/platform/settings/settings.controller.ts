import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SettingsError, SettingsService } from './settings.service';
import { AccessService } from '../rbac/access.service';
import { requirePermission } from '../rbac/permission.util';
import { AuthError, SessionService, type StaffContext } from '../auth/session.service';

// M16 admin API (WP-03). Mutations are POST-only (guardrail 1); gate keys require the
// settings.update.gates permission, ordinary keys settings.update.ops.
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'settings.read');
    return this.settings.list();
  }

  @Post(':key/preview')
  @HttpCode(200)
  async preview(@Req() req: Request, @Param('key') key: string, @Body() body: { value?: unknown }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'settings.read');
    return this.wrap(() => this.settings.preview(key, body?.value ?? null));
  }

  @Post(':key')
  @HttpCode(200)
  async update(
    @Req() req: Request,
    @Param('key') key: string,
    @Body() body: { value?: unknown; effective_from?: string },
  ) {
    const ctx = await this.ctx(req);
    const perm = this.settings.isGateKey(key) ? 'settings.update.gates' : 'settings.update.ops';
    await requirePermission(this.access, ctx, perm);
    await this.wrap(() => this.settings.update(ctx, key, body?.value ?? null, body?.effective_from));
    return { ok: true };
  }

  @Post('flags/:key/set')
  @HttpCode(200)
  async setFlag(@Req() req: Request, @Param('key') key: string, @Body() body: { on?: boolean }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'settings.update.gates');
    if (typeof body?.on !== 'boolean') throw new BadRequestException({ error_code: 'validation_failed' });
    await this.wrap(() => this.settings.setFlag(ctx, key, body.on as boolean));
    return { ok: true };
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
      if (e instanceof SettingsError) {
        if (e.code === 'unknown_key' || e.code === 'not_found') throw new NotFoundException({ error_code: e.code });
        throw new BadRequestException({ error_code: e.code });
      }
      throw e;
    }
  }
}
