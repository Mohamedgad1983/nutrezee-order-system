// Nutreeze daily subscription-expiry report — READ-ONLY.
// Logs in to the legacy admin, reads "Customer Active Orders" (every page, exactly as staff see it),
// keeps the orders whose End Date is today+1 .. today+N (Asia/Kuwait), opens each matching order's
// "View Order" page to read the customer id + area and to re-check the customer, and writes
// JSON + CSV reports. Nothing is clicked except login; no form on any order is submitted.
//
// Credentials: root-only file written by the owner (line 1 username, line 2 password); never logged.
// Exit codes: 0 ok · 10 login failed · 11 page/table missing · 12 incomplete reading · 13 empty list · 1 other
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://nutreeze.com';
const LIST_PATH = '/orders/list/Active';
const CRED_FILE = process.env.LEGACY_CRED_FILE;
const OUT_DIR = process.env.EXPIRY_OUT_DIR || '/out';
const DAYS = Number(process.env.EXPIRY_DAYS_AHEAD || 3);
const NO_DETAILS = process.argv.includes('--no-details');
const DUMP_ALL = process.argv.includes('--dump-all'); // validation aid: also save every active order read
const TEST_NAME = /\btest(ing)?\b|do not deliver/i;

const kwNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuwait', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
const log = (msg) => console.log(`${kwNow()} ${msg}`);
class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const today = process.env.EXPIRY_TODAY || kwNow().slice(0, 10); // Kuwait business date
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const toIso = (s) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((s || '').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

async function settle(page) {
  // server-side DataTable: wait until no "Processing" overlay and the info line is stable for 1.5 s
  let last = null; let since = Date.now(); const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const p = document.querySelector('.dataTables_processing');
      const busy = !!p && getComputedStyle(p).display !== 'none' && getComputedStyle(p).visibility !== 'hidden';
      return { busy, info: document.querySelector('.dataTables_info')?.textContent.trim() ?? '' };
    });
    if (st.busy || st.info !== last) { last = st.info; since = Date.now(); }
    else if (Date.now() - since >= 1500 && /entries/i.test(st.info)) return st.info;
    await page.waitForTimeout(250);
  }
  throw new Fail(12, 'table did not settle within 90 s');
}

// wait until the table really shows page p at 100 rows per page ("Showing <p*100+1> to ...")
async function shown(page, p) {
  await page.waitForFunction((n) => {
    const dt = window.jQuery(document.querySelector('table.dataTable')).DataTable();
    const info = document.querySelector('.dataTables_info')?.textContent ?? '';
    const m = /Showing\s+([\d,]+)\s+to/i.exec(info);
    return dt.page.info().page === n && dt.page.info().length === 100 && m && Number(m[1].replace(/,/g, '')) === n * 100 + 1;
  }, p, { timeout: 90000 }).catch(() => { throw new Fail(12, `page ${p + 1} of the table did not load`); });
}

async function login(page) {
  const [username, ...rest] = readFileSync(CRED_FILE, 'utf8').split('\n');
  const password = rest.join('\n').replace(/\n+$/, '');
  if (!username.trim() || !password) throw new Fail(10, 'credential file incomplete');
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Email Address' }).fill(username.trim());
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'SIGN IN' }).click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  if (!/\/dashboard/.test(page.url()) || await page.getByRole('button', { name: 'SIGN IN' }).count()) {
    throw new Fail(10, 'login failed or session not established (check the owner credential file)');
  }
}

