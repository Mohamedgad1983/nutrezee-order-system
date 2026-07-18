// Phase-2 verification: re-parse the saved raw pages with the CURRENT parser and
// cross-check the recovered BLOCK against an independent ground-truth extraction
// (the unlabelled token between "Building Name :" and "Street :" in the <address>).
// Offline; reads block-sample/raw/*.html.gz. No legacy contact.
//   node compare-block-sample.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseLegacyAddress } from './legacy-address-parser.mjs';

const RAW = './block-sample/raw';
const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.html.gz')).sort();

// independent ground truth: token immediately before "Street :" inside <address>
function truthBlock(html) {
  const am = html.match(/<address>([\s\S]*?)<\/address>/i);
  if (!am) return { populated: false, block: null };
  const seg = am[1].replace(/<\s*\/?br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const m = seg.match(/(?:^|\n|,)\s*([0-9]{1,4}\s*[A-Za-z]?)\s*,?\s*Street\s*:/i);
  return { populated: true, block: m ? m[1].replace(/\s+/g, '') : null };
}

let populated = 0, parsedBlock = 0, matches = 0, empty = 0;
console.log('| id | parsed.block | truth.block | match | street | area | house |');
console.log('|----|----|----|----|----|----|----|');
for (const f of files) {
  const id = f.replace(/\D/g, '');
  const html = zlib.gunzipSync(fs.readFileSync(`${RAW}/${f}`)).toString('utf8');
  const p = parseLegacyAddress(html, { isHtml: true });
  const t = truthBlock(html);
  if (!t.populated) { empty++; console.log(`| ${id} | — | — | (empty profile) | | | |`); continue; }
  populated++;
  if (p.block != null) parsedBlock++;
  const ok = (p.block ?? null) === (t.block ?? null);
  if (ok) matches++;
  console.log(`| ${id} | ${p.block ?? '∅'} | ${t.block ?? '∅'} | ${ok ? '✅' : '❌'} | ${p.street ?? '∅'} | ${p.area ?? '∅'} | ${p.house_no ?? '∅'} |`);
}
console.log(`\nsampled=${files.length}  populated=${populated}  empty_profiles=${empty}`);
console.log(`parsed.block populated for ${parsedBlock}/${populated} populated records`);
console.log(`BLOCK CORRECTNESS (parser vs independent ground-truth): ${matches}/${populated} = ${populated ? (100 * matches / populated).toFixed(0) : 0}%`);
