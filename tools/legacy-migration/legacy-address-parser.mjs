// Block-aware parser for the legacy "User Details" page address block.
//
// Why this exists: the original extract-details.ts flattened ALL html to a single
// space-joined string (clean()) then sliced text BETWEEN two labels
// (`between('Building Name','Street')`). That merged any separate "Block"/"Floor"
// cells into one value (the infamous "0, 9" pair) and truncated to 120 chars — so a
// reliable BLOCK field was lost. Kuwait door-level delivery needs Area + Block + Street.
//
// The fix here:
//   1) preserve row/line boundaries BEFORE stripping tags (so each labelled field
//      stays on its own line and Block never merges into Building/Floor), and
//   2) tokenize by the FULL known label set (longest-first) so each label —
//      including a dedicated `Block` — maps to its own field.
//
// Pure + dependency-free so it can be unit-tested offline and reused by the scraper.

const BLOCK_TAGS = /<\s*\/?(br|tr|td|th|p|div|li|dt|dd|h[1-6])\s*\/?>/gi;
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&apos;': "'" };

export function htmlToLines(html) {
  if (!html) return [];
  let t = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')          // <-- key: row boundary -> newline BEFORE stripping
    .replace(/<[^>]+>/g, ' ');          // strip remaining inline tags
  t = t.replace(/&#x?[0-9a-f]+;|&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');
  return t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Longest / most specific first so "Building Name" wins over "Building", etc.
const LABELS = [
  'House no', 'Building Name', 'Building', 'Block', 'Floor', 'Flat', 'Apartment',
  'Street', 'Avenue', 'Jadda', 'Area', 'Contact no', 'Mobile No', 'Email',
  'Gender', 'Date of Birth', 'Height', 'Weight', 'Wallet Amount', 'Name',
];
const FIELD = {
  'house no': 'house_no', 'building name': 'building', 'building': 'building',
  'block': 'block', 'floor': 'floor', 'flat': 'flat', 'apartment': 'flat',
  'street': 'street', 'avenue': 'avenue', 'jadda': 'avenue', 'area': 'area',
  'contact no': 'contact', 'mobile no': 'mobile', 'email': 'email', 'gender': 'gender',
  'date of birth': 'dob', 'height': 'height', 'weight': 'weight',
  'wallet amount': 'wallet', 'name': 'name',
};
const labelAlt = LABELS.map((l) => l.replace(/ /g, '\\s+')).join('|');
// match "<label> : <value>" where value runs until the next known label or end
const TOKEN = new RegExp(`(${labelAlt})\\s*:?\\s*([\\s\\S]*?)(?=(?:${labelAlt})\\s*:|$)`, 'gi');

function norm(v) {
  if (v == null) return null;
  v = String(v).replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '').trim();
  if (!v) return null;
  const low = v.toLowerCase();
  if (['none', 'new password', 'address details', '-', 'na', 'n/a', 'null', '.'].includes(low)) return null;
  return v;
}

/**
 * Parse the address block from either raw HTML or already-flattened text.
 * Returns granular fields; `block` is now its OWN field (no longer collapsed).
 */
export function parseLegacyAddress(input, { isHtml = true } = {}) {
  const text = (isHtml ? htmlToLines(input) : String(input).split('\n')).join('\n');
  const out = {};
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    const key = FIELD[m[1].replace(/\s+/g, ' ').trim().toLowerCase()];
    const val = norm(m[2]);
    if (key && val != null && out[key] == null) out[key] = val;
  }
  // AUTHORITATIVE <address> PARSE (verified against 20 live pages 2026-06-26).
  // The legacy <address> element is positional:
  //   House no : <h>, Building Name : <b>,</br> <BLOCK>, Street : <s>,</br> Area : <a></br> Contact no : <c>
  // The Kuwait BLOCK is an UNLABELLED number between "Building Name :" and "Street :"
  // (the old flattener merged it into the "Building Name : 0, 9" pair). Parse each
  // field comma/newline-bounded so building stays clean and block is its own value.
  if (isHtml) {
    const am = String(input).match(/<address>([\s\S]*?)<\/address>/i);
    if (am) {
      const seg = am[1]
        .replace(/<\s*\/?br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x?[0-9a-f]+;|&[a-z]+;/gi, (x) => ENTITIES[x.toLowerCase()] ?? ' ');
      const grab = (re) => { const m = seg.match(re); return m ? norm(m[1]) : null; };
      const f = {
        house_no: grab(/House no\s*:\s*([^,\n]*)/i),
        building: grab(/Building Name\s*:\s*([^,\n]*)/i),
        street: grab(/Street\s*:\s*([^,\n]*)/i),
        area: grab(/Area\s*:\s*([^,\n]*)/i),
        contact: grab(/Contact no\s*:\s*([\d +]+)/i),
        // the bare token immediately before "Street :" is the block
        block: (() => { const m = seg.match(/(?:^|\n|,)\s*([0-9]{1,4}\s*[A-Za-z]?)\s*,?\s*Street\s*:/i); return m ? m[1].replace(/\s+/g, '') : null; })(),
      };
      for (const k of Object.keys(f)) if (f[k] != null) out[k] = f[k]; // <address> is authoritative
    }
  }
  // Fallback for already-flattened legacy text (no <address>): the merged
  // "Building Name : 0, 9" pair's SECOND number is the block.
  if (out.block == null && out.building) {
    const pm = String(out.building).match(/^\s*\d+\s*,\s*(\d+)\s*$/);
    if (pm) out.block = pm[1];
  }
  return out;
}
