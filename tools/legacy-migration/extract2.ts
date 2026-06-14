// Full legacy extraction (read-only). Server-side DataTables (customers, orders) are
// pulled via their authed AJAX JSON endpoint in chunks; small client-side tables
// (packages, package-for, delivery methods) are read from the DOM. Kuwaiti 8-digit phones
// are pre-conditioned to +965 and DD-MM-YYYY dates to ISO so the toolkit normalizers
// validate. Output -> migration-output/<stamp>/ (gitignored). Never mutates legacy.
// Run inside the Playwright container on the VPS (see CALIBRATION_NOTES.md). Calibrated
// against nutreeze.com 2026-06-14: login /admin -> POST /logincheck; customers
// /serversideuserlist (20,151 rows), orders /orders/ajaxlist/Active (1,044 rows).
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveSecrets } from './lib/config.ts';
import { launchContexts } from './lib/browser.ts';
import { installLegacySafety } from './lib/safety.ts';
import { normalizeCustomers } from './normalizers/customers.normalizer.ts';
import { normalizeOrders } from './normalizers/orders.normalizer.ts';
import { normalizePackages, normalizeMaster, normalizePassthrough } from './normalizers/catalog.normalizer.ts';

const strip = (v: any) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim() : (v == null ? null : String(v)));
const phone8 = (raw: any) => { if (!raw) return raw; const m = String(raw).match(/(\d{8})/); return m ? '+965' + m[1] : raw; };
const isoDate = (raw: any) => { if (!raw) return raw; const m = String(raw).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join('/work/migration-output', stamp);
const SUMMARY = join(dir, 'summary.jsonl');
const log = (o: unknown) => { const s = JSON.stringify(o); appendFileSync(SUMMARY, s + '\n'); console.log(s); };
const conf = (norm: any[]) => { const b: any = { VERIFIED: 0, INFERRED: 0, NEEDS_MANUAL_REVIEW: 0 }; for (const n of norm) b[n.confidence]++; return b; };
const writeEnt = (key: string, raw: any[], norm: any[]) => {
  writeFileSync(join(dir, 'raw', key + '.json'), JSON.stringify(raw, null, 1));
  writeFileSync(join(dir, 'normalized', key + '.json'), JSON.stringify(norm, null, 1));
  log({ entity: key, rows: raw.length, confidence: conf(norm) });
};

(async () => {
  mkdirSync(join(dir, 'raw'), { recursive: true });
  mkdirSync(join(dir, 'normalized'), { recursive: true });
  writeFileSync(SUMMARY, '');
  const cfg = loadConfig(); const s = resolveSecrets(cfg); const base = s.legacyBaseUrl!;
  const ctxs = await launchContexts({ navTimeoutMs: 45000 });
  const safety = await installLegacySafety(ctxs.legacy, { baseUrl: base, authPostAllowlist: cfg.legacy.authPostAllowlist, readOnlyGetAllowlist: cfg.legacy.readOnlyGetAllowlist });
  const page = await ctxs.legacy.newPage();
  await page.goto(base + cfg.legacy.loginPath, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.fill(cfg.legacy.emailSelector, s.legacyEmail!).catch(() => {});
  await page.fill(cfg.legacy.passwordSelector, s.legacyPassword!).catch(() => {});
  await page.click(cfg.legacy.submitSelector).catch(() => {});
  await page.waitForTimeout(3500);
  safety.enableStrictReadOnly();
  log({ login: page.url() });

  async function ajaxAll(endpoint: string, chunk = 2500): Promise<string[][]> {
    const rows: string[][] = [];
    let start = 0, total = Infinity;
    while (start < total) {
      const url = `${base}${endpoint}?draw=1&start=${start}&length=${chunk}&search[value]=&order[0][column]=0&order[0][dir]=asc`;
      const resp = await ctxs.legacy.request.get(url, { timeout: 90000 });
      const json: any = JSON.parse(await resp.text());
      total = json.recordsTotal ?? json.iTotalRecords ?? rows.length;
      const data: any[] = json.data || json.aaData || [];
      for (const r of data) rows.push((Array.isArray(r) ? r : Object.values(r)).map(strip));
      log({ pull: endpoint, got: rows.length, total });
      if (!data.length) break;
      start += chunk;
      await sleep(800);
    }
    return rows;
  }

  // 1) customers (server-side ajax) — col idx: 1=id 2=name 3=email 4=mobile 5=dob
  try {
    const rows = await ajaxAll('/serversideuserlist');
    const raw = rows.map((r) => ({ id: r[1], name: r[2], email: r[3], phone: phone8(r[4]), dob: isoDate(r[5]) }));
    writeEnt('customers', raw, normalizeCustomers(raw as any));
  } catch (e) { log({ entity: 'customers', error: String(e).slice(0, 160) }); }

  // 2) orders active + pause (server-side ajax) — col idx: 1=orderNo 2=cust+phone 3=pkg 4=subpkg 5=start 6=end 7=txnDate 8=txnId 9=type 10=payStatus 11=ordStatus 12=coupon 13=pkgAmt 14=paidAmt
  for (const [key, ep, st] of [['orders_active', '/orders/ajaxlist/Active', 'active'], ['orders_pause', '/orders/ajaxlist/Pause', 'pause']] as const) {
    try {
      const rows = await ajaxAll(ep);
      const raw = rows.map((r) => ({
        id: r[1], customer_name: r[2], phone: phone8(r[2]), package: r[3], sub_package: r[4],
        start_date: isoDate(r[5]), end_date: isoDate(r[6]), transaction_date: r[7], transaction_id: r[8],
        order_type: r[9], payment_status: r[10], order_status: r[11], coupon: r[12],
        package_amount: r[13], paid_amount: r[14], status: st,
      }));
      writeEnt(key, raw, normalizeOrders(raw as any));
    } catch (e) { log({ entity: key, error: String(e).slice(0, 160) }); }
  }

  // 3) small client-side tables (DOM)
  const domEnts = [
    { key: 'packages', path: '/package', normalize: normalizePackages, cols: { name: 'td:nth-child(2)', name_ar: 'td:nth-child(3)', priority: 'td:nth-child(4)', coupon: 'td:nth-child(5)' } },
    { key: 'package_for', path: '/packageFor', normalize: normalizePassthrough('package_for_type'), cols: { name: 'td:nth-child(2)', name_ar: 'td:nth-child(3)', type: 'td:nth-child(4)', friday_off: 'td:nth-child(5)', active_new_customers: 'td:nth-child(6)' } },
    { key: 'delivery_methods', path: '/deliveryMethod', normalize: normalizeMaster('delivery_method'), cols: { name: 'td:nth-child(2)', name_ar: 'td:nth-child(3)' } },
  ];
  for (const ent of domEnts) {
    try {
      await page.goto(base + ent.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1800);
      const rows = await page.evaluate((cols) => {
        const table = document.querySelector('table.dataTable, table.display, table');
        if (!table) return [];
        return Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
          const rec: Record<string, string | null> = {};
          for (const [f, sel] of Object.entries(cols)) { const c = tr.querySelector(sel as string); rec[f] = c ? ((c.textContent || '').trim() || null) : null; }
          return rec;
        });
      }, ent.cols);
      const clean = rows.filter((r) => Object.values(r).some((v) => v && v.length));
      writeEnt(ent.key, clean, ent.normalize(clean as any));
    } catch (e) { log({ entity: ent.key, error: String(e).slice(0, 160) }); }
  }

  await ctxs.close();
  log({ done: true, output: dir });
  process.exit(0);
})().catch((e) => { log({ fatal: String(e).slice(0, 200) }); process.exit(1); });
