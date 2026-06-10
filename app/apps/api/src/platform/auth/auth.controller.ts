import {
  BadRequestException, Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthError, SessionService, StaffContext } from './session.service';
import { AccessService } from '../rbac/access.service';
import { maskFields } from '../masking/masking';

const COOKIE = 'nz_session';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.email || !body?.password) throw new BadRequestException({ error_code: 'validation_failed' });
    try {
      const ctx = await this.sessions.login(body.email, body.password, {
        surface: 'api', ip: req.ip ?? null,
      });
      res.cookie(COOKIE, ctx.sessionId, {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      });
      return { staff_id: ctx.staffId, name: ctx.name, roles: ctx.roles, locale: ctx.locale };
    } catch (e) {
      if (e instanceof AuthError) throw new UnauthorizedException({ error_code: e.code });
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = await this.requireSession(req);
    await this.sessions.logout(ctx);
    res.clearCookie(COOKIE);
    return { ok: true };
  }

  // Read-only (guardrail 1). Demonstrates masked rendering: email/phone are PII-class.
  @Get('me')
  async me(@Req() req: Request) {
    const ctx = await this.requireSession(req);
    const grants = await this.access.visibilityGrants(ctx.roles);
    const { data, masked } = maskFields(
      { staff_id: ctx.staffId, name: ctx.name, email: ctx.email, locale: ctx.locale, roles: ctx.roles },
      { email: 'pii' },
      grants,
    );
    return { ...data, masked };
  }

  private async requireSession(req: Request): Promise<StaffContext> {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
    if (!sessionId) throw new UnauthorizedException({ error_code: 'no_session' });
    try {
      return await this.sessions.validate(sessionId);
    } catch (e) {
      if (e instanceof AuthError) throw new UnauthorizedException({ error_code: e.code });
      throw e;
    }
  }
}
