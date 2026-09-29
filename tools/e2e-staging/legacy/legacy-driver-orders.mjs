// A69 method 2 — read-only check of the legacy admin "Orders Driver Wise" screen for one delivery day.
// Counts all orders and each driver's orders exactly as the driver manager sees them, then uploads a
// small JSON (order numbers, driver names, counts — no customer data) to the VPS, where the 00:55
// night check compares it with the Partner API and Fleetbase.
//
// Credentials never live in this file: username + password are read at run time from the macOS
// Keychain item "nutreeze-legacy-admin" (created by the owner). Nothing is clicked except login,
// navigation, the date/driver filters and "Filter". No record is edited.
//
// Usage (from tools/e2e-staging):  node legacy/legacy-driver-orders.mjs [YYYY-MM-DD] [--headed] [--no-upload]
// Default day = tomorrow in Kuwait.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://nutreeze.com';
const KEYCHAIN_SERVICE = 'nutreeze-legacy-admin';
const OUT_DIR = process.env.LEGACY_OUT_DIR || join(homedir(), 'nutreeze-legacy-check');
// On the VPS the credentials come from a root-only file written by the owner (never by the assistant).
const CRED_FILE = process.env.LEGACY_CRED_FILE || '';
const VPS = { host: '13.140.159.201', user: 'root', key: join(homedir(), '.ssh', 'nutrezee_staging_ed25519') };

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const upload = !args.includes('--no-upload');
const kuwaitToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date());
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  ?? new Date(Date.parse(`${kuwaitToday}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const [yyyy, mm, dd] = day.split('-');
const legacyDate = `${dd}-${mm}-${yyyy}`; // the screen shows 29-09-2026

function keychain() {
  if (CRED_FILE) {
    const [username, ...rest] = readFileSync(CRED_FILE, 'utf8').split('\n');
    const password = rest.join('\n').replace(/\n+$/, '');
    if (!username.trim() || !password) throw new Error('credential_file_incomplete');
    return { username: username.trim(), password };
  }
  const password = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' }).trim();
  const attrs = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { encoding: 'utf8' });
  const username = (/"acct"<blob>="([^"]*)"/.exec(attrs)?.[1] ?? '').trim();
  if (!username || !password) throw new Error('keychain_item_incomplete');
  return { username, password };
}

async function waitIdle(page) {
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function setDate(page) {
  await page.evaluate((value) => {
    const el = document.querySelector('#date_given');
    if (!el) throw new Error('date_input_missing');
    el.removeAttribute('readonly');
    el.value = value;
    const $ = window.jQuery;
    if ($ && $(el).datepicker) { try { $(el).datepicker('update', value); } catch (e) { /* plain input */ } }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, legacyDate);
}

async function driverOptions(page) {
  return page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Select Driver/i.test(o.text)));
    if (!sel) throw new Error('driver_select_missing');
    return [...sel.options].filter((o) => o.value && !/Select Driver/i.test(o.text)).map((o) => ({ value: o.value, name: o.text.trim() }));
  });
}

async function setDriver(page, value) {
  await page.evaluate((v) => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Select Driver/i.test(o.text)));
    const $ = window.jQuery;
    if ($ && $(sel).selectpicker) { $(sel).selectpicker('val', v); } else { sel.value = v; }
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

// Total from the "Showing 1 to 10 of N entries" line, plus the Order ID of every row on every page.
// The screen renders 10 rows per page, so the Order IDs are collected by paging (largest page size
// first, then "Next" until it is disabled), from the DOM exactly as the driver manager sees them.
async function tableState(page) {
  return page.evaluate(() => {
    const tableEl = document.querySelector('table.dataTable') ?? document.querySelector('table');
    if (!tableEl) return { total: null, ids: [], info: '', note: 'no_table' };
    const headers = [...tableEl.querySelectorAll('thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    const idCol = headers.findIndex((h) => /^Order ID/i.test(h));
    const info = document.querySelector('.dataTables_info')?.textContent.trim() ?? '';
    const m = /of\s+([\d,]+)\s+entries/i.exec(info);
    const total = m ? Number(m[1].replace(/,/g, '')) : (/No data|0 entries|0 to 0/i.test(info) ? 0 : null);
    const ids = idCol < 0 ? [] : [...tableEl.querySelectorAll('tbody tr')]
      .map((tr) => tr.children[idCol]?.textContent.trim()).filter((v) => v && /^\d+$/.test(v));
    return { total, ids, info, idCol };
  });
}

// Wait until the server-side table has finished loading after Filter: no "Processing" overlay and the
// "of N entries" count unchanged for 1.5 s (a count read mid-load was 0 for a 146-order driver).
async function waitTableSettled(page) {
  let last = null;
  let stableSince = Date.now();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const proc = document.querySelector('.dataTables_processing');
      const busy = !!proc && getComputedStyle(proc).display !== 'none' && getComputedStyle(proc).visibility !== 'hidden';
      const info = document.querySelector('.dataTables_info')?.textContent.trim() ?? '';
      return { busy, info };
    });
    if (st.busy || st.info !== last) { last = st.info; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 1500 && /entries/i.test(st.info)) return;
    await page.waitForTimeout(250);
  }
}

async function readTable(page) {
  await waitTableSettled(page);
  const first = await tableState(page);
  // Walk every page through the table's own DataTables API (no button clicks: the screen has no
  // page-size selector and the pager sits below the fold). Each page is drawn and its rows read.
  const viaApi = await page.evaluate(async () => { try {
    const $ = window.jQuery;
    const t = document.querySelector('table.dataTable') ?? document.querySelector('table');
    if (!t || !$ || !$.fn.dataTable || !$.fn.dataTable.isDataTable(t)) return null;
    const dt = $(t).DataTable();
    const headers = [...t.querySelectorAll('thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    const idCol = headers.findIndex((h) => /^Order ID/i.test(h));
    if (idCol < 0) return null;
    // A70.4: the "Driver" column holds the row's links; the Delivery Sticker link is kept so an order that is
    // under no driver filter can be looked up directly (owner: an order never stays without a driver).
    const drvCol = headers.findIndex((h) => /driver/i.test(h));
    const stickerById = {};
    const drawPage = (p) => new Promise((resolve) => {
      const timer = setTimeout(resolve, 45000);
      $(t).one('draw.dt', () => { clearTimeout(timer); setTimeout(resolve, 150); });
      dt.page(p).draw(false);
    });
    const readDom = () => [...t.querySelectorAll('tbody tr')]
      .map((tr) => tr.children[idCol]?.textContent.trim()).filter((v) => v && /^\d+$/.test(v));
    const s = dt.settings()[0];
    const info0 = dt.page.info();
    const diag = {
      dt_version: $.fn.dataTable.version ?? null,
      server_side: !!(s.oFeatures && s.oFeatures.bServerSide),
      ajax: typeof s.ajax === 'string' ? s.ajax.split('?')[0] : (s.ajax && s.ajax.url ? String(s.ajax.url).split('?')[0] : (s.sAjaxSource || null)),
      ajax_type: (s.ajax && s.ajax.type) || s.sServerMethod || null,
      info: info0, client_rows: dt.rows().data().length, first_ids_by_page: [],
    };
    const ids = new Set();
    // 1) client-side table: every row is already in memory
    if (!diag.server_side && dt.rows().data().length >= info0.recordsDisplay) {
      dt.column(idCol, { search: 'applied' }).data().toArray()
        .map((v) => String(v).replace(/<[^>]*>/g, '').trim()).filter((v) => /^\d+$/.test(v))
        .forEach((id) => ids.add(id));
      diag.method = 'client_rows';
    }
    // 2) server-side table: ask its own endpoint directly (same session). length=-1 → HTTP 500 on this
    //    server, so request a real number of rows, sorted by Order ID so paging is deterministic.
    const cellOf = (r) => (Array.isArray(r) ? r[idCol] : (r.order_id ?? r.id ?? r[Object.keys(r)[idCol]]));
    const clean = (v) => String(v ?? '').replace(/<[^>]*>/g, '').trim();
    if (ids.size < info0.recordsDisplay && diag.server_side && diag.ajax) {
      const base = (dt.ajax && typeof dt.ajax.params === 'function') ? dt.ajax.params() : {};
      const sorted = Object.assign({}, base, { 'order[0][column]': idCol, 'order[0][dir]': 'asc' });
      diag.ajax_tries = [];
      for (const size of [info0.recordsDisplay, 500, 100]) {
        if (ids.size >= info0.recordsDisplay) break;
        try {
          for (let start = 0; start < info0.recordsDisplay; start += size) {
            const json = await $.ajax({ url: diag.ajax, type: diag.ajax_type || 'GET', dataType: 'json',
              data: Object.assign({}, sorted, { start, length: size, draw: 1 }) });
            const rows = json.data || json.aaData || [];
            for (const r of rows) {
              const id = clean(cellOf(r));
              if (!/^\d+$/.test(id)) continue;
              ids.add(id);
              if (drvCol >= 0) {
                const cell = String(Array.isArray(r) ? r[drvCol] : '');
                const link = /href=["'](\/printDeliverySticker\/[^"']+)["']/.exec(cell);
                if (link) stickerById[id] = link[1];
              }
            }
            if (rows.length === 0) break;
          }
          diag.ajax_tries.push({ size, ids: ids.size });
          diag.method = `ajax_${size}`;
        } catch (e) {
          diag.ajax_tries.push({ size, error: String(e && (e.statusText || e.message) || e).slice(0, 60) });
        }
      }
    }
    // 3) fallback: draw each page and read the rows on screen
    if (ids.size < info0.recordsDisplay) {
      diag.method = (diag.method ? diag.method + '+' : '') + 'page_walk';
      await new Promise((resolve) => { const tm = setTimeout(resolve, 45000); $(t).one('draw.dt', () => { clearTimeout(tm); setTimeout(resolve, 150); }); dt.order([idCol, 'asc']).draw(false); });
      for (let p = 0; p < info0.pages; p++) {
        await drawPage(p);
        const got = readDom();
        if (p < 3) diag.first_ids_by_page.push(got[0] ?? null);
        got.forEach((id) => ids.add(id));
      }
      await drawPage(0);
    }
    return { total: dt.page.info().recordsDisplay, ids: [...ids], pages: info0.pages, diag, stickerById };
  } catch (e) { return { total: null, ids: [], pages: null, diag: { api_error: String(e && e.message || e).slice(0, 160) } }; } }).catch((e) => ({ total: null, ids: [], pages: null, diag: { eval_error: String(e.message).slice(0, 160) } }));
  // the count must agree before and after reading the ids; a disagreement is reported, never guessed
  await waitTableSettled(page);
  const after = await tableState(page);
  const total = after.total ?? viaApi?.total ?? first.total;
  if (first.total !== null && after.total !== null && first.total !== after.total) {
    (viaApi && viaApi.diag ? viaApi.diag : {}).count_changed = `${first.total}->${after.total}`;
  }
  const ids = viaApi && viaApi.ids.length ? viaApi.ids : first.ids;
  return { total, ids, info: first.info, pages: viaApi?.pages ?? null, diag: viaApi?.diag ?? { api: 'unavailable' },
    stickerById: viaApi?.stickerById ?? {},
    complete: total === null ? false : ids.length === total };
}

async function filter(page) {
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), page.getByRole('button', { name: 'Filter' }).click()]);
  await waitIdle(page);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  const result = { day, legacy_date: legacyDate, captured_at: new Date().toISOString(), source: 'legacy_admin_driver_wise',
    total: null, order_ids: [], drivers: [], errors: [] };
  const browser = await chromium.launch({ headless: !headed });
  const page = await (await browser.newContext()).newPage();
  try {
    const { username, password } = keychain();
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email Address' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'SIGN IN' }).click();
    await waitIdle(page);
    await page.goto(`${BASE}/driverOrders`, { waitUntil: 'domcontentloaded' });
    await waitIdle(page);
    if (!(await page.locator('#date_given').count())) throw new Error('login_or_navigation_failed');

    await setDate(page);
    await filter(page);
    const all = await readTable(page);
    result.total = all.total;
    result.order_ids = all.ids;
    result.table_info = all.info;
    result.ids_complete = all.complete;
    result.table_diag = all.diag;
    if (!all.complete) result.errors.push(`order_ids_incomplete: ${all.ids.length} of ${all.total}`);

    for (const d of await driverOptions(page)) {
      await setDate(page);
      await setDriver(page, d.value);
      await filter(page);
      const t = await readTable(page);
      // A70: the option value is the legacy driver id (same id space as Partner driver.id).
      result.drivers.push({ id: d.value, name: d.name, count: t.total, order_ids: t.ids, ids_complete: t.complete });
      if (!t.complete) result.errors.push(`driver_ids_incomplete: ${d.name} ${t.ids.length} of ${t.total}`);
    }
    // A70.4: every screen order under no driver filter is looked up on its own Delivery Sticker
    // ("Driver ID A7"); "-" or no sticker means the legacy admin itself has no driver for it.
    const assigned = new Set(result.drivers.flatMap((d) => d.order_ids));
    result.sticker_drivers = {};
    for (const id of result.order_ids.filter((n) => !assigned.has(n))) {
      const href = all.stickerById[id];
      let code = null;
      if (href) {
        const text = await page.evaluate(async (u) => (await fetch(u, { credentials: 'include' })).text(), href);
        const m = /Driver ID\s*([A-Za-z0-9._-]+)/.exec(text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '));
        code = m && m[1] !== '-' ? m[1] : null;
      }
      result.sticker_drivers[id] = code;
    }
  } catch (e) {
    result.errors.push(String(e.message ?? e).slice(0, 200));
    await page.screenshot({ path: join(OUT_DIR, `failure-${day}.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
  result.driver_sum = result.drivers.reduce((s, d) => s + (d.count ?? 0), 0);
  const file = join(OUT_DIR, `legacy-ui-${day}.json`);
  writeFileSync(file, JSON.stringify(result, null, 1));
  chmodSync(file, 0o600);
  console.log(JSON.stringify({ day, total: result.total, ids: result.order_ids.length, diag: result.table_diag, drivers: result.drivers.map((d) => `${d.id}:${d.name}=${d.count}`), driver_sum: result.driver_sum, errors: result.errors }));
  if (upload) {
    execFileSync('scp', ['-q', '-i', VPS.key, '-o', 'BatchMode=yes', file, `${VPS.user}@${VPS.host}:/root/a68/legacy-ui-${day}.json`]);
    console.log('uploaded');
  }
  if (result.errors.length) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
