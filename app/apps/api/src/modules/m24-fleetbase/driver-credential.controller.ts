import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { DriverCredentialError, DriverCredentialService } from './driver-credential.service';

const COOKIE = 'nz_session';
const ALLOWED_ROLES = new Set(['logistics_manager', 'super_admin']);

@Controller('driver-credentials')
export class DriverCredentialController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly credentials: DriverCredentialService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    await this.authorize(req);
    return this.wrap(async () => ({ items: await this.credentials.listDrivers(), page: { limit: 500 } }));
  }

  @Post(':driverId/rotate')
  @HttpCode(200)
  async rotate(
    @Req() req: Request,
    @Param('driverId') driverId: string,
    @Body() body: { password?: string; password_confirmation?: string },
  ) {
    const ctx = await this.authorize(req);
    return this.wrap(() => this.credentials.rotate(ctx, driverId, body ?? {}));
  }

  private async authorize(req: Request): Promise<StaffContext> {
    const ctx = await this.ctx(req);
    // Credential rotation is fail-closed even while the wider RBAC rollout is in log/warn.
    if (!ctx.roles.some((role) => ALLOWED_ROLES.has(role))) {
      throw new ForbiddenException({ error_code: 'role_denied', permission: 'delivery.driver.credentials.rotate' });
    }
    const decision = await this.access.decide(
      ctx.roles,
      'delivery.driver.credentials.rotate',
      ctx.staffId,
    );
    if (!decision.allowed) {
      throw new ForbiddenException({ error_code: 'role_denied', permission: 'delivery.driver.credentials.rotate' });
    }
    return ctx;
  }

  private async ctx(req: Request): Promise<StaffContext> {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
    if (!sessionId) throw new UnauthorizedException({ error_code: 'no_session' });
    try {
      return await this.sessions.validate(sessionId);
    } catch (error) {
      if (error instanceof AuthError) throw new UnauthorizedException({ error_code: error.code });
      throw error;
    }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DriverCredentialError) {
        if (error.code === 'validation_failed') {
          throw new BadRequestException({ error_code: error.code, detail: error.detail });
        }
        if (error.code === 'not_found') throw new NotFoundException({ error_code: error.code });
        throw new ServiceUnavailableException({ error_code: error.code });
      }
      throw error;
    }
  }
}
