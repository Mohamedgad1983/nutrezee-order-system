import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// TS-I — m22 importer apply-guard matrix (Phase 5 widened to allow last_90_days under explicit
// per-scope confirmation). Spawns the real importer; every refusal exits 2 before any DB load.

const run = promisify(execFile);
const SCRIPT = path.resolve(__dirname, '../../../tools/legacy-full-migration/meal-history-import.mjs');

async function spawn(env: Record<string, string>) {
  try {
    const { stdout } = await run('node', [SCRIPT], { env: { ...process.env, ...env } });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}
const fatalOf = (out: string): string => (out.match(/"fatal":"([^"]*)"/) || [])[1] ?? '';
const APPLY = { MEAL_IMPORT_MODE: 'apply' };

describe('TS-I importer apply guards (Phase 5: last-90 gated)', () => {
  it('refuses production', async () => {
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'production', MEAL_IMPORT_SCOPE: 'last_90_days' })).out)).toMatch(/no production|SYNC_TARGET=staging/);
  });

  it('refuses full-history apply', async () => {
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'full' })).out)).toMatch(/ALLOW_FULL_HISTORY|whole-history/);
  });

  it('refuses last-year apply (not an applyable scope)', async () => {
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'last_year' })).out)).toMatch(/scope must be one of|no full\/last_year/);
  });

  it('refuses an unknown apply scope', async () => {
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'everything' })).out)).toMatch(/scope must be one of/);
  });

  it('allows last-90 apply ONLY with the explicit per-scope confirm token', async () => {
    // missing token -> refused (and it must be the LAST-90 token, not the last-30 one)
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'last_90_days' })).out)).toMatch(/APPLY_LAST_90_STAGING/);
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'last_90_days', MEAL_IMPORT_APPLY_CONFIRM: 'APPLY_LAST_30_STAGING' })).out)).toMatch(/APPLY_LAST_90_STAGING/);
  });

  it('refuses last-90 apply without the VPS-source assertion', async () => {
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'last_90_days', MEAL_IMPORT_APPLY_CONFIRM: 'APPLY_LAST_90_STAGING' })).out)).toMatch(/MEAL_IMPORT_SOURCE_VPS=1/);
  });

  it('keeps last-30 apply gated on its own token (scope tokens are not interchangeable)', async () => {
    expect(fatalOf((await spawn({ ...APPLY, SYNC_TARGET: 'staging', MEAL_IMPORT_SCOPE: 'last_30_days', MEAL_IMPORT_APPLY_CONFIRM: 'APPLY_LAST_90_STAGING' })).out)).toMatch(/APPLY_LAST_30_STAGING/);
  });
});
