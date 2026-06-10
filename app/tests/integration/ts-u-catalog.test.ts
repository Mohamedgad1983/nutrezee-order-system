import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let catalog: CatalogService;
const admin: StaffContext = { staffId: 'ad-1', name: 'AD', email: 'ad@t', locale: 'en', roles: ['admin'], sessionId: 's' };

async function seedAllergen(name: string): Promise<string> {
  const id = newId();
  await pool.query(`INSERT INTO allergen (id, name_en, name_ar) VALUES ($1,$2,$2)`, [id, name]);
  return id;
}
async function seedIngredient(name: string): Promise<string> {
  const id = newId();
  await pool.query(`INSERT INTO ingredient (id, name_en, name_ar) VALUES ($1,$2,$2)`, [id, name]);
  return id;
}

beforeAll(async () => {
  pool = await freshDb();
  catalog = new CatalogService(pool, new AuditService(), new SettingsReader(pool, 0));
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-U unit — mirror-mode write restriction (WP-05 DoD)', () => {
  it('admin product creation is BLOCKED while cutover_catalog is off; import path is allowed', async () => {
    await expect(catalog.createProduct(admin, { nameEn: 'Grilled Chicken', nameAr: 'دجاج مشوي' }))
      .rejects.toMatchObject({ code: 'mirror_mode' });
    const id = await catalog.createProduct(
      admin, { nameEn: 'Grilled Chicken', nameAr: 'دجاج مشوي' }, 'import',
    );
    const row = await pool.query('SELECT origin FROM product WHERE id = $1', [id]);
    expect(row.rows[0].origin).toBe('legacy'); // import-created rows carry origin=legacy
  });

  it('flipping the cutover flag opens admin creation; flipping back restores mirror mode', async () => {
    await pool.query(`UPDATE feature_flag SET on_flag = true WHERE key = 'cutover_catalog'`);
    const id = await catalog.createProduct(admin, { nameEn: 'New Era Salad', nameAr: 'سلطة' });
    const row = await pool.query('SELECT origin FROM product WHERE id = $1', [id]);
    expect(row.rows[0].origin).toBe('new');
    await pool.query(`UPDATE feature_flag SET on_flag = false WHERE key = 'cutover_catalog'`);
    await expect(catalog.createPackage(admin, { nameEn: 'P', nameAr: 'ب' }))
      .rejects.toMatchObject({ code: 'mirror_mode' });
  });

  it('enrichment (nutrition, allergens, routing) is always allowed in mirror mode', async () => {
    const pid = await catalog.createProduct(admin, { nameEn: 'Enrich Me', nameAr: 'إثراء' }, 'import');
    await catalog.setNutrition(admin, pid, { calories: 420, proteinG: 32.5 });
    const nf = await pool.query('SELECT calories FROM nutrition_facts WHERE product_id = $1', [pid]);
    expect(nf.rows[0].calories).toBe(420);
    const allergen = await seedAllergen('Sesame');
    await catalog.declareAllergen(admin, pid, allergen); // no mirror_mode error
  });
});

describe('TS-U unit — package parent cycle guard (C7)', () => {
  it('rejects a parent cycle at the database', async () => {
    const a = await catalog.createPackage(admin, { nameEn: 'A', nameAr: 'أ' }, 'import');
    const b = await catalog.createPackage(admin, { nameEn: 'B', nameAr: 'ب', parentPackageId: a }, 'import');
    await expect(pool.query('UPDATE package SET parent_package_id = $2 WHERE id = $1', [a, b]))
      .rejects.toThrow(/cycle/);
    await expect(pool.query('UPDATE package SET parent_package_id = $1 WHERE id = $1', [a]))
      .rejects.toThrow(/cycle/);
  });
});

describe('TS-U unit — allergen resolver (declared + derived, A6) (WP-05 DoD)', () => {
  it('resolves declared ∪ ingredient-derived, deduplicating toward declared', async () => {
    const pid = await catalog.createProduct(admin, { nameEn: 'Pad Thai', nameAr: 'باد تاي' }, 'import');
    const peanut = await seedAllergen('Peanut');
    const soy = await seedAllergen('Soy');
    const gluten = await seedAllergen('Gluten');

    // declared directly on the product
    await catalog.declareAllergen(admin, pid, peanut);
    // derived: noodles ingredient carries gluten + soy; peanut ALSO derivable (dedupes to declared)
    const noodles = await seedIngredient('Rice Noodles');
    const sauce = await seedIngredient('House Sauce');
    await pool.query(`INSERT INTO ingredient_allergen (id, ingredient_id, allergen_id) VALUES ($1,$2,$3)`, [newId(), noodles, gluten]);
    await pool.query(`INSERT INTO ingredient_allergen (id, ingredient_id, allergen_id) VALUES ($1,$2,$3)`, [newId(), sauce, soy]);
    await pool.query(`INSERT INTO ingredient_allergen (id, ingredient_id, allergen_id) VALUES ($1,$2,$3)`, [newId(), sauce, peanut]);
    await catalog.linkIngredient(admin, pid, noodles);
    await catalog.linkIngredient(admin, pid, sauce);

    const resolved = await catalog.resolveAllergens(pid);
    const bySource = Object.fromEntries(resolved.map((r) => [r.nameEn, r.source]));
    expect(bySource['Peanut']).toBe('declared');               // declared wins over derived
    expect(bySource['Gluten']).toBe('derived_from_ingredient');
    expect(bySource['Soy']).toBe('derived_from_ingredient');
    expect(resolved.length).toBe(3);                            // no duplicates
  });

  it('product with no links resolves empty (safe default for the allergy chain)', async () => {
    const pid = await catalog.createProduct(admin, { nameEn: 'Plain Rice', nameAr: 'أرز' }, 'import');
    expect(await catalog.resolveAllergens(pid)).toEqual([]);
  });
});

describe('TS-U unit — routing-rule admin (ADR-006: rules are data)', () => {
  it('adds a rule against a section and audits kitchen.routing_changed', async () => {
    const sectionId = newId();
    await pool.query(
      `INSERT INTO section_master (id, code, name_en, name_ar) VALUES ($1,'grill','Grill','مشاوي')`, [sectionId],
    );
    const pid = await catalog.createProduct(admin, { nameEn: 'Routed Kebab', nameAr: 'كباب' }, 'import');
    const ruleId = await catalog.addRoutingRule(admin, { scope: 'product', targetRef: pid, sectionId });
    const evt = await pool.query(
      `SELECT 1 FROM audit_event WHERE event_type = 'kitchen.routing_changed' AND entity_id = $1`, [ruleId],
    );
    expect(evt.rowCount).toBe(1);
  });
});
