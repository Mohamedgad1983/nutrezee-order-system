import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SettingsError, SettingsService } from './settings.service';
import { AccessService } from '../rbac/access.service';
import { requirePermission } from '../rbac/permission.util';
import { AuthError, SessionService, type StaffContext } from '../auth/session.service';

// Allow-list for addMaster: the service interpolates the table name into SQL, so the
// controller MUST validate `kind` against exactly these four ops-master tables.
const MASTER_KINDS = ['section_master', 'area', 'delivery_slot', 'delivery_method'] as const;
type MasterKind = (typeof MASTER_KINDS)[number];

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

  // WP-API-01: ops-master + reason-code admin. addMaster/addReasonCode exist on the
  // service since WP-03 but had no route. Ordinary (non-gate) mutations → settings.update.ops.
  @Post('masters/:kind')
  @HttpCode(201)
  async addMaster(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Body() body: { columns?: Record<string, unknown> },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'settings.update.ops');
    // The service interpolates `kind` into `INSERT INTO ${table}` — whitelist it here.
    if (!MASTER_KINDS.includes(kind as MasterKind)) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'kind' });
    }
    const columns = body?.columns;
    if (!columns || typeof columns !== 'object' || Object.keys(columns).length === 0) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'columns' });
    }
    // addMaster interpolates the column KEYS into SQL as identifiers — a crafted key
    // is a second-order injection vector. Reject anything that is not a plain
    // snake_case identifier before it can reach the query.
    for (const key of Object.keys(columns)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        throw new BadRequestException({ error_code: 'validation_failed', field: 'columns', detail: { invalid_key: key } });
      }
    }
    const id = await this.wrap(() => this.settings.addMaster(ctx, kind as MasterKind, columns as Record<string, unknown>));
    return { id };
  }

  @Post('reason-codes')
  @HttpCode(201)
  async addReasonCode(
    @Req() req: Request,
    @Body() body: { domain?: string; code?: string; label_en?: string; label_ar?: string },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'settings.update.ops');
    if (!body?.domain || !body?.code || !body?.label_en) {
      throw new BadRequestException({
        error_code: 'validation_failed',
        field_errors: [{ field: 'domain|code|label_en', rule: 'required' }],
      });
    }
    await this.wrap(() => this.settings.addReasonCode(ctx, body.domain as string, body.code as string, body.label_en as string, body.label_ar));
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
