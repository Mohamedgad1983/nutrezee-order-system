import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

export class CatalogError extends Error {
  constructor(readonly code: 'mirror_mode' | 'not_found' | 'validation_failed') {
    super(code);
  }
}

export interface ResolvedAllergen {
  allergenId: string;
  nameEn: string;
  source: 'declared' | 'derived_from_ingredient';
}

export interface ProductForOrder {
  id: string;
  nameEn: string;
  nameAr: string | null;
  price: number | null;
}

export interface PackageForOrder {
  id: string;
  nameEn: string;
  nameAr: string | null;
  durationDays: number | null;
  price: number | null;
}

export interface RoutingSectionForKitchen {
  sectionId: string;
  sectionCode: string;
  sectionNameEn: string;
}

// WP-API-01 read-API shapes (read-only browse over the catalog tables).
export interface ProductRow {
  id: string; code: string | null; nameEn: string; nameAr: string;
  mealTypeId: string | null; price: number | null; currency: string;
  active: boolean; origin: 'new' | 'legacy';
}
export interface PackageRow {
  id: string; nameEn: string; nameAr: string; parentPackageId: string | null;
  durationDays: number | null; mealsPerDay: number | null; price: number | null;
  currency: string; packageForId: string | null; active: boolean; origin: 'new' | 'legacy';
}
export interface MasterRow {
  id: string; nameEn: string; nameAr: string; active: boolean; origin: 'new' | 'legacy';
}
export interface AllergenRow extends MasterRow {
  defaultSeverity: 'note' | 'avoid' | 'severe' | null;
}
export interface NutritionRow {
  productId: string; calories: number | null;
  proteinG: number | null; carbsG: number | null; fatG: number | null;
  notesEn: string | null; notesAr: string | null;
}

// SQL-injection guard: master reads interpolate the table name, so the kind must be
// validated against this exact allow-list before any query (mirrors addMaster).
export const CATALOG_MASTER_KINDS = [
  'meal_type', 'diet_status', 'tag', 'package_for_type', 'ingredient', 'allergen',
] as const;
export type CatalogMasterKind = (typeof CATALOG_MASTER_KINDS)[number];

