import { parseLegacyAddress } from './legacy-address-parser.mjs';

// Fixtures model how a Symfony/PHP "User Details" page could render the address.
const cases = [
  {
    name: 'A) separate Block cell (the structure we want to confirm on the live page)',
    html: `<table><tr><td>House no :</td><td>5</td></tr>
           <tr><td>Building :</td><td>12A</td></tr>
           <tr><td>Block :</td><td>9</td></tr>
           <tr><td>Floor :</td><td>2</td></tr>
           <tr><td>Street :</td><td>3</td></tr>
           <tr><td>Area :</td><td>صباح السالم</td></tr>
           <tr><td>Contact no :</td><td>66299620</td></tr></table>`,
    expect: { house_no: '5', building: '12A', block: '9', floor: '2', street: '3', area: 'صباح السالم', contact: '66299620' },
  },
  {
    name: 'B) <br>-separated labels (also row-preserved -> Block separated)',
    html: `House no : 35<br>Block : 7<br>Street : 25<br>Area : جابر العلي<br>Contact no : 55442484`,
    expect: { house_no: '35', block: '7', street: '25', area: 'جابر العلي', contact: '55442484' },
  },
  {
    name: 'C) legacy "Building Name : 0, 9" merged pair (frozen flattened data) -> block = 2nd number (9)',
    html: `House no : 35,Building Name : 0, 9, Street : 3, Area : صباح السالم Contact no : 66299620`,
    expect: { house_no: '35', street: '3', area: 'صباح السالم', contact: '66299620', block: '9' },
  },
  {
    name: 'D) free-text delivery instruction in House no (should still capture other fields)',
    html: `House no : leave on the black table<br>Block : 5<br>Street : 100<br>Area : العدان<br>Contact no : 66663190`,
    expect: { block: '5', street: '100', area: 'العدان', contact: '66663190' },
  },
  {
    name: 'E) real legacy <address> element (unlabelled BLOCK between Building Name and Street)',
    html: `<address>House no : 32,Building Name : 0,</br> 4, Street : 8,</br> Area : مشرف</br> Contact no : 97516928</address>`,
    expect: { house_no: '32', building: '0', block: '4', street: '8', area: 'مشرف', contact: '97516928' },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = parseLegacyAddress(c.html, { isHtml: true });
  const checks = Object.entries(c.expect).map(([k, v]) => [k, v, got[k]]);
  const ok = checks.every(([, v, g]) => (v === undefined ? g == null : g === v));
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log('   parsed:', JSON.stringify(got));
  for (const [k, v, g] of checks) if ((v === undefined ? g != null : g !== v)) console.log(`   MISMATCH ${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(g)}`);
  ok ? pass++ : fail++;
}
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
