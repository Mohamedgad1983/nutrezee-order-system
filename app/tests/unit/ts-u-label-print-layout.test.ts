import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../apps/admin/src/components/labelSheet.css', import.meta.url),
  'utf8',
);
const labelsPage = readFileSync(
  new URL('../../apps/admin/src/pages/Labels.tsx', import.meta.url),
  'utf8',
);

describe('TS-U label print layout', () => {
  it('marks the labels screen so print rules do not affect other admin pages', () => {
    expect(labelsPage).toContain('<section className="labelsPage">');
    expect(css).toContain('body:has(.labelsPage)');
  });

  it('removes app chrome from pagination instead of preserving hidden shell geometry', () => {
    expect(css).not.toMatch(/body\s+\*\s*\{\s*visibility:\s*hidden/);
    expect(css).toContain('.labelsPage > :not(.labelPrintRoot)');
    expect(css).toMatch(/\.labelsPage > :not\(\.labelPrintRoot\)\s*\{[\s\S]*?display: none !important;/);
    expect(css).toMatch(/\.labelPrintRoot\s*\{[\s\S]*?position: static;/);
  });
});
