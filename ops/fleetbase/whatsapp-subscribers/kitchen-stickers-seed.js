// WP-LBL-A97 — one-off: the stickers read from the kitchen's Publisher file (A95 list) become rows of
// kitchen_sticker through the module's own service (validation + audit). Run inside the API container:
//   node /tmp/kitchen-stickers-seed.js <list.json> <first-day> [apply]
// Prints counts and BOX numbers only.
'use strict';
const fs = require('fs');
const { Pool } = require('/srv/node_modules/pg');
const { AuditService } = require('/srv/dist/platform/audit/audit.service.js');
const { KitchenStickerService } = require('/srv/dist/modules/m25-label/kitchen-sticker.service.js');

const [file, firstDay, mode] = process.argv.slice(2);
const sheetDate = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
};
(async () => {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const service = new KitchenStickerService(pool, new AuditService(pool));
  const actor = { staffId: 'import:kitchen-publisher-file', roles: ['fleetbase_operator'], permissions: [] };
  const existing = new Set((await service.list()).filter((s) => s.active).map((s) => s.mobile));
  const out = { stickers: list.rows.length, created: [], skipped_existing: [], end_date_dropped: [] };
  for (const r of list.rows) {
    if (existing.has(r.mobile)) { out.skipped_existing.push(r.box); continue; }
    let end = sheetDate(r.end);
    // A past or empty end date on the sheet is kept off: the sticker still prints (owner 2026-10-18).
    if (!end || end < firstDay) { out.end_date_dropped.push(r.box); end = null; }
    const input = {
      mobile: r.mobile, name: r.name, box: r.box, area: r.area, block: r.block, street: r.street, house: r.house,
      address_details: r.address, meals_per_day: r.meals, snacks_per_day: r.snacks, breakfast: r.breakfast,
      protein_g: r.protein, carb_g: r.carb, notes: r.notes, start_date: firstDay, end_date: end,
    };
    if (mode === 'apply') await service.create(actor, input);
    out.created.push(r.box);
  }
  out.mode = mode === 'apply' ? 'apply' : 'dry-run';
  console.log(JSON.stringify(out));
  await pool.end();
})().catch((e) => { console.log(JSON.stringify({ error: String(e && e.message || e).slice(0, 300), detail: e.detail })); process.exit(1); });
