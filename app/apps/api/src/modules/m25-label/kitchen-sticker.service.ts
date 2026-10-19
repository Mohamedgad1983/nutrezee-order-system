// WP-LBL-A97 — the kitchen's WhatsApp-subscriber stickers, kept in the system instead of a Publisher
// file. This module owns only kitchen_sticker; the WhatsApp sync reads the live rows and writes the
// Fleetbase orders (driver = the area's driver that day), so nothing here touches Fleetbase.
import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { withTransaction } from '../../platform/db/tx';
import { newId } from '../../platform/ids';

export class KitchenStickerError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'conflict',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface KitchenStickerInput {
  mobile?: unknown; name?: unknown; box?: unknown; area?: unknown; block?: unknown; street?: unknown;
  house?: unknown; address_details?: unknown; meals_per_day?: unknown; snacks_per_day?: unknown;
  breakfast?: unknown; protein_g?: unknown; carb_g?: unknown; notes?: unknown; start_date?: unknown;
  end_date?: unknown;
}

export interface KitchenSticker {
  id: string; mobile: string; name: string; box: string | null; area: string; block: string | null;
  street: string | null; house: string | null; address_details: string | null;
  meals_per_day: number | null; snacks_per_day: number | null; breakfast: number | null;
  protein_g: number | null; carb_g: number | null; notes: string | null;
  start_date: string; end_date: string | null; active: boolean;
  updated_at: string; updated_by: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = [
  'mobile', 'name', 'box', 'area', 'block', 'street', 'house', 'address_details', 'meals_per_day',
  'snacks_per_day', 'breakfast', 'protein_g', 'carb_g', 'notes', 'start_date', 'end_date',
] as const;

/** One line, no control characters; empty is "none". */
function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new KitchenStickerError('validation_failed', { field, reason: 'required' });
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new KitchenStickerError('validation_failed', { field });
  // eslint-disable-next-line no-control-regex
  const clean = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) {
    if (required) throw new KitchenStickerError('validation_failed', { field, reason: 'required' });
    return null;
  }
  if (clean.length > max) throw new KitchenStickerError('validation_failed', { field, reason: 'too_long', max });
  return clean;
}

function count(value: unknown, field: string, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0 || n > max) throw new KitchenStickerError('validation_failed', { field, max });
  return n;
}

function day(value: unknown, field: string, required: boolean): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new KitchenStickerError('validation_failed', { field, reason: 'required' });
    return null;
  }
  const v = String(value).trim();
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new KitchenStickerError('validation_failed', { field });
  return v;
}

/** `+965 9890-8830` / `96598908830` → `98908830`. Kuwait numbers only, like the WhatsApp list. */
export function stickerMobile(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^00/, '');
  const local = /^965\d{8}$/.test(digits) ? digits.slice(3) : digits;
  if (!/^\d{8}$/.test(local)) throw new KitchenStickerError('validation_failed', { field: 'mobile', reason: 'eight_digits' });
  return local;
}

export function cleanSticker(input: KitchenStickerInput) {
  const out = {
    mobile: stickerMobile(input.mobile),
    name: text(input.name, 'name', 80, true)!,
    box: text(input.box, 'box', 20),
    area: text(input.area, 'area', 80, true)!,
    block: text(input.block, 'block', 20),
    street: text(input.street, 'street', 60),
    house: text(input.house, 'house', 30),
    address_details: text(input.address_details, 'address_details', 200),
    meals_per_day: count(input.meals_per_day, 'meals_per_day', 10),
    snacks_per_day: count(input.snacks_per_day, 'snacks_per_day', 10),
    breakfast: count(input.breakfast, 'breakfast', 5),
    protein_g: count(input.protein_g, 'protein_g', 1000),
    carb_g: count(input.carb_g, 'carb_g', 1000),
    notes: text(input.notes, 'notes', 900),
    start_date: day(input.start_date, 'start_date', true)!,
    end_date: day(input.end_date, 'end_date', false),
  };
  if (out.box && !/^[0-9A-Za-z-]{1,20}$/.test(out.box)) throw new KitchenStickerError('validation_failed', { field: 'box' });
  if (out.end_date && out.end_date < out.start_date) throw new KitchenStickerError('validation_failed', { field: 'end_date', reason: 'before_start' });
  return out;
}

function toSticker(row: Record<string, unknown>): KitchenSticker {
  // node-postgres hands a DATE back as a local-midnight Date; format it without a timezone shift.
  const date = (v: unknown) => (v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : v === null || v === undefined ? null : String(v).slice(0, 10));
  return {
    id: row.id as string, mobile: row.mobile as string, name: row.name as string, box: (row.box as string) ?? null,
    area: row.area as string, block: (row.block as string) ?? null, street: (row.street as string) ?? null,
    house: (row.house as string) ?? null, address_details: (row.address_details as string) ?? null,
    meals_per_day: (row.meals_per_day as number) ?? null, snacks_per_day: (row.snacks_per_day as number) ?? null,
    breakfast: (row.breakfast as number) ?? null, protein_g: (row.protein_g as number) ?? null,
    carb_g: (row.carb_g as number) ?? null, notes: (row.notes as string) ?? null,
    start_date: date(row.start_date)!, end_date: date(row.end_date), active: row.archived_at === null,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    updated_by: row.updated_by as string,
  };
}

