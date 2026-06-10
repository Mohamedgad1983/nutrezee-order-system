import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode,
  NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DraftError, DraftService, type DraftChannel, type DraftInput, type DraftState, type DraftUpdateInput } from './draft.service';
import { MessageRefError, type MessageRefInput } from '../m17-whatsapp/message-ref.service';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { TransitionError } from '../../platform/transition/transition-engine';
import { IdempotencyConflictError } from '../../platform/idempotency/idempotency.service';

const COOKIE = 'nz_session';

@Controller('drafts')
export class DraftController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly drafts: DraftService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: DraftBody,
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.create');
    if (!idempotencyKey) throw new BadRequestException({ error_code: 'idempotency_key_required' });
    return this.wrap(() => this.drafts.createDraft(ctx, this.inputFromBody(body), idempotencyKey));
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('state') state?: DraftState,
    @Query('channel') channel?: DraftChannel,
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.read');
    return { items: await this.drafts.listDrafts({ state, channel }), page: { limit: 100 } };
  }

  @Get('queues/incomplete')
  async incomplete(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.incomplete.read');
    return { items: await this.drafts.incompleteQueue(), page: { limit: 100 } };
  }

  @Post('aging-alerts')
  @HttpCode(200)
  async fireAgingAlerts(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.incomplete.read');
    return { alerted: await this.drafts.fireAgingAlerts(ctx) };
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.read');
    return this.wrap(() => this.drafts.getDraft(id));
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: DraftPatchBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.update');
    return this.wrap(async () => {
      await this.drafts.updateDraft(ctx, id, this.patchFromBody(body));
      return { ok: true };
    });
  }

  @Post(':id/whatsapp-ref')
  @HttpCode(200)
  async attachWhatsappRef(@Req() req: Request, @Param('id') id: string, @Body() body: WhatsappRefBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'whatsapp.ref.attach');
    return this.wrap(async () => {
      await this.drafts.attachWhatsappRef(ctx, id, this.whatsappFromBody(body));
      return { ok: true };
    });
  }

  @Post(':id/submit')
  @HttpCode(200)
  async submit(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.submit');
    return this.wrap(async () => {
      await this.drafts.submitDraft(ctx, id);
      return { ok: true };
    });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Req() req: Request, @Param('id') id: string, @Body() body: { reason_code?: string; note?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'draft.cancel');
    if (!body.reason_code) throw new BadRequestException({ error_code: 'validation_failed', field_errors: [{ field: 'reason_code', rule: 'required' }] });
    return this.wrap(async () => {
      await this.drafts.cancelDraft(ctx, id, body.reason_code as string, body.note);
      return { ok: true };
    });
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

  private inputFromBody(body: DraftBody): DraftInput {
    return {
      channel: body.channel as DraftChannel,
      customerId: body.customer_id,
      unverifiedCustomer: body.unverified_customer,
      unverifiedReason: body.unverified_reason,
      packageId: body.package_id,
      startDate: body.start_date,
      endDate: body.end_date,
      addressId: body.address_id,
      addressInline: body.address_inline,
      slotId: body.slot_id,
      methodId: body.method_id,
      couponCode: body.coupon_code,
      expectedPaymentMethod: body.expected_payment_method,
      priceEstimate: body.price_estimate,
      notes: body.notes,
      items: body.items?.map((i) => ({ productId: i.product_id, qty: i.qty, note: i.note })),
      whatsappRef: body.whatsapp_ref ? this.whatsappFromBody(body.whatsapp_ref) : undefined,
    };
  }

  private patchFromBody(body: DraftPatchBody): DraftUpdateInput {
    if (!Number.isInteger(body.version)) throw new BadRequestException({ error_code: 'validation_failed', field_errors: [{ field: 'version', rule: 'required' }] });
    return { ...this.inputFromBody(body), version: body.version as number };
  }

  private whatsappFromBody(body: WhatsappRefBody): MessageRefInput {
    return { senderPhone: body.sender_phone ?? '', messageAt: body.message_at ?? '', refNote: body.ref_note };
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DraftError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        if (e.code === 'conflict_stale' || e.code === 'idempotency_conflict') {
          throw new ConflictException({ error_code: e.code, detail: e.detail });
        }
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof MessageRefError) {
        if (e.code === 'already_attached') throw new ConflictException({ error_code: e.code });
        throw new BadRequestException({ error_code: e.code });
      }
      if (e instanceof TransitionError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
      if (e instanceof IdempotencyConflictError) throw new ConflictException({ error_code: e.code });
      throw e;
    }
  }
}

interface DraftBody {
  channel?: string;
  customer_id?: string;
  unverified_customer?: boolean;
  unverified_reason?: string;
  package_id?: string;
  start_date?: string;
  end_date?: string;
  address_id?: string;
  address_inline?: {
    label?: string;
    areaId?: string;
    addressText?: string;
    deliveryNotes?: string;
    contactPhone?: string;
  };
  slot_id?: string;
  method_id?: string;
  coupon_code?: string;
  expected_payment_method?: string;
  price_estimate?: number;
  notes?: string;
  items?: Array<{ product_id: string; qty?: number; note?: string }>;
  whatsapp_ref?: WhatsappRefBody;
}

interface DraftPatchBody extends DraftBody {
  version?: number;
}

interface WhatsappRefBody {
  sender_phone?: string;
  message_at?: string;
  ref_note?: string;
}