async function readActiveOrders(page) {
  await page.goto(`${BASE}${LIST_PATH}`, { waitUntil: 'domcontentloaded' });
  if (await page.getByRole('button', { name: 'SIGN IN' }).count()) throw new Fail(10, 'session expired: redirected to login');
  await page.locator('table.dataTable').first().waitFor({ state: 'attached', timeout: 60000 }).catch(() => { throw new Fail(11, 'Active Orders table not found'); });
  await settle(page);
  log('Subscription page loaded (Customer Active Orders)');
  // 100 rows per page (the table's own largest page size), then walk every page with its own pager API
  const ok = await page.evaluate(() => {
    const $ = window.jQuery; const t = document.querySelector('table.dataTable');
    if (!$ || !$.fn.dataTable || !$.fn.dataTable.isDataTable(t)) return false;
    $(t).DataTable().page.len(100).draw(); return true;
  });
  if (!ok) throw new Fail(11, 'Active Orders table is not the expected DataTable');
  await shown(page, 0);
  const rows = new Map(); let total = null; let pages = 0;
  for (;;) {
    const info = await settle(page);
    const st = await page.evaluate(() => {
      const t = document.querySelector('table.dataTable');
      const headers = [...t.querySelectorAll('thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
      const col = (re) => headers.findIndex((h) => re.test(h));
      const c = { no: col(/^Order U\.?No/i), cust: col(/^Cu(s)?tomer Name/i), pkg: col(/^Package Name/i), sub: col(/^Sub Package/i), start: col(/^Start Date/i), end: col(/^End Date/i), type: col(/^Order Type/i), pay: col(/^Payment Status/i), op: col(/^Operation/i) };
      const missing = Object.entries(c).filter(([, i]) => i < 0).map(([k]) => k);
      const txt = (td) => (td?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const data = [...t.querySelectorAll('tbody tr')].filter((tr) => tr.children.length >= headers.length).map((tr) => ({
        order_no: txt(tr.children[c.no]), customer: txt(tr.children[c.cust]), package: txt(tr.children[c.pkg]), sub_package: txt(tr.children[c.sub]),
        start: txt(tr.children[c.start]), end: txt(tr.children[c.end]), order_type: txt(tr.children[c.type]), payment_status: txt(tr.children[c.pay]),
        view: tr.children[c.op]?.querySelector('a[href*="/orders/view/"]')?.getAttribute('href') ?? '',
      }));
      const dt = window.jQuery(t).DataTable(); const pi = dt.page.info();
      return { missing, data, page: pi.page, pagesTotal: pi.pages, recordsTotal: pi.recordsTotal };
    });
    if (st.missing.length) throw new Fail(11, `expected columns missing: ${st.missing.join(',')}`);
    total = st.recordsTotal; pages += 1;
    for (const r of st.data) if (/^\d+$/.test(r.order_no)) rows.set(r.order_no, r);
    if (st.page + 1 >= st.pagesTotal) { log(`Read ${pages} page(s); table says "${info}"`); break; }
    // draw(false) keeps the page (this DataTables version resets to page 1 on any other draw argument)
    await page.evaluate((p) => { window.jQuery(document.querySelector('table.dataTable')).DataTable().page(p).draw(false); }, st.page + 1);
    await shown(page, st.page + 1);
  }
  if (total === 0 || rows.size === 0) throw new Fail(13, 'Active Orders list is empty — refusing to report zero customers');
  if (rows.size !== total) throw new Fail(12, `incomplete reading: table total ${total}, rows read ${rows.size}`);
  return [...rows.values()];
}

function parseRow(r) {
  const m = /^(.*?)\[\s*([^\]]*?)\s*\]\s*$/.exec(r.customer);
  const endIso = toIso(r.end);
  return {
    order_no: r.order_no, order_internal_id: (/\/orders\/view\/(\d+)/.exec(r.view) || [])[1] ?? '',
    customer_name: (m ? m[1] : r.customer).trim(), mobile: m ? m[2] : '',
    package: r.package, sub_package: r.sub_package, start_date: toIso(r.start) ?? r.start, end_date: endIso ?? r.end,
    days_remaining: endIso ? dayNum(endIso) - dayNum(today) : null,
    status: 'Active', order_type: r.order_type, payment_status: r.payment_status,
  };
}

async function readDetails(page, rec) {
  await page.goto(`${BASE}/orders/view/${rec.order_internal_id}`, { waitUntil: 'domcontentloaded' });
  const text = await page.evaluate(() => document.body.innerText);
  const pick = (re) => (re.exec(text)?.[1] ?? '').trim();
  rec.customer_id = pick(/Unique Id\s*:\s*(\S+)/);
  rec.area = pick(/Area\s*:\s*([^\n]*)/);
  const shownNo = pick(/Order No\s*:\s*(\d+)/); const shownPhone = pick(/Contact no\s*:\s*(\d+)/);
  const shownName = pick(/Name\s*:\s*([^\n]*)/);
  rec.detail_check = shownNo === rec.order_no && shownName === rec.customer_name ? 'ok' : 'mismatch';
  if (shownPhone && shownPhone !== rec.mobile) rec.delivery_contact = shownPhone;
}

// One operational row per customer (customer = account phone on the list, else name).
// "latest" = the customer's active order with the latest End Date.
//   latest ends inside the window  -> ACTION_REQUIRED (row = that order; earlier expiring orders are listed, not repeated)
//   latest ends after the window   -> ALREADY_RENEWED (row = the customer's last expiring order + the renewal order)
const customerKey = (r) => r.mobile || `name:${r.customer_name}`;
function classify(expiring, all, days) {
  const byCustomer = new Map();
  for (const o of all) { const k = customerKey(o); if (!byCustomer.has(k)) byCustomer.set(k, []); byCustomer.get(k).push(o); }
  const actionRequired = []; const alreadyRenewed = []; const seen = new Set();
  for (const r of expiring) {
    const k = customerKey(r); const mine = byCustomer.get(k) ?? [r];
    const latest = mine.reduce((x, y) => (y.days_remaining > x.days_remaining ? y : x));
    const myExpiring = expiring.filter((o) => customerKey(o) === k).sort((x, y) => y.days_remaining - x.days_remaining);
    const renewed = latest.days_remaining > days;
    r.classification = renewed ? 'ALREADY_RENEWED' : 'ACTION_REQUIRED';
    r.active_orders_count = mine.length;
    r.later_active_order_no = latest.days_remaining > r.days_remaining ? latest.order_no : '';
    r.later_active_order_end = latest.days_remaining > r.days_remaining ? latest.end_date : '';
    r.customer_row = r === myExpiring[0]; // the one row that represents this customer
    if (seen.has(k)) continue;
    seen.add(k);
    const row = myExpiring[0];
    row.other_expiring_orders = myExpiring.slice(1).map((o) => o.order_no).join(' ');
    if (renewed) { row.renewal_order_no = latest.order_no; row.renewal_start_date = latest.start_date; row.renewal_end_date = latest.end_date; alreadyRenewed.push(row); }
    else actionRequired.push(row);
  }
  return { actionRequired, alreadyRenewed, customers: seen.size };
}

function selfTest() {
  const o = (order_no, mobile, days_remaining) => ({ order_no, mobile, customer_name: `c${mobile}`, days_remaining, start_date: '', end_date: `d${days_remaining}` });
  const all = [o('1', 'A', 2), o('2', 'B', 1), o('3', 'B', 25), o('4', 'C', 1), o('5', 'C', 3), o('6', 'D', 2), o('7', 'D', 3), o('8', 'D', 40), o('9', 'E', 0), o('10', 'E', 3), o('11', 'F', 9)];
  const { actionRequired: ar, alreadyRenewed: rn, customers } = classify(all.filter((r) => r.days_remaining >= 1 && r.days_remaining <= 3), all, 3);
  const got = JSON.stringify({ ar: ar.map((r) => [r.order_no, r.other_expiring_orders]), rn: rn.map((r) => [r.order_no, r.renewal_order_no, r.other_expiring_orders]), customers });
  const want = JSON.stringify({ ar: [['1', ''], ['5', '4'], ['10', '']], rn: [['2', '3', ''], ['7', '8', '6']], customers: 5 });
  console.log(got === want ? 'SELF-TEST PASS' : `SELF-TEST FAIL\n got ${got}\nwant ${want}`);
  process.exit(got === want ? 0 : 1);
}

const BASE_COLS = ['customer_id', 'customer_name', 'mobile', 'package', 'sub_package', 'start_date', 'end_date', 'days_remaining', 'status', 'area', 'order_no', 'order_type', 'payment_status'];
const COLS = {
  full: [...BASE_COLS, 'classification', 'customer_row', 'active_orders_count', 'later_active_order_no', 'later_active_order_end', 'detail_check'],
  action: [...BASE_COLS, 'classification', 'other_expiring_orders', 'active_orders_count', 'detail_check'],
  renewed: [...BASE_COLS, 'classification', 'renewal_order_no', 'renewal_start_date', 'renewal_end_date', 'other_expiring_orders', 'active_orders_count', 'detail_check'],
};
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (cols, rows) => `\uFEFF${[cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n')}\r\n`;
function writeAtomic(file, content) { const tmp = `${file}.tmp`; writeFileSync(tmp, content, { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, file); }

async function main() {
  if (process.argv.includes('--self-test')) selfTest();
  log(`Starting Nutreeze subscription expiry check (today ${today} Asia/Kuwait, window +1..+${DAYS} days)`);
  if (!CRED_FILE || !existsSync(CRED_FILE)) throw new Fail(10, 'credential file missing (owner step)');
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(60000);
    await login(page);
    log('Login/session verified');
    const all = (await readActiveOrders(page)).map(parseRow);
    const badDates = all.filter((r) => r.days_remaining == null);
    if (badDates.length > all.length * 0.02) throw new Fail(12, `${badDates.length} orders have unreadable end dates`);
    const customers = new Set(all.map((r) => r.mobile || r.customer_name));
    log(`Active orders read: ${all.length} (customers checked: ${customers.size})`);
    const inWindow = all.filter((r) => r.days_remaining >= 1 && r.days_remaining <= DAYS);
    const tests = inWindow.filter((r) => TEST_NAME.test(r.customer_name));
    const expiring = inWindow.filter((r) => !TEST_NAME.test(r.customer_name));
    const { actionRequired, alreadyRenewed, customers: expiringCustomers } = classify(expiring, all, DAYS);
    if (!NO_DETAILS) {
      for (const r of expiring) {
        for (let attempt = 1; ; attempt += 1) {
          try { await readDetails(page, r); break; } catch (e) { if (attempt >= 3) { r.detail_check = 'unread'; break; } await page.waitForTimeout(2000 * attempt); }
        }
      }
      const bad = expiring.filter((r) => r.detail_check !== 'ok').length;
      log(`Order pages opened for customer id/area: ${expiring.length} (not confirmed: ${bad})`);
    }
    const order = (a, b) => a.days_remaining - b.days_remaining || a.customer_name.localeCompare(b.customer_name);
    expiring.sort(order); actionRequired.sort(order); alreadyRenewed.sort(order);
    const count = (rows) => { const d = {}; for (const r of rows) d[r.end_date] = (d[r.end_date] || 0) + 1; return d; };
    const duplicates = expiring.length - expiringCustomers;
    log(`Expiring orders within ${DAYS} days: ${expiring.length} ${JSON.stringify(count(expiring))}; unique customers: ${expiringCustomers}; duplicate rows removed: ${duplicates}; test customers excluded: ${tests.length}`);
    log(`ACTION_REQUIRED: ${actionRequired.length} ${JSON.stringify(count(actionRequired))}`);
    log(`ALREADY_RENEWED: ${alreadyRenewed.length}`);
    const head = {
      generated_at_kuwait: kwNow(), today, timezone: 'Asia/Kuwait', window_days: DAYS, source_page: `${BASE}${LIST_PATH}`,
      active_orders_read: all.length, customers_checked: customers.size, expiring_orders: expiring.length, expiring_customers: expiringCustomers,
      action_required: actionRequired.length, already_renewed: alreadyRenewed.length, duplicate_rows_removed: duplicates,
      test_customers_excluded: tests.length, unreadable_end_dates: badDates.length,
    };
    const outputs = [ // [file suffix, rows, columns]; '' = full per-order audit report
      ['', expiring, COLS.full, { report: 'all_expiring_orders', by_end_date: count(expiring), expiring_count: expiring.length }],
      ['_action_required', actionRequired, COLS.action, { report: 'ACTION_REQUIRED', by_end_date: count(actionRequired) }],
      ['_already_renewed', alreadyRenewed, COLS.renewed, { report: 'ALREADY_RENEWED', by_end_date: count(alreadyRenewed) }],
    ];
    for (const [suffix, rows, cols, extra] of outputs) {
      const json = `${JSON.stringify({ ...head, ...extra, customers: rows }, null, 1)}\n`;
      for (const name of [today, 'latest']) { writeAtomic(join(OUT_DIR, `${name}${suffix}.json`), json); writeAtomic(join(OUT_DIR, `${name}${suffix}.csv`), toCsv(cols, rows)); }
    }
    if (DUMP_ALL) writeAtomic(join(OUT_DIR, `all-active-${today}.json`), JSON.stringify(all));
    log(`Reports generated: latest_action_required, latest_already_renewed, latest (full audit) — .json/.csv, plus ${today}_* copies`);
  } finally { await browser.close(); }
  log('Job completed successfully');
}

main().catch((e) => { log(`ERROR ${e.code ? `[${e.code}] ` : ''}${String(e.message).split('\n')[0]}`); process.exit(e.code || 1); });