function roleOf(actor: StaffContext): string {
  return actor.roles.includes('fleetbase_admin') ? 'fleetbase_admin' : 'fleetbase_operator';
}

export class KitchenStickerService {
  constructor(private readonly pool: Pool, private readonly audit: AuditService) {}

  /** Live stickers first (by box), then the stopped ones. */
  async list(): Promise<KitchenSticker[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM kitchen_sticker
        ORDER BY archived_at IS NOT NULL, archived_at DESC NULLS FIRST, box NULLS LAST, name`,
    );
    return rows.map(toSticker);
  }

  async create(actor: StaffContext, input: KitchenStickerInput): Promise<KitchenSticker> {
    const s = cleanSticker(input);
    return withTransaction(this.pool, async (client) => {
      await this.assertPhoneFree(client, s.mobile, null);
      const id = newId();
      const { rows } = await client.query(
        `INSERT INTO kitchen_sticker (id, ${FIELDS.join(', ')}, created_by, updated_by)
         VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(', ')}, $${FIELDS.length + 2}, $${FIELDS.length + 2})
         RETURNING *`,
        [id, ...FIELDS.map((f) => s[f]), actor.staffId],
      );
      await this.audited(client, actor, 'label.kitchen_sticker_created', id, null, s);
      return toSticker(rows[0] as Record<string, unknown>);
    });
  }

  async update(actor: StaffContext, id: string, input: KitchenStickerInput): Promise<KitchenSticker> {
    const s = cleanSticker(input);
    return withTransaction(this.pool, async (client) => {
      const before = await this.lockRow(client, id);
      if (before.archived_at === null) await this.assertPhoneFree(client, s.mobile, id);
      const { rows } = await client.query(
        `UPDATE kitchen_sticker SET ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')},
                updated_at = now(), updated_by = $${FIELDS.length + 2}
          WHERE id = $1 RETURNING *`,
        [id, ...FIELDS.map((f) => s[f]), actor.staffId],
      );
      await this.audited(client, actor, 'label.kitchen_sticker_updated', id, before, s);
      return toSticker(rows[0] as Record<string, unknown>);
    });
  }

  /** Stop printing it (kept as history), or bring it back. */
  async setActive(actor: StaffContext, id: string, active: boolean): Promise<KitchenSticker> {
    return withTransaction(this.pool, async (client) => {
      const before = await this.lockRow(client, id);
      if ((before.archived_at === null) === active) throw new KitchenStickerError('conflict', { reason: active ? 'already_active' : 'already_stopped' });
      if (active) await this.assertPhoneFree(client, before.mobile as string, id);
      const { rows } = await client.query(
        active
          ? `UPDATE kitchen_sticker SET archived_at = NULL, archived_by = NULL, updated_at = now(), updated_by = $2 WHERE id = $1 RETURNING *`
          : `UPDATE kitchen_sticker SET archived_at = now(), archived_by = $2, updated_at = now(), updated_by = $2 WHERE id = $1 RETURNING *`,
        [id, actor.staffId],
      );
      await this.audited(client, actor, active ? 'label.kitchen_sticker_restored' : 'label.kitchen_sticker_stopped', id, before, null);
      return toSticker(rows[0] as Record<string, unknown>);
    });
  }

  private async lockRow(client: PoolClient, id: string): Promise<Record<string, unknown>> {
    const { rows } = await client.query('SELECT * FROM kitchen_sticker WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) throw new KitchenStickerError('not_found', { id });
    return rows[0] as Record<string, unknown>;
  }

  private async assertPhoneFree(client: PoolClient, mobile: string, exceptId: string | null): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kitchen-sticker:${mobile}`]);
    const { rows } = await client.query(
      'SELECT id, name FROM kitchen_sticker WHERE mobile = $1 AND archived_at IS NULL AND id IS DISTINCT FROM $2',
      [mobile, exceptId],
    );
    if (rows.length > 0) throw new KitchenStickerError('conflict', { reason: 'mobile_has_sticker', id: rows[0].id });
  }

  private async audited(
    client: PoolClient, actor: StaffContext, eventType: string, id: string,
    before: Record<string, unknown> | null, after: Record<string, unknown> | null,
  ): Promise<void> {
    // Customer details stay out of the audit row: the fields that changed are enough to trace an edit.
    const was = before ? (toSticker(before) as unknown as Record<string, unknown>) : null;
    const changed = was && after ? FIELDS.filter((f) => String(was[f] ?? '') !== String(after[f] ?? '')) : [];
    await this.audit.writeInTx(client, {
      eventType,
      actor: { id: actor.staffId, role: roleOf(actor) },
      entityType: 'kitchen_sticker', entityId: id,
      severity: 'info',
      relatedRefs: { changed_fields: changed.join(',') },
    });
  }
}

/** Areas of a delivery day (legacy orders) with the driver who carries each, for the page's area list. */
export function areasWithDriver(
  candidates: { source: string; areaLabel: string; driverName?: string | null; driverLabel: string | null }[],
): { label: string; driver: string | null }[] {
  const areas = new Map<string, { label: string; driver: string | null }>();
  for (const c of candidates) {
    if (c.source === 'partner' && !areas.has(c.areaLabel)) {
      areas.set(c.areaLabel, { label: c.areaLabel, driver: c.driverName ?? c.driverLabel ?? null });
    }
  }
  return [...areas.values()].sort((a, b) => a.label.localeCompare(b.label));
}
