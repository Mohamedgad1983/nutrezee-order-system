import {
  BadRequestException, Body, Controller, ConflictException, Get, HttpCode,
  NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CustomerError, CustomerService } from './customer.service';
import { MergeError, MergeService } from './merge.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { maskFields } from '../../platform/masking/masking';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';

// M04 customer HTTP surface (WP-API-01). Fulfils the WP-04 register note "HTTP
// surface consolidates at WP-07" that WP-07 left undelivered. Read endpoints are
// PII/health masked at serialization (api_standards rule 4); health is gated by the
// caller's 'health' visibility grant, never by a client flag. Mutations are POST/
// PATCH only (guardrail 1). Merge/undo (WP-API-02) re-parent child rows + re-link
// draft_order/customer_order FKs via MergeService's registered steps, deactivate the
// loser, and restore on undo within merge_undo_days (customer.merge, ops-only).
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly sessions: SessionService,
    private readonly customers: CustomerService,
    private readonly access: AccessService,
    private readonly merges: MergeService,
  ) {}

  @Get()
  async search(@Req() req: Request, @Query('phone') phone?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.read');
    if (!phone) throw new BadRequestException({ error_code: 'validation_failed', field: 'phone' });
    const grants = await this.access.visibilityGrants(ctx.roles);
    const rows = await this.wrap(() => this.customers.searchByPhone(phone));
    const items = rows.map((r) => {
      const { data, masked } = maskFields(r, { full_name_en: 'pii', phone_normalized: 'pii' }, grants);
      return { ...data, masked };
    });
    return { items, page: { limit: 100 } };
  }

  @Get(':id')
  async profile(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    const includeHealth = grants.has('health');
    const profile = await this.wrap(() => this.customers.getProfile(ctx, id, includeHealth));
    // getProfile returns the raw customer row (SELECT *) + nested phones/addresses/
    // allergies. Mask every PII/HEALTH column the row carries — the customer table
    // has name/email/dob/notes (PII) and diet_status_id (HEALTH, schema 0003).
    const { data, masked } = maskFields(
      profile as Record<string, unknown>,
      {
        full_name_en: 'pii', full_name_ar: 'pii', email: 'pii', dob: 'pii', notes: 'pii',
        diet_status_id: 'health',
      },
      grants,
    );
    let nestedMasked = false;
    const maskRows = (rows: unknown, classes: Record<string, 'pii' | 'health' | 'payment'>): unknown => {
      if (!Array.isArray(rows)) return rows;
      return (rows as Record<string, unknown>[]).map((row) => {
        const r = maskFields(row, classes, grants);
        nestedMasked = nestedMasked || r.masked;
        return r.data;
      });
    };
    const phones = maskRows((data as { phones?: unknown }).phones, { phone_normalized: 'pii' });
    const addresses = maskRows((data as { addresses?: unknown }).addresses, {
      address_text: 'pii', delivery_notes: 'pii',
    });
    return { ...data, phones, addresses, masked: masked || nestedMasked };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Body() body: {
      full_name_en?: string; full_name_ar?: string; email?: string; dob?: string;
      language?: 'en' | 'ar'; phone?: string; phone_label?: string; whatsapp?: boolean; force?: boolean;
    },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.create');
    if (!body?.full_name_en || !body?.phone) {
      throw new BadRequestException({
        error_code: 'validation_failed',
        field_errors: [{ field: 'full_name_en|phone', rule: 'required' }],
      });
    }
    const id = await this.wrap(() =>
      this.customers.createGuided(ctx, {
        fullNameEn: body.full_name_en as string, fullNameAr: body.full_name_ar,
        email: body.email, dob: body.dob, language: body.language,
        phone: body.phone as string, phoneLabel: body.phone_label,
        whatsapp: body.whatsapp, force: body.force,
      }),
    );
    return { id };
  }

  // WP-API-02 merge/undo. Static literal routes, declared before the @Patch(':id') and
  // @Post(':id/...') param routes (NestJS matches in order; the settings reason-codes
  // shadow bug was exactly this). ops-only via customer.merge (super_admin/ops_manager).
  @Post('merge')
  @HttpCode(201)
  async merge(@Req() req: Request, @Body() body: { winner_id?: string; loser_id?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.merge');
    if (!body?.winner_id || !body?.loser_id) {
      throw new BadRequestException({ error_code: 'validation_failed', field_errors: [{ field: 'winner_id|loser_id', rule: 'required' }] });
    }
    const id = await this.wrap(() => this.merges.merge(ctx, body.winner_id as string, body.loser_id as string));
    return { id };
  }

  @Post('merge/:id/undo')
  @HttpCode(200)
  async undoMerge(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.merge');
    await this.wrap(() => this.merges.undo(ctx, id));
    return { ok: true };
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { full_name_en?: string; full_name_ar?: string; email?: string; dob?: string; language?: 'en' | 'ar'; notes?: string },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.update');
    await this.wrap(() =>
      this.customers.update(ctx, id, {
        fullNameEn: body.full_name_en, fullNameAr: body.full_name_ar, email: body.email,
        dob: body.dob, language: body.language, notes: body.notes,
      }),
    );
    return { ok: true };
  }

  @Post(':id/addresses')
  @HttpCode(201)
  async addAddress(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { label?: string; area_id?: string; address_text?: string; delivery_notes?: string },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'customer.update');
    if (!body?.address_text) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'address_text' });
    }
    const addressId = await this.wrap(() =>
      this.customers.addAddress(ctx, id, {
        label: body.label, areaId: body.area_id,
        addressText: body.address_text as string, deliveryNotes: body.delivery_notes,
      }),
    );
    return { id: addressId };
  }

  @Post(':id/allergies')
  @HttpCode(200)
  async setAllergy(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { allergen_id?: string; severity?: 'note' | 'avoid' | 'severe'; note?: string },
  ) {
    const ctx = await this.ctx(req);
    // Allergy is health data — require the health-write grant (customer.health.update).
    await requirePermission(this.access, ctx, 'customer.health.update');
    if (!body?.allergen_id) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'allergen_id' });
    }
    await this.wrap(() =>
      this.customers.setAllergy(ctx, id, {
        allergenId: body.allergen_id as string, severity: body.severity, note: body.note,
      }),
    );
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
      if (e instanceof CustomerError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        if (e.code === 'duplicate_phone' || e.code === 'possible_duplicate') {
          throw new ConflictException({ error_code: e.code, detail: e.detail });
        }
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof MergeError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code });
        if (e.code === 'already_undone') throw new ConflictException({ error_code: e.code });
        throw new BadRequestException({ error_code: e.code }); // self_merge | undo_expired
      }
      throw e;
    }
  }
}
