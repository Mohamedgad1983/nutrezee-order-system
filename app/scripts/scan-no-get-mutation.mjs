// CI guard (backend_foundation §8, GAP-SEC-02 lesson): no state mutation on GET.
// Static scan: inside every @Get() handler body, calls that look like writes are
// forbidden. Conservative name-based heuristic; escape hatch comment is deliberately
// NOT provided — a GET that needs a "write" is a design defect, fix the design.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../apps/api/src/', import.meta.url).pathname;
const WRITE_CALL = /\.(create|insert|update|delete|remove|save|write|set|merge|apply|transition|claim|store|enqueue|end|login|logout)\w*\s*\(/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.controller.ts')) yield p;
  }
}

let violations = 0;
for await (const file of walk(ROOT)) {
  const src = await readFile(file, 'utf8');
  // split on decorator boundaries; examine blocks that start with @Get
  const blocks = src.split(/(?=@(?:Get|Post|Put|Patch|Delete)\()/);
  for (const block of blocks) {
    if (!block.startsWith('@Get(')) continue;
    // body of this handler = up to the next decorator or end of class
    const body = block.split(/(?=@(?:Get|Post|Put|Patch|Delete)\()/)[0];
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      if (WRITE_CALL.test(line) && !line.trim().startsWith('//')) {
        violations += 1;
        console.error(`GET-mutation violation: ${file} (~line offset ${i}): ${line.trim()}`);
      }
    });
  }
}

if (violations > 0) {
  console.error(`no-get-mutation-scan FAILED: ${violations} violation(s)`);
  process.exit(1);
}
console.log('no-get-mutation-scan OK');