// M05 catalog. MIRROR MODE until catalog cutover (ADR-010 / legacy_transition §4):
// while cutover_catalog is OFF, core product/package creation is allowed only via
// the import path (M19); ENRICHMENT (nutrition, allergens, routing) is always open —
// that is exactly the WP-05 slice ("import + enrichment only until cutover").
export class CatalogService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly settings: SettingsReader,
  ) {}

  private async assertWritable(via: 'admin' | 'import'): Promise<void> {
    if (via === 'import') return;
    const { rows } = await this.pool.query(
      `SELECT on_flag FROM feature_flag WHERE key = 'cutover_catalog'`,
    );
    if (!rows[0]?.on_flag) throw new CatalogError('mirror_mode');
  }

  async createProduct(
    actor: StaffContext,
    p: { nameEn: string; nameAr: string; code?: string; mealTypeId?: string; price?: number; importBatchId?: string },
    via: 'admin' | 'import' = 'admin',
    client?: PoolClient,
  ): Promise<string> {
    await this.assertWritable(via);
    if (!p.nameEn || !p.nameAr) throw new CatalogError('validation_failed');
    const id = newId();
    const run = async (c: PoolClient) => {
      await c.query(
        `INSERT INTO product (id, code, name_en, name_ar, meal_type_id, price, origin, import_batch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, p.code ?? null, p.nameEn, p.nameAr, p.mealTypeId ?? null, p.price ?? null,
         via === 'import' ? 'legacy' : 'new', via === 'import' ? (p.importBatchId ?? null) : null, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed', // product changes audit WARN (data_ownership)
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'product', entityId: id, severity: 'warn',
        after: { name_en: p.nameEn, via },
      });
    };
    if (client) await run(client);
    else await withTransaction(this.pool, run);
    return id;
  }

  async createPackage(
    actor: StaffContext,
    p: { nameEn: string; nameAr: string; parentPackageId?: string; durationDays?: number; mealsPerDay?: number; price?: number; importBatchId?: string },
    via: 'admin' | 'import' = 'admin',
    client?: PoolClient,
  ): Promise<string> {
    await this.assertWritable(via);
    const id = newId();
    const run = async (c: PoolClient) => {
      await c.query(
        `INSERT INTO package (id, name_en, name_ar, parent_package_id, duration_days, meals_per_day, price, origin, import_batch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, p.nameEn, p.nameAr, p.parentPackageId ?? null, p.durationDays ?? null,
         p.mealsPerDay ?? null, p.price ?? null, via === 'import' ? 'legacy' : 'new',
         via === 'import' ? (p.importBatchId ?? null) : null, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'package', entityId: id, severity: 'warn',
        after: { name_en: p.nameEn, parent: p.parentPackageId ?? null, via },
      });
    };
    if (client) await run(client);
    else await withTransaction(this.pool, run);
    return id;
  }

  /** ENRICHMENT — always allowed in mirror mode (macros content work, GAP-DQ-02). */
  async setNutrition(
    actor: StaffContext, productId: string,
    n: { calories?: number; proteinG?: number; carbsG?: number; fatG?: number },
  ): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      await c.query(
        `INSERT INTO nutrition_facts (id, product_id, calories, protein_g, carbs_g, fat_g, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (product_id) DO UPDATE SET calories = EXCLUDED.calories,
           protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
           updated_at = now(), updated_by = $7, version = nutrition_facts.version + 1`,
        [newId(), productId, n.calories ?? null, n.proteinG ?? null, n.carbsG ?? null, n.fatG ?? null, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'nutrition_facts', entityId: productId, severity: 'warn', after: n,
      });
    });
  }

  /** ENRICHMENT: declared allergen link. */
  async declareAllergen(actor: StaffContext, productId: string, allergenId: string): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      await c.query(
        `INSERT INTO product_allergen (id, product_id, allergen_id, source, created_by)
         VALUES ($1,$2,$3,'declared',$4)
         ON CONFLICT (product_id, allergen_id) DO UPDATE SET source = 'declared'`,
        [newId(), productId, allergenId, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'product_allergen', entityId: `${productId}:${allergenId}`,
        severity: 'warn', after: { source: 'declared' },
      });
    });
  }

  async linkIngredient(actor: StaffContext, productId: string, ingredientId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO product_ingredient (id, product_id, ingredient_id, created_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [newId(), productId, ingredientId, actor.staffId],
    );
  }

  /** AllergenResolver: declared ∪ derived-from-ingredients (A6 link table).
   *  Feeds the allergy chain step 2 (DraftOrder.allergy_conflicts) and step 4
   *  (OrderItem.allergens_frozen) in later WPs. */
  async resolveAllergens(productId: string): Promise<ResolvedAllergen[]> {
    const { rows } = await this.pool.query(
      `SELECT a.id AS allergen_id, a.name_en, 'declared' AS source
         FROM product_allergen pa JOIN allergen a ON a.id = pa.allergen_id
         WHERE pa.product_id = $1 AND pa.source = 'declared'
       UNION
       SELECT a.id, a.name_en, 'derived_from_ingredient'
         FROM product_ingredient pi
         JOIN ingredient_allergen ia ON ia.ingredient_id = pi.ingredient_id
         JOIN allergen a ON a.id = ia.allergen_id
         WHERE pi.product_id = $1
           AND a.id NOT IN (SELECT allergen_id FROM product_allergen
                            WHERE product_id = $1 AND source = 'declared')
       ORDER BY 2`,
      [productId],
    );
    return rows.map((r) => ({ allergenId: r.allergen_id, nameEn: r.name_en, source: r.source }));
  }

  /** Read API for M01: validate item references without allowing M01 table reads. */
  async productExists(productId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM product WHERE id = $1 AND active`,
      [productId],
    );
    return rows.length > 0;
  }

  /** Read API for M01: package selection is captured at intake; calendar expansion
   * waits for WP-09. */
  async packageExists(packageId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM package WHERE id = $1 AND active`,
      [packageId],
    );
    return rows.length > 0;
  }

  async productForOrder(productId: string): Promise<ProductForOrder | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name_en, name_ar, price FROM product WHERE id = $1 AND active`,
      [productId],
    );
    if (rows.length === 0) return null;
    return {
      id: rows[0].id as string,
      nameEn: rows[0].name_en as string,
      nameAr: rows[0].name_ar as string | null,
      price: rows[0].price === null ? null : Number(rows[0].price),
    };
  }

  async packageForOrder(packageId: string): Promise<PackageForOrder | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name_en, name_ar, duration_days, price FROM package WHERE id = $1 AND active`,
      [packageId],
    );
    if (rows.length === 0) return null;
    return {
      id: rows[0].id as string,
      nameEn: rows[0].name_en as string,
      nameAr: rows[0].name_ar as string | null,
      durationDays: rows[0].duration_days === null ? null : Number(rows[0].duration_days),
      price: rows[0].price === null ? null : Number(rows[0].price),
    };
  }

  // --- WP-API-01 read-only browse API (catalog.read) ---------------------------
  // Reads are always allowed (mirror mode only gates writes — assertWritable).

  // Exposed so the controller can echo the effective limit in the page contract.
  static page(opts?: { limit?: number; offset?: number }): { limit: number; offset: number } {
    const rawLimit = Number(opts?.limit);
    const rawOffset = Number(opts?.offset);
    const limit = Math.min(Math.max(Math.trunc(Number.isFinite(rawLimit) ? rawLimit : 100), 1), 200);
    const offset = Math.max(Math.trunc(Number.isFinite(rawOffset) ? rawOffset : 0), 0);
    return { limit, offset };
  }

  async listProducts(opts?: { activeOnly?: boolean; limit?: number; offset?: number }): Promise<ProductRow[]> {
    const { limit, offset } = CatalogService.page(opts);
    const { rows } = await this.pool.query(
      `SELECT id, code, name_en, name_ar, meal_type_id, price, currency, active, origin
       FROM product ${opts?.activeOnly ? 'WHERE active' : ''}
       ORDER BY name_en LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map((r) => CatalogService.toProductRow(r));
  }

  async getProduct(productId: string): Promise<ProductRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, code, name_en, name_ar, meal_type_id, price, currency, active, origin
       FROM product WHERE id = $1`,
      [productId],
    );
    return rows.length === 0 ? null : CatalogService.toProductRow(rows[0]);
  }

  async listPackages(opts?: { activeOnly?: boolean; limit?: number; offset?: number }): Promise<PackageRow[]> {
    const { limit, offset } = CatalogService.page(opts);
    const { rows } = await this.pool.query(
      `SELECT id, name_en, name_ar, parent_package_id, duration_days, meals_per_day,
              price, currency, package_for_id, active, origin
       FROM package ${opts?.activeOnly ? 'WHERE active' : ''}
       ORDER BY name_en LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map((r) => CatalogService.toPackageRow(r));
  }

  async getPackage(packageId: string): Promise<PackageRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name_en, name_ar, parent_package_id, duration_days, meals_per_day,
              price, currency, package_for_id, active, origin
       FROM package WHERE id = $1`,
      [packageId],
    );
    return rows.length === 0 ? null : CatalogService.toPackageRow(rows[0]);
  }

  async listMasters(kind: CatalogMasterKind): Promise<MasterRow[]> {
    if (!CATALOG_MASTER_KINDS.includes(kind)) throw new CatalogError('validation_failed');
    const { rows } = await this.pool.query(
      `SELECT id, name_en, name_ar, active, origin FROM ${kind} ORDER BY name_en`,
    );
    return rows.map((r) => ({
      id: r.id as string, nameEn: r.name_en as string, nameAr: r.name_ar as string,
      active: r.active as boolean, origin: r.origin as 'new' | 'legacy',
    }));
  }

  async listAllergens(): Promise<AllergenRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name_en, name_ar, default_severity, active, origin FROM allergen ORDER BY name_en`,
    );
    return rows.map((r) => ({
      id: r.id as string, nameEn: r.name_en as string, nameAr: r.name_ar as string,
      defaultSeverity: r.default_severity as AllergenRow['defaultSeverity'],
      active: r.active as boolean, origin: r.origin as 'new' | 'legacy',
    }));
  }

  async getNutrition(productId: string): Promise<NutritionRow | null> {
    const { rows } = await this.pool.query(
      `SELECT product_id, calories, protein_g, carbs_g, fat_g, notes_en, notes_ar
       FROM nutrition_facts WHERE product_id = $1`,
      [productId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      productId: r.product_id as string,
      calories: r.calories === null ? null : Number(r.calories),
      proteinG: r.protein_g === null ? null : Number(r.protein_g),
      carbsG: r.carbs_g === null ? null : Number(r.carbs_g),
      fatG: r.fat_g === null ? null : Number(r.fat_g),
      notesEn: r.notes_en as string | null, notesAr: r.notes_ar as string | null,
    };
  }

  private static toProductRow(r: Record<string, unknown>): ProductRow {
    return {
      id: r.id as string, code: r.code as string | null,
      nameEn: r.name_en as string, nameAr: r.name_ar as string,
      mealTypeId: r.meal_type_id as string | null,
      price: r.price === null ? null : Number(r.price),
      currency: r.currency as string, active: r.active as boolean,
      origin: r.origin as 'new' | 'legacy',
    };
  }

  private static toPackageRow(r: Record<string, unknown>): PackageRow {
    return {
      id: r.id as string, nameEn: r.name_en as string, nameAr: r.name_ar as string,
      parentPackageId: r.parent_package_id as string | null,
      durationDays: r.duration_days === null ? null : Number(r.duration_days),
      mealsPerDay: r.meals_per_day === null ? null : Number(r.meals_per_day),
      price: r.price === null ? null : Number(r.price),
      currency: r.currency as string, packageForId: r.package_for_id as string | null,
      active: r.active as boolean, origin: r.origin as 'new' | 'legacy',
    };
  }

  async packageByNameInTx(client: PoolClient, nameEn: string): Promise<PackageForOrder | null> {
    const { rows } = await client.query(
      `SELECT id, name_en, name_ar, duration_days, price
       FROM package WHERE lower(name_en) = lower($1) AND active
       ORDER BY created_at DESC LIMIT 1`,
      [nameEn],
    );
    if (rows.length === 0) return null;
    return {
      id: rows[0].id as string,
      nameEn: rows[0].name_en as string,
      nameAr: rows[0].name_ar as string | null,
      durationDays: rows[0].duration_days === null ? null : Number(rows[0].duration_days),
      price: rows[0].price === null ? null : Number(rows[0].price),
    };
  }

  async routingForKitchenProduct(productId: string): Promise<RoutingSectionForKitchen | null> {
    const { rows } = await this.pool.query(
      `SELECT s.id AS section_id, s.code, s.name_en
       FROM routing_rule rr
       JOIN section_master s ON s.id = rr.section_id AND s.active
       WHERE rr.scope = 'product' AND rr.target_ref = $1 AND rr.active
       ORDER BY rr.effective_from DESC NULLS LAST, rr.created_at DESC
       LIMIT 1`,
      [productId],
    );
    if (rows.length === 0) return null;
    return {
      sectionId: rows[0].section_id as string,
      sectionCode: rows[0].code as string,
      sectionNameEn: rows[0].name_en as string,
    };
  }

  /** Import path for bilingual masters (M19 calls this — ADR-010): match-or-create
   *  by name within the CALLER's transaction. */
  async importMaster(
    client: PoolClient,
    table: 'meal_type' | 'diet_status' | 'tag' | 'package_for_type' | 'ingredient' | 'allergen',
    nameEn: string,
    nameAr: string,
    batchId: string,
  ): Promise<{ id: string; matched: boolean }> {
    const found = await client.query(`SELECT id FROM ${table} WHERE lower(name_en) = lower($1)`, [nameEn]);
    if (found.rowCount && found.rowCount > 0) return { id: found.rows[0].id, matched: true };
    const id = newId();
    await client.query(
      `INSERT INTO ${table} (id, name_en, name_ar, origin, import_batch_id, created_by)
       VALUES ($1,$2,$3,'legacy',$4,'import')`,
      [id, nameEn, nameAr, batchId],
    );
    return { id, matched: false };
  }

  /** M19 rollback port (ADR-010): deletes THIS module's rows for an import batch —
   *  product/package children first, then parents and bilingual masters. */
  async rollbackImportedBatchInTx(client: PoolClient, batchId: string): Promise<string[]> {
    for (const table of ['nutrition_facts', 'product_allergen', 'product_ingredient', 'product_component']) {
      await client.query(
        `DELETE FROM ${table} WHERE product_id IN (SELECT id FROM product WHERE import_batch_id = $1)`,
        [batchId],
      );
    }
    const refs: string[] = [];
    for (const table of ['package', 'product', 'meal_type', 'diet_status', 'tag', 'package_for_type', 'ingredient', 'allergen']) {
      const del = await client.query(`DELETE FROM ${table} WHERE import_batch_id = $1 RETURNING id`, [batchId]);
      refs.push(...del.rows.map((r) => r.id as string));
    }
    return refs;
  }

  /** Routing-rule admin (ADR-006: rules are data; kitchen.routing_changed audit). */
  async addRoutingRule(
    actor: StaffContext,
    r: { scope: 'product' | 'component' | 'meal_type'; targetRef: string; sectionId: string },
  ): Promise<string> {
    const id = newId();
    await withTransaction(this.pool, async (c) => {
      await c.query(
        `INSERT INTO routing_rule (id, scope, target_ref, section_id, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, r.scope, r.targetRef, r.sectionId, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'kitchen.routing_changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'routing_rule', entityId: id, severity: 'warn',
        after: { scope: r.scope, target: r.targetRef, section: r.sectionId },
      });
    });
    return id;
  }
}
