import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CATALOG_MASTER_KINDS, CatalogError, CatalogService, type CatalogMasterKind,
} from './catalog.service';

interface PageQuery { active?: string; limit?: string; offset?: string }
function pageOpts(q: PageQuery): { activeOnly: boolean; limit?: number; offset?: number } {
  return {
    activeOnly: q.active === 'true',
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  };
}
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';

// M05 catalog read-only HTTP surface (WP-API-01). Reads are always allowed — mirror
// mode (assertWritable) gates only writes, which this controller never exposes (admin
// catalog mutation stays import-only until cutover_catalog flips). All routes are GET
// and require catalog.read. Responses are camelCase typed rows (CatalogService *Row).
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly sessions: SessionService,
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
  ) {}

  @Get('products')
  async listProducts(
    @Req() req: Request,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.authorize(req);
    const opts = pageOpts({ active, limit, offset });
    const items = await this.catalog.listProducts(opts);
    return { items, page: { limit: CatalogService.page(opts).limit } };
  }

  @Get('products/:id')
  async getProduct(@Req() req: Request, @Param('id') id: string) {
    await this.authorize(req);
    const product = await this.catalog.getProduct(id);
    if (!product) throw new NotFoundException({ error_code: 'not_found' });
    return product;
  }

  @Get('products/:id/nutrition')
  async getNutrition(@Req() req: Request, @Param('id') id: string) {
    await this.authorize(req);
    return { item: await this.catalog.getNutrition(id) };
  }

  @Get('products/:id/allergens')
  async productAllergens(@Req() req: Request, @Param('id') id: string) {
    await this.authorize(req);
    return { items: await this.catalog.resolveAllergens(id) };
  }

  @Get('packages')
  async listPackages(
    @Req() req: Request,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.authorize(req);
    const opts = pageOpts({ active, limit, offset });
    const items = await this.catalog.listPackages(opts);
    return { items, page: { limit: CatalogService.page(opts).limit } };
  }

  @Get('packages/:id')
  async getPackage(@Req() req: Request, @Param('id') id: string) {
    await this.authorize(req);
    const pkg = await this.catalog.getPackage(id);
    if (!pkg) throw new NotFoundException({ error_code: 'not_found' });
    return pkg;
  }

  @Get('allergens')
  async listAllergens(@Req() req: Request) {
    await this.authorize(req);
    return { items: await this.catalog.listAllergens() };
  }

  @Get('masters/:kind')
  async listMasters(@Req() req: Request, @Param('kind') kind: string) {
    await this.authorize(req);
    if (!CATALOG_MASTER_KINDS.includes(kind as CatalogMasterKind)) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'kind' });
    }
    try {
      return { items: await this.catalog.listMasters(kind as CatalogMasterKind) };
    } catch (e) {
      if (e instanceof CatalogError) throw new BadRequestException({ error_code: e.code });
      throw e;
    }
  }

  // WP-UI-04 enrichment write. Nutrition is an ENRICHMENT path — it bypasses mirror
  // mode (no assertWritable), so it works while catalog stays import-only. Gated by
  // catalog.enrich (super_admin/admin/ops_manager). Upsert per product.
  @Post('products/:id/nutrition')
  @HttpCode(200)
  async setNutrition(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'catalog.enrich');
    if (!(await this.catalog.getProduct(id))) throw new NotFoundException({ error_code: 'not_found' });
    const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));
    await this.catalog.setNutrition(ctx, id, {
      calories: num(body.calories), proteinG: num(body.protein_g), carbsG: num(body.carbs_g), fatG: num(body.fat_g),
    });
    return { ok: true };
  }

  // WP-UI-04b: declare an allergen on a product (enrichment, bypasses mirror mode).
  // POST coexists with GET products/:id/allergens (different method). catalog.enrich.
  @Post('products/:id/allergens')
  @HttpCode(200)
  async declareAllergen(@Req() req: Request, @Param('id') id: string, @Body() body: { allergen_id?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'catalog.enrich');
    if (!body?.allergen_id) throw new BadRequestException({ error_code: 'validation_failed', field: 'allergen_id' });
    if (!(await this.catalog.getProduct(id))) throw new NotFoundException({ error_code: 'not_found' });
    await this.catalog.declareAllergen(ctx, id, body.allergen_id);
    return { ok: true };
  }

  private async authorize(req: Request): Promise<StaffContext> {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'catalog.read');
    return ctx;
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
