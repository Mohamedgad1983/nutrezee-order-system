import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// TS-I — m22 VPS scraper guards + dry-run candidate selection. Spawns the real script (it imports
// only the pure lib, no pg). Proves: production/concurrency/output-path/no-local/VPS-context guards
// refuse; dry-run window selection is deterministic; no secrets are printed.

const run = promisify(execFile);
const SCRIPT = path.resolve(__dirname, '../../../tools/legacy-full-migration/meal-history-scrape-job.mjs');
let dir: string;
let ordersIndex: string;
let runHistory: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm22scrape-'));
  ordersIndex = path.join(dir, 'orders_index.jsonl');
  runHistory = path.join(dir, 'run-history.jsonl');
  // A: in last-90 & custom; B: only in custom (older); C: far past — neither
  fs.writeFileSync(ordersIndex, [
    JSON.stringify({ internal_id: '100', order_number: '200', start: '01-06-2026', end: '30-06-2026' }),
    JSON.stringify({ internal_id: '101', order_number: '201', start: '01-08-2025', end: '31-08-2025' }),
    JSON.stringify({ internal_id: '102', order_number: '202', start: '01-01-2024', end: '31-01-2024' }),
  ].join('\n'));
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function spawn(args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout } = await run('node', [SCRIPT, ...args], { env: { ...process.env, ORDERS_INDEX: ordersIndex, RUN_HISTORY: runHistory, ...env } });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}
const fatalOf = (out: string): string => (out.match(/"fatal":"([^"]*)"/) || [])[1] ?? '';
const summaryOf = (out: string): Record<string, unknown> => {
  const line = out.split('\n').find((l) => l.startsWith('SUMMARY '));
  return line ? JSON.parse(line.slice('SUMMARY '.length)) : {};
};

describe('TS-I meal-history scraper guards', () => {
  it('refuses missing/production target', async () => {
    expect(fatalOf((await spawn(['--mode', 'dry-run'])).out)).toMatch(/missing --target/);
    expect(fatalOf((await spawn(['--mode', 'dry-run', '--target', 'production'])).out)).toMatch(/must be staging/);
  });

  it('refuses concurrency over the safe cap', async () => {
    expect(fatalOf((await spawn(['--mode', 'scrape', '--target', 'staging', '--concurrency', '9'])).out)).toMatch(/exceeds safe cap/);
  });

  it('refuses an output dir outside the approved VPS prefix', async () => {
    expect(fatalOf((await spawn(['--mode', 'scrape', '--target', 'staging', '--output-dir', '/tmp/evil'])).out)).toMatch(/must be under/);
  });

  it('refuses local scraping (no --no-local / no VPS context)', async () => {
    const r = await spawn(['--mode', 'scrape', '--target', 'staging', '--no-local']);
    expect(fatalOf(r.out)).toMatch(/cannot prove VPS context|no local scraping/);
  });

  it('refuses full-history window without the approval flag', async () => {
    expect(fatalOf((await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'last-year'])).out)).toMatch(/full-history|ALLOW_FULL_HISTORY_SCRAPE/);
  });

  it('refuses span-bypass via --since and unknown --window (gate is on the computed span)', async () => {
    expect(fatalOf((await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'last-90', '--since', '2000-01-01'])).out)).toMatch(/window too wide|ALLOW_FULL_HISTORY_SCRAPE/);
    expect(fatalOf((await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'everything'])).out)).toMatch(/unknown --window/);
  });

  it('refuses a non-integer concurrency', async () => {
    expect(fatalOf((await spawn(['--mode', 'scrape', '--target', 'staging', '--concurrency', 'abc'])).out)).toMatch(/positive integer/);
  });

  it('never prints credentials/cookies', async () => {
    const r = await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'last-90'], {
      LEGACY_ADMIN_EMAIL: 'secret@x', LEGACY_ADMIN_PASSWORD: 'TOPSECRET', LEGACY_BASE_URL: 'https://legacy',
    });
    expect(r.out).not.toContain('TOPSECRET');
    expect(r.out).not.toContain('secret@x');
  });
});

describe('TS-I meal-history scraper dry-run candidate selection', () => {
  it('selects only orders overlapping the last-90 window', async () => {
    const r = await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'last-90', '--until', '2026-06-17']);
    const s = summaryOf(r.out);
    expect(s.records_candidate).toBe(1);   // only order A (Jun 2026)
    expect(s.window_from).toBe('2026-03-19');
    expect(s.window_to).toBe('2026-06-17');
    expect(s.ok).toBe(true);
  });

  it('a wide custom window needs the approval flag, then widens deterministically', async () => {
    // wide custom (Aug 2025 -> Jun 2026 ~= 381d > 100d span cap) is refused without the flag
    const refused = await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'custom', '--since', '2025-06-01', '--until', '2026-06-17']);
    expect(fatalOf(refused.out)).toMatch(/window too wide|ALLOW_FULL_HISTORY_SCRAPE/);
    // with explicit approval, it widens to include B (Aug 2025) + A (Jun 2026)
    const ok = await spawn(['--mode', 'dry-run', '--target', 'staging', '--window', 'custom', '--since', '2025-06-01', '--until', '2026-06-17'], { ALLOW_FULL_HISTORY_SCRAPE: '1' });
    expect(summaryOf(ok.out).records_candidate).toBe(2);   // A + B; C (2024) excluded
  });
});
