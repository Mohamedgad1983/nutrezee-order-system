import type { Pool } from 'pg';
import { withTransaction } from '../db/tx';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import type { StaffContext } from '../auth/session.service';
import { SettingsReader } from './settings-reader';
import { newId } from '../ids';

export class SettingsError extends Error {
  constructor(readonly code: 'unknown_key' | 'type_mismatch' | 'unknown_domain' | 'not_found') {
    super(code);
  }
}

// Gate-bearing keys: settings.changed audits HIGH and editing requires
// settings.update.gates (validation_rules_binding §3, audit_architecture).
const GATE_KEYS = new Set(['payment_gate', 'kitchen_cutoff_time', 'rbac_enforcement_mode']);

function typeOk(valueType: string, value: unknown): boolean {
  if (value === null) return true; // explicit unset (e.g. kitchen_cutoff_time before workshop)
  switch (valueType) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'flag': return typeof value === 'boolean';
    case 'text': case 'enum': return typeof value === 'string';
    case 'time': return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
    case 'json': return typeof value === 'object';
    default: return false;
  }
}

// M16 admin (WP-03): typed setting updates with effective-dating, preview, audited
// change trail, and cache invalidation via the settings.changed outbox event + direct
// reader clear (DoD: invalidation proven).
export class SettingsService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly reader: SettingsReader,
    private readonly onChanged: Array<() => void> = [],
  ) {}

  isGateKey(key: string): boolean {
    return GATE_KEYS.has(key);
  }

  /** Preview = full validation without applying (change-preview, GAP-ADM-02). */
  async preview(key: string, value: unknown): Promise<{ key: string; ok: true; gate: boolean }> {
    const row = await this.load(key);
    if (!typeOk(row.value_type, value)) throw new SettingsError('type_mismatch');
    return { key, ok: true, gate: this.isGateKey(key) };
  }

  async update(
    actor: StaffContext,
    key: string,
    value: unknown,
    effectiveFrom?: string,
  ): Promise<void> {
    const row = await this.load(key);
    if (!typeOk(row.value_type, value)) throw new SettingsError('type_mismatch');
    await withTransaction(this.pool, async (c) => {
      await c.query(
        `UPDATE setting SET value = $2, effective_from = $3, updated_at = now(),
                updated_by = $4, version = version + 1 WHERE key = $1`,
        [key, JSON.stringify(value), effectiveFrom ?? null, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'setting', entityId: key,
        before: { value: row.value }, after: { value, effective_from: effectiveFrom ?? null },
        severity: this.isGateKey(key) ? 'high' : 'warn',
      });
      await this.outbox.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { setting: key },
        payload: { key, effective_from: effectiveFrom ?? null },
      });
    });
    this.reader.clear(); // immediate local invalidation; other consumers via the event
    for (const cb of this.onChanged) cb();
  }

  async list(): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.pool.query(
      'SELECT key, value, value_type, scope, effective_from, version FROM setting ORDER BY key',
    );
    return rows;
  }

  async setFlag(actor: StaffContext, key: string, on: boolean): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      const { rows } = await c.query('SELECT on_flag FROM feature_flag WHERE key = $1 FOR UPDATE', [key]);
      if (rows.length === 0) throw new SettingsError('unknown_key');
      await c.query(
        'UPDATE feature_flag SET on_flag = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE key = $1',
        [key, on, actor.staffId],
      );
      await this.audit.writeInTx(c, {
        eventType: key.startsWith('cutover_') ? 'bridge.cutover_flag_changed' : 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'feature_flag', entityId: key,
        before: { on: rows[0].on_flag }, after: { on },
        severity: 'high', // flags gate behavior; cutover flags especially (legacy_transition)
      });
    });
  }

  async addReasonCode(actor: StaffContext, domain: string, code: string, labelEn: string, labelAr?: string): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      try {
        await c.query(
          `INSERT INTO reason_code (id, domain, code, label_en, label_ar, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId(), domain, code, labelEn, labelAr ?? null, actor.staffId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23514') throw new SettingsError('unknown_domain');
        throw e;
      }
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'reason_code', entityId: `${domain}:${code}`,
        after: { label_en: labelEn }, severity: 'warn',
      });
    });
  }

  /** Generic ops-master upsert audit wrapper (sections/areas/slots/methods — zero-row-ready). */
  async addMaster(
    actor: StaffContext,
    table: 'section_master' | 'area' | 'delivery_slot' | 'delivery_method',
    columns: Record<string, unknown>,
  ): Promise<string> {
    // Defense in depth: `table` and the column KEYS are interpolated as SQL
    // identifiers below, so validate them here as well as at the controller.
    if (!['section_master', 'area', 'delivery_slot', 'delivery_method'].includes(table)) {
      throw new SettingsError('not_found');
    }
    for (const key of Object.keys(columns)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new SettingsError('type_mismatch');
    }
    const id = newId();
    const cols = ['id', ...Object.keys(columns), 'created_by'];
    const vals = [id, ...Object.values(columns), actor.staffId];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    await withTransaction(this.pool, async (c) => {
      await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, vals);
      await this.audit.writeInTx(c, {
        eventType: 'settings.changed',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: table, entityId: id, after: columns, severity: 'warn',
      });
    });
    return id;
  }

  // WP-API-01b: read ops-masters (sections/areas/slots/methods) for the intake form
  // and the settings admin screen. Read-only; the column + order lists are a trusted
  // per-kind map and `kind` is validated against it, so the interpolated table name is
  // never user-controlled.
  async listMasters(
    kind: 'section_master' | 'area' | 'delivery_slot' | 'delivery_method',
    opts?: { activeOnly?: boolean },
  ): Promise<Record<string, unknown>[]> {
    const spec: Record<string, { cols: string; order: string }> = {
      section_master: { cols: 'id, code, name_en, name_ar, active', order: 'name_en' },
      area: { cols: 'id, code, name_en, name_ar, active', order: 'name_en' },
      delivery_slot: { cols: 'id, label_en, label_ar, start_time, end_time, capacity, active', order: 'start_time' },
      delivery_method: { cols: 'id, name_en, name_ar, active', order: 'name_en' },
    };
    const s = spec[kind];
    if (!s) throw new SettingsError('not_found');
    const { rows } = await this.pool.query(
      `SELECT ${s.cols} FROM ${kind} ${opts?.activeOnly ? 'WHERE active' : ''} ORDER BY ${s.order}`,
    );
    return rows;
  }

  private async load(key: string): Promise<{ value: unknown; value_type: string }> {
    const { rows } = await this.pool.query('SELECT value, value_type FROM setting WHERE key = $1', [key]);
    if (rows.length === 0) throw new SettingsError('unknown_key');
    return rows[0];
  }
}
