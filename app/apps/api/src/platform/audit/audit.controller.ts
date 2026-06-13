import { Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuditQueryService } from './audit-query.service';
import { AccessService } from '../rbac/access.service';
import { requirePermission } from '../rbac/permission.util';
import { AuthError, SessionService, type StaffContext } from '../auth/session.service';
import { MASK_SENTINEL } from '../masking/masking';

// WP-UI-03c read-only audit log. Gated by audit.read (super_admin/admin/finance hold it).
// The before/after blobs can carry ANY sensitive class, so only a full-visibility caller
// (pii AND health AND payment) sees them; everyone else gets the metadata + masked detail.
@Controller('audit')
export class AuditController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly audit: AuditQueryService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('entity_type') entityType?: string,
    @Query('severity') severity?: string,
    @Query('event_type') eventType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'audit.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    const full = grants.has('pii') && grants.has('health') && grants.has('payment');
    const rows = await this.audit.list({
      entityType, severity, eventType,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    const items = rows.map((r) => {
      if (full) return { ...r, masked: false };
      const hadDetail = r.before != null || r.after != null;
      return {
        ...r,
        before: r.before == null ? null : MASK_SENTINEL,
        after: r.after == null ? null : MASK_SENTINEL,
        masked: hadDetail,
      };
    });
    return { items, page: { limit: 100 } };
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
}
