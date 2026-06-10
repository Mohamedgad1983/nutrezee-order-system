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
