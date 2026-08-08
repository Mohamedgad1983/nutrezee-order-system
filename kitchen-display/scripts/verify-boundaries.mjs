import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('../src/', import.meta.url);
const forbiddenCouplings = [
  'Fleetbase',
  'Navigator',
  'm25-label',
  'NUTREEZE_PARTNER_LABEL',
  'apps/api',
  'driver_id',
  'vehicle_id',
];
const forbiddenProjectionFields = [
  'itemRef',
  'item_ref',
  'order_number',
  'customer_name',
  'phone',
  'address',
];

const files = await walk(sourceRoot);
const failures = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const label = relative(root.pathname, file.pathname);
  for (const token of forbiddenCouplings) {
    if (text.includes(token)) failures.push(`${label}: forbidden coupling ${token}`);
  }
  if (!label.endsWith('api/partner-source.ts')) {
    for (const token of forbiddenProjectionFields) {
      const pattern = new RegExp(`(?:\\.${token}\\b|['\"]${token}['\"]\\s*:|\\b${token}\\b\\s*[?:]?:)`);
      if (pattern.test(text)) failures.push(`${label}: forbidden projection field ${token}`);
    }
  }
}

const partner = await readFile(new URL('../src/api/partner-source.ts', import.meta.url), 'utf8');
for (const match of partner.matchAll(/method:\s*['"]([^'"]+)['"]/g)) {
  if (match[1] !== 'GET') failures.push(`partner-source.ts: non-read method ${match[1]}`);
}
if (!partner.includes('/order-items')) failures.push('partner-source.ts: documented endpoint missing');
if (!partner.includes("'X-Api-Key'")) failures.push('partner-source.ts: protected header missing');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`KDS boundary scan passed (${files.length} source files).`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) output.push(...await walk(child));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) output.push(child);
  }
  return output;
}
