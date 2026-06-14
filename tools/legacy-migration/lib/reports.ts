// Markdown report generators. Output goes to migration-output/<stamp>/reports/.

import type { ComparisonResult, ExtractionResult } from './types.ts';

export function extractionSummary(results: ExtractionResult[]): string {
  const rows = results.map((r) => {
    const c = r.confidence_breakdown;
    const status = r.skipped_reason ? `skipped (${r.skipped_reason})` : 'ok';
    return `| ${r.entity} | \`${r.source}\` | ${r.row_count} | ${r.pages} | ${c.VERIFIED} | ${c.INFERRED} | ${c.NEEDS_MANUAL_REVIEW} | ${status} |`;
  });
  const totalRows = results.reduce((s, r) => s + r.row_count, 0);
  return `# Extraction Summary

Generated: ${new Date().toISOString()} · mode: ${results[0]?.dry_run ? 'DRY-RUN (read-only)' : 'extract'}

| Entity | Legacy source | Rows | Pages | VERIFIED | INFERRED | NEEDS_MANUAL_REVIEW | Status |
|---|---|--:|--:|--:|--:|--:|---|
${rows.join('\n')}

**Total rows extracted:** ${totalRows}

> Raw JSON, normalized JSON and CSV per entity are alongside this report (../raw, ../normalized, ../csv). Screenshots in ../screenshots. **No legacy data is committed to git.**
`;
}

export function coverageReport(comparisons: ComparisonResult[]): string {
  const rows = comparisons.map((c) =>
    `| ${c.entity} | ${c.legacy_count} | ${c.new_count} | ${c.matched} | ${c.only_in_legacy} | ${c.only_in_new} | ${c.missing_required_new_fields.join('; ') || '—'} |`);
  const blockers = comparisons.flatMap((c) => c.blockers.map((b) => `- **${c.entity}:** ${b}`));
  return `# Legacy ↔ New Coverage / Reconciliation

Generated: ${new Date().toISOString()}

| Entity | Legacy | New | Matched | Only legacy | Only new | New requires (legacy lacks) |
|---|--:|--:|--:|--:|--:|---|
${rows.join('\n')}

## Blockers & notes
${blockers.length ? blockers.join('\n') : '- none'}
`;
}

export function readinessReport(
  extractions: ExtractionResult[],
  comparisons: ComparisonResult[],
  ctx: { legacyAvailable: boolean; newAvailable: boolean },
): string {
  const needReview = extractions.reduce((s, e) => s + e.confidence_breakdown.NEEDS_MANUAL_REVIEW, 0);
  const totalRows = extractions.reduce((s, e) => s + e.row_count, 0);
  const ready = ctx.legacyAvailable && ctx.newAvailable && totalRows > 0 && needReview === 0;
  const allBlockers = comparisons.flatMap((c) => c.blockers);
  return `# Migration Readiness Report

Generated: ${new Date().toISOString()}

## Verdict: ${ready ? '🟢 DRY-RUN CLEAN — ready to prepare import files for review' : '🟡 NOT READY — see blockers'}

- Legacy access: ${ctx.legacyAvailable ? '✅ connected (read-only)' : '⛔ NOT PROVIDED — set LEGACY_BASE_URL / LEGACY_ADMIN_EMAIL / LEGACY_ADMIN_PASSWORD'}
- New-system access: ${ctx.newAvailable ? '✅ connected' : '⛔ NOT PROVIDED — set NEW_STAGING_URL / NEW_ADMIN_EMAIL / NEW_ADMIN_PASSWORD'}
- Rows extracted: ${totalRows}
- Rows needing manual review: ${needReview}

## What is ready
${ctx.legacyAvailable ? '- Extraction harness ran against the live legacy DOM.' : '- Toolkit, safety layer, normalizers, comparators and reports are built and unit-tested; waiting only on legacy credentials.'}

## What still needs manual access / decisions
- **Legacy credentials + URL** (the S1 blocker) — until provided, extraction is a no-op scaffold.
- **Selector calibration** — once legacy access lands, tune \`config.json\` per-entity \`rowSelector\`/\`columns\` against the real DOM (every entity then flips from \`calibrated:false\`).
- **NEEDS_MANUAL_REVIEW rows** must be resolved before any import (never auto-applied).

## Blockers
${allBlockers.length ? allBlockers.map((b) => `- ${b}`).join('\n') : '- none'}

## Next step (NOT done by this toolkit)
This toolkit produces **extraction + comparison + import-ready files only**. The actual import is a separate, explicitly-instructed step: feed the reviewed normalized files into the new system's M19 import \`/imports/<batch>/dry-run\` → human review → \`/apply\`. **Never** run apply from this toolkit.
`;
}
