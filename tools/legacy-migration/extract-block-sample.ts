// SCOPED, READ-ONLY block-capture test pull (Phase 2). Fetches at most LIMIT (default 20)
// legacy customer pages, SAVES RAW HTML, parses with the block-aware parser, and writes a
// DRY-RUN jsonl. It NEVER writes to the `address` table or any DB. Mirrors the proven
// extract-details.ts auth/safety exactly; only the scope + parser + raw-HTML capture differ.
//
// Run from the legacy-migration tool dir (so ./lib/*.ts resolve), with legacy creds in ENV:
//   LEGACY_BASE_URL, LEGACY_ADMIN_EMAIL, LEGACY_ADMIN_PASSWORD
//   optional: SAMPLE_LIMIT (default 20), SAMPLE_IDS="20191,20186,..." (else first N ids)
import fs from 'node:fs';
import zlib from 'node:zlib';
import { loadConfig, resolveSecrets } from './lib/config.ts';
import { launchContexts } from './lib/browser.ts';
import { installLegacySafety } from './lib/safety.ts';
import { parseLegacyAddress } from './legacy-address-parser.mjs';

const OUT = './block-sample';
const RAW = OUT + '/raw';
const JSONL = OUT + '/block_sample.jsonl';
const LIMIT = Math.min(parseInt(process.env.SAMPLE_LIMIT || '20', 10) || 20, 25); // hard cap 25
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(JSONL, ''); // fresh dry-run output
  const cfg = loadConfig();
  const s: any = resolveSecrets(cfg);
  const base = s.legacyBaseUrl;
  if (!base || !s.legacyEmail || !s.legacyPassword) {
    console.error('Missing LEGACY_BASE_URL / LEGACY_ADMIN_EMAIL / LEGACY_ADMIN_PASSWORD in env. Aborting.');
    process.exit(2);
  }
  const ctxs = await launchContexts({ navTimeoutMs: 45000 });
  const safety = await installLegacySafety(ctxs.legacy, {
    baseUrl: base,
    authPostAllowlist: cfg.legacy.authPostAllowlist,
    readOnlyGetAllowlist: cfg.legacy.readOnlyGetAllowlist,
  });
  const page = await ctxs.legacy.newPage();
  await page.goto(base + cfg.legacy.loginPath, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.fill(cfg.legacy.emailSelector, s.legacyEmail).catch(() => {});
  await page.fill(cfg.legacy.passwordSelector, s.legacyPassword).catch(() => {});
  await page.click(cfg.legacy.submitSelector).catch(() => {});
  await page.waitForTimeout(3500);
  safety.enableStrictReadOnly(); // <-- from here on, GET-only; any POST/write is blocked

  // pick ids: explicit SAMPLE_IDS, else first LIMIT from the user list ajax
  let ids: string[] = (process.env.SAMPLE_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) {
    const r = await ctxs.legacy.request.get(
      `${base}/serversideuserlist?draw=1&start=0&length=${LIMIT * 3}&order[0][column]=1&order[0][dir]=desc`,
      { timeout: 120000 });
    const j = JSON.parse(await r.text());
    ids = [...new Set((j.data || []).map((row: any) => {
      const m = JSON.stringify(row).match(/viewUser\/3\/(\d+)/); return m ? m[1] : null;
    }).filter(Boolean))] as string[];
  }
  ids = ids.slice(0, LIMIT);
  console.log(JSON.stringify({ phase: 'sample', limit: LIMIT, ids: ids.length }));

  let ok = 0, err = 0;
  for (const id of ids) {
    try {
      const resp = await ctxs.legacy.request.get(`${base}/users/viewUser/3/${id}`, { timeout: 30000 });
      if (resp.status() !== 200) { err++; continue; }
      const html = await resp.text();
      fs.writeFileSync(`${RAW}/cust_${id}.html.gz`, zlib.gzipSync(Buffer.from(html, 'utf8'))); // raw kept
      const parsed = parseLegacyAddress(html, { isHtml: true });
      fs.appendFileSync(JSONL, JSON.stringify({ id, parsed }) + '\n');
      ok++;
    } catch (e) {
      fs.appendFileSync(JSONL, JSON.stringify({ id, error: String(e).slice(0, 120) }) + '\n');
      err++;
    }
    await sleep(cfg.throttleMs || 1500); // same gentle throttle as the proven scraper
  }
  console.log(JSON.stringify({ BLOCK_SAMPLE_DONE: true, ok, err, raw_dir: RAW, dryrun_out: JSONL }));
  await ctxs.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
