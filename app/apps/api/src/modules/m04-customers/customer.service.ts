import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditReadQueue, AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { normalizePhone } from './phone';

export class CustomerError extends Error {
  constructor(
    readonly code: 'duplicate_phone' | 'possible_duplicate' | 'not_found' | 'validation_failed',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface GuidedCreateInput {
  fullNameEn: string;
  fullNameAr?: string;
  email?: string;
  dob?: string;
  language?: 'en' | 'ar';
  phone: string;        // required at guided creation (DEC-004 matching key [A])
  phoneLabel?: string;
  whatsapp?: boolean;
  /** confirm past a fuzzy name+dob warning (GAP-ADM-01: warn + confirm) */
  force?: boolean;
}

export interface CustomerAllergyForIntake {
  allergenId: string;
  severity: 'note' | 'avoid' | 'severe' | null;
  note: string | null;
}

export interface CustomerAddressForIntake {
  id: string;
  customerId: string;
  areaId: string | null;
  active: boolean;
}

// M04 customer profiles: guided create with dup detection (GAP-DQ-01), phone-first
// search, profile reads logged per visibility class (BR-043 via the read queue).
export class CustomerService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly readQueue: AuditReadQueue,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsReader,
  ) {}

  async normalize(raw: string): Promise<string> {
    const cc = await this.settings.get<string>('default_phone_country_code', '+966');
    return normalizePhone(raw, cc);
  }

