import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { defineExtractor, type ExtractCtx, type NormalizeFn } from '../extractors/base.ts';

const ctx: ExtractCtx = {
  dryRun: true,
  throttleMs: 0,
  retries: 0,
  retryBackoffMs: 0,
  navTimeoutMs: 1,
  screenshotDir: '/tmp/legacy-migration-test',
  baseUrl: 'https://legacy.test',
  readOnlyGetAllowlist: [],
};

describe('extractor calibration safety', () => {
  it('skips calibrated:false entities before navigation', async () => {
    const page = { goto: vi.fn() } as unknown as Page;
    const normalize = vi.fn(() => []) as NormalizeFn;
    const extract = defineExtractor('customers', normalize);

    const result = await extract(page, {
      path: '/placeholder/customers',
      calibrated: false,
      rowSelector: 'table tbody tr',
      columns: { id: 'td:nth-child(1)' },
    }, ctx);

    expect(result.status).toBe('NEEDS_CALIBRATION');
    expect(result.skipped_reason).toMatch(/not calibrated/);
    expect(result.row_count).toBe(0);
    expect(page.goto).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
  });
});
