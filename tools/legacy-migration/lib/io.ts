// Output writer. Everything lands under migration-output/ (gitignored) — raw, normalized,
// CSV and per-run reports. Extracted customer/order data is NEVER committed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.ts';
import { toCsv } from '../exporters/csv-exporter.ts';
import { toJson } from '../exporters/json-exporter.ts';
import type { ExtractionResult } from './types.ts';

export const OUTPUT_ROOT = process.env.MIGRATION_OUTPUT_DIR ?? 'migration-output';

export function runDir(stamp: string): string {
  const dir = join(OUTPUT_ROOT, stamp);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  mkdirSync(join(dir, 'normalized'), { recursive: true });
  mkdirSync(join(dir, 'csv'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  return dir;
}

/** Persist one entity's raw + normalized + CSV outputs. */
export function writeExtraction(dir: string, r: ExtractionResult): void {
  writeFileSync(join(dir, 'raw', `${r.entity}.json`), toJson(r.raw));
  writeFileSync(join(dir, 'normalized', `${r.entity}.json`), toJson(r.normalized.map((n) => ({ legacy_id: n.legacy_id, confidence: n.confidence, notes: n.notes, ...n.data }))));
  writeFileSync(join(dir, 'csv', `${r.entity}.csv`), toCsv(r.normalized.map((n) => ({ legacy_id: n.legacy_id, confidence: n.confidence, ...n.data }))));
  log.info(`wrote ${r.entity}: ${r.row_count} rows (${dir})`);
}

export function writeReport(dir: string, name: string, markdown: string): void {
  writeFileSync(join(dir, 'reports', name), markdown);
  log.info(`report → ${join(dir, 'reports', name)}`);
}

export function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), toJson(value));
}