  async searchByPhone(raw: string): Promise<Array<Record<string, unknown>>> {
    const normalized = await this.normalize(raw);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.full_name_en, c.status, p.phone_normalized, p.is_primary
       FROM customer_phone p JOIN customer c ON c.id = p.customer_id
       WHERE p.phone_normalized = $1`,
      [normalized],
    );
    return rows;
  }

  /** Guided creation: exact-phone duplicate blocks with a link to the existing
   *  profile; fuzzy name+dob match warns and requires force (validation binding §1). */
  async createGuided(actor: StaffContext, input: GuidedCreateInput): Promise<string> {
    if (!input.fullNameEn || !input.phone) throw new CustomerError('validation_failed');
    const normalized = await this.normalize(input.phone);

    const exact = await this.pool.query(
      `SELECT c.id FROM customer_phone p JOIN customer c ON c.id = p.customer_id
       WHERE p.phone_normalized = $1 AND c.status = 'active'`,
      [normalized],
    );
    if (exact.rowCount && exact.rowCount > 0) {
      throw new CustomerError('duplicate_phone', { existing_customer_id: exact.rows[0].id });
    }
    if (!input.force) {
      const fuzzy = await this.pool.query(
        `SELECT id FROM customer
         WHERE lower(full_name_en) = lower($1)
           AND ($2::date IS NULL OR dob = $2::date) AND status = 'active'`,
        [input.fullNameEn, input.dob ?? null],
      );
      if (fuzzy.rowCount && fuzzy.rowCount > 0) {
        throw new CustomerError('possible_duplicate', { candidates: fuzzy.rows.map((r) => r.id) });
      }
    }

    const id = newId();
    await withTransaction(this.pool, async (c) => {
      await c.query(
        `INSERT INTO customer (id, full_name_en, full_name_ar, email, dob, language, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, input.fullNameEn, input.fullNameAr ?? null, input.email ?? null,
         input.dob ?? null, input.language ?? 'en', actor.staffId],
      );
      await c.query(
        `INSERT INTO customer_phone (id, customer_id, phone_normalized, phone_raw, label, is_primary, whatsapp, created_by)
         VALUES ($1,$2,$3,$4,$5,true,$6,$7)`,
        [newId(), id, normalized, input.phone, input.phoneLabel ?? null, input.whatsapp ?? false, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'customer.created',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'customer', entityId: id, severity: 'info',
        after: { full_name_en: input.fullNameEn, phone: normalized, forced_past_fuzzy: input.force === true },
      });
      await this.outbox.writeInTx(c, {
        eventType: 'customer.created',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { customer: id }, payload: { origin: 'new' },
      });
    });
    return id;
  }

  /** Full profile read — PII panel: read-logged via the async-tolerant queue;
   *  allergies included only when the caller has the health permission, logged too. */
  async getProfile(actor: StaffContext, customerId: string, includeHealth: boolean) {
    const { rows } = await this.pool.query('SELECT * FROM customer WHERE id = $1', [customerId]);
    if (rows.length === 0) throw new CustomerError('not_found');
    const phones = await this.pool.query(
      'SELECT phone_normalized, label, is_primary, whatsapp FROM customer_phone WHERE customer_id = $1',
      [customerId],
    );
    const addresses = await this.pool.query(
      'SELECT id, label, area_id, address_text, delivery_notes, active FROM address WHERE customer_id = $1',
      [customerId],
    );
    await this.readQueue.enqueue({
      eventType: 'customer.pii_viewed',
      actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      entityType: 'customer', entityId: customerId, severity: 'info',
    });
    let allergies: unknown[] | undefined;
    if (includeHealth) {
      allergies = (
        await this.pool.query(
          `SELECT a.name_en, ca.severity, ca.note FROM customer_allergy ca
           JOIN allergen a ON a.id = ca.allergen_id WHERE ca.customer_id = $1`,
          [customerId],
        )
      ).rows;
      await this.readQueue.enqueue({
        eventType: 'customer.health_viewed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'customer', entityId: customerId, severity: 'info',
      });
    }
    return { ...rows[0], phones: phones.rows, addresses: addresses.rows, allergies };
  }

  async addAddress(
    actor: StaffContext, customerId: string,
    a: { label?: string; areaId?: string; addressText: string; deliveryNotes?: string },
  ): Promise<string> {
    const id = newId();
    await withTransaction(this.pool, async (c) => {
      await this.assertExists(c, customerId);
      await c.query(
        `INSERT INTO address (id, customer_id, label, area_id, address_text, delivery_notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, customerId, a.label ?? null, a.areaId ?? null, a.addressText, a.deliveryNotes ?? null, actor.staffId],
      );
      await this.auditUpdate(c, actor, customerId, undefined, { address_added: id });
    });
    return id;
  }

  async setAllergy(
    actor: StaffContext, customerId: string,
    in_: { allergenId: string; severity?: 'note' | 'avoid' | 'severe'; note?: string },
  ): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      await this.assertExists(c, customerId);
      await c.query(
        `INSERT INTO customer_allergy (id, customer_id, allergen_id, severity, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (customer_id, allergen_id)
         DO UPDATE SET severity = EXCLUDED.severity, note = EXCLUDED.note`,
        [newId(), customerId, in_.allergenId, in_.severity ?? null, in_.note ?? null, actor.staffId],
      );
      await this.auditUpdate(c, actor, customerId, undefined, {
        allergy_set: in_.allergenId, severity: in_.severity ?? null,
      });
    });
  }

  async update(
    actor: StaffContext, customerId: string,
    patch: Partial<{ fullNameEn: string; fullNameAr: string; email: string; dob: string; language: 'en' | 'ar'; notes: string }>,
  ): Promise<void> {
    const cols: Record<string, string> = {
      fullNameEn: 'full_name_en', fullNameAr: 'full_name_ar', email: 'email',
      dob: 'dob', language: 'language', notes: 'notes',
    };
    await withTransaction(this.pool, async (c) => {
      const existing = await this.assertExists(c, customerId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const sets = ['updated_at = now()', 'updated_by = $2', 'version = version + 1'];
      const params: unknown[] = [customerId, actor.staffId];
      for (const [k, col] of Object.entries(cols)) {
        const v = (patch as Record<string, unknown>)[k];
        if (v === undefined) continue;
        params.push(v);
        sets.push(`${col} = $${params.length}`);
        before[col] = existing[col];
        after[col] = v;
      }
      await c.query(`UPDATE customer SET ${sets.join(', ')} WHERE id = $1`, params);
      await this.auditUpdate(c, actor, customerId, before, after);
    });
  }

  /** Import path (M19 calls this — ADR-010: imports go through the owning module).
   *  Runs inside the CALLER's transaction; origin=legacy + batch stamp; no dup checks
   *  here — the import pipeline decides created/matched/merge_review before calling. */
  async createImported(
    client: PoolClient,
    input: { fullNameEn: string; fullNameAr?: string; email?: string; dob?: string; phoneNormalized?: string; phoneRaw?: string },
    batchId: string,
  ): Promise<string> {
    const id = newId();
    await client.query(
      `INSERT INTO customer (id, full_name_en, full_name_ar, email, dob, origin, import_batch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'legacy',$6,'import')`,
      [id, input.fullNameEn, input.fullNameAr ?? null, input.email ?? null, input.dob ?? null, batchId],
    );
    if (input.phoneNormalized) {
      await client.query(
        `INSERT INTO customer_phone (id, customer_id, phone_normalized, phone_raw, is_primary, origin, import_batch_id, created_by)
         VALUES ($1,$2,$3,$4,true,'legacy',$5,'import')`,
        [newId(), id, input.phoneNormalized, input.phoneRaw ?? null, batchId],
      );
    }
    return id;
  }

  /** Exact-phone lookup against ACTIVE customers (import dedup step 1). */
  async findActiveByPhone(client: PoolClient, phoneNormalized: string): Promise<string | null> {
    const { rows } = await client.query(
      `SELECT c.id FROM customer_phone p JOIN customer c ON c.id = p.customer_id
       WHERE p.phone_normalized = $1 AND c.status = 'active' LIMIT 1`,
      [phoneNormalized],
    );
    return rows.length > 0 ? (rows[0].id as string) : null;
  }

  /** Fuzzy name+dob candidates (import dedup step 2 — merge_review, never auto-merge). */
  async findFuzzy(client: PoolClient, fullNameEn: string, dob?: string): Promise<string[]> {
    const { rows } = await client.query(
      `SELECT id FROM customer
       WHERE lower(full_name_en) = lower($1)
         AND ($2::date IS NULL OR dob = $2::date) AND status = 'active'`,
      [fullNameEn, dob ?? null],
    );
    return rows.map((r) => r.id as string);
  }

  /** Read API for M01/M02: confirms customer reference without exposing profile. */
  async exists(customerId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM customer WHERE id = $1 AND status = 'active'`,
      [customerId],
    );
    return rows.length > 0;
  }

  /** Read API for M01: validates a saved address selection and exposes only the
   * fields required for intake completeness (area + active). */
  async getAddressForIntake(addressId: string, customerId?: string): Promise<CustomerAddressForIntake | null> {
    const { rows } = await this.pool.query(
      `SELECT id, customer_id, area_id, active FROM address
       WHERE id = $1 AND ($2::text IS NULL OR customer_id = $2)`,
      [addressId, customerId ?? null],
    );
    if (rows.length === 0) return null;
    return {
      id: rows[0].id as string,
      customerId: rows[0].customer_id as string,
      areaId: rows[0].area_id as string | null,
      active: rows[0].active as boolean,
    };
  }

  /** Read API for allergy chain step 2. This is validation, not a full health panel;
   * UI profile reads remain logged through getProfile(includeHealth=true). */
  async allergiesForIntake(customerId: string): Promise<CustomerAllergyForIntake[]> {
    const { rows } = await this.pool.query(
      `SELECT allergen_id, severity, note FROM customer_allergy WHERE customer_id = $1`,
      [customerId],
    );
    return rows.map((r) => ({
      allergenId: r.allergen_id as string,
      severity: r.severity as CustomerAllergyForIntake['severity'],
      note: r.note as string | null,
    }));
  }

  private async assertExists(c: PoolClient, id: string): Promise<Record<string, unknown>> {
    const { rows } = await c.query('SELECT * FROM customer WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) throw new CustomerError('not_found');
    return rows[0];
  }

  private async auditUpdate(
    c: PoolClient, actor: StaffContext, customerId: string,
    before: unknown, after: unknown,
  ): Promise<void> {
    await this.audit.writeInTx(c, {
      eventType: 'customer.updated',
      actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      entityType: 'customer', entityId: customerId, severity: 'info',
      before, after,
    });
  }
}
