// WP-LBL-A27 — permanent customer barcode value codec + Code128-B renderer.
//
// Lives in `shared` because the API issues/validates values and the admin SPA renders them; both
// must agree bit-for-bit. Deliberately dependency-free (the "no new npm dependencies" rule) and
// pure — randomness is injected, so the same generator is deterministic under test.
//
// Value format:  NZC-XXXX-XXXX-CC
//   NZC        fixed prefix
//   XXXXXXXX   8 payload symbols drawn at random from a 32-symbol ambiguity-free alphabet
//   CC         2 check symbols derived from the payload
//
// The payload is random and is NEVER derived from a customer id, name, phone or any other
// attribute, so the printed barcode encodes no PII.

/** Crockford-style base32: digits + letters with I, L, O and U removed (mis-scan/mis-read pairs). */
export const BARCODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BARCODE_PREFIX = 'NZC';
export const BARCODE_PAYLOAD_LENGTH = 8;
export const BARCODE_CHECK_LENGTH = 2;

/** `NZC-8H4P-72KM-91` */
const BARCODE_PATTERN = /^NZC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/;

/**
 * Two check symbols over the 8 payload symbols: a position-weighted sum mod 1024, split into two
 * base-32 digits. Catches every single-symbol error and every adjacent transposition.
 */
export function computeBarcodeCheck(payload: string): string {
  if (payload.length !== BARCODE_PAYLOAD_LENGTH) {
    throw new Error(`barcode payload must be ${BARCODE_PAYLOAD_LENGTH} symbols`);
  }
  let sum = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const value = BARCODE_ALPHABET.indexOf(payload[i]!);
    if (value < 0) throw new Error(`barcode payload symbol out of alphabet: ${payload[i]}`);
    sum += value * (i + 1);
  }
  sum %= 1024;
  return BARCODE_ALPHABET[(sum >> 5) & 31]! + BARCODE_ALPHABET[sum & 31]!;
}

/** 8 payload symbols -> the printed value `NZC-XXXX-XXXX-CC`. */
export function formatBarcodeValue(payload: string): string {
  const check = computeBarcodeCheck(payload);
  return `${BARCODE_PREFIX}-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${check}`;
}

/** Shape + check-symbol validation. Rejects anything a scanner could have garbled. */
export function isValidBarcodeValue(value: string): boolean {
  if (!BARCODE_PATTERN.test(value)) return false;
  const [, a, b, check] = value.split('-') as [string, string, string, string];
  return computeBarcodeCheck(a + b) === check;
}

/**
 * Scanner input hygiene: strip whitespace, upper-case, and re-group a value whose hyphens were
 * dropped by the scanner keyboard wedge. Returns the input unchanged when it cannot be repaired,
 * so the caller still sees an invalid value rather than a silently wrong one.
 */
export function normalizeScannedBarcode(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (BARCODE_PATTERN.test(cleaned)) return cleaned;
  const bare = cleaned.replace(/-/g, '');
  if (/^NZC[0-9A-HJKMNP-TV-Z]{10}$/.test(bare)) {
    return `${BARCODE_PREFIX}-${bare.slice(3, 7)}-${bare.slice(7, 11)}-${bare.slice(11, 13)}`;
  }
  return cleaned;
}

/**
 * Generate a payload. `randomInt(maxExclusive)` is injected so the API can pass a CSPRNG and tests
 * can pass a deterministic sequence.
 */
export function generateBarcodePayload(randomInt: (maxExclusive: number) => number): string {
  let out = '';
  for (let i = 0; i < BARCODE_PAYLOAD_LENGTH; i += 1) {
    out += BARCODE_ALPHABET[randomInt(BARCODE_ALPHABET.length)]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code 128-B renderer
// ---------------------------------------------------------------------------

/**
 * The 107 Code 128 element-width patterns (index 0..106). Each string is the widths of six
 * alternating elements starting with a bar; index 106 (STOP) has seven.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

/**
 * Encode `text` as Code 128 Set B and return the ordered element widths, starting with a bar and
 * alternating bar/space. Throws on any character outside Set B (ASCII 32..126).
 */
export function encodeCode128B(text: string): number[] {
  if (text.length === 0) throw new Error('code128: empty text');
  let checksum = CODE128_START_B;
  const codes: number[] = [CODE128_START_B];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i) - 32;
    if (code < 0 || code > 94) throw new Error(`code128: character out of Set B: ${text[i]}`);
    codes.push(code);
    checksum += code * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);

  const widths: number[] = [];
  for (const code of codes) {
    for (const ch of CODE128_PATTERNS[code]!) widths.push(Number(ch));
  }
  return widths;
}

export interface Code128SvgOptions {
  /** Width of one narrow module, in the SVG's user units. */
  moduleWidth?: number;
  /** Bar height in user units. */
  height?: number;
  /** Quiet zone in modules on each side. Code 128 requires >= 10. */
  quietModules?: number;
}

/**
 * Render `text` as a self-contained, print-safe Code 128-B `<svg>` string — pure black bars on a
 * white ground, no external references, no fonts. The human-readable line is rendered separately
 * by the label so it can use the label's own typography.
 */
export function code128Svg(text: string, options: Code128SvgOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 1;
  const height = options.height ?? 40;
  const quiet = options.quietModules ?? 10;

  const widths = encodeCode128B(text);
  const totalModules = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const width = totalModules * moduleWidth;

  let x = quiet;
  let bars = '';
  widths.forEach((moduleCount, index) => {
    if (index % 2 === 0) {
      bars += `<rect x="${(x * moduleWidth).toFixed(3)}" y="0" width="${(moduleCount * moduleWidth).toFixed(3)}" height="${height}"/>`;
    }
    x += moduleCount;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(3)} ${height}" ` +
    `width="${width.toFixed(3)}" height="${height}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="Barcode ${text}">` +
    `<rect x="0" y="0" width="${width.toFixed(3)}" height="${height}" fill="#fff"/>` +
    `<g fill="#000">${bars}</g></svg>`
  );
}
