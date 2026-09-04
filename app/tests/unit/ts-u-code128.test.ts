import { describe, expect, it } from 'vitest';
import {
  BARCODE_ALPHABET, code128Svg, computeBarcodeCheck, encodeCode128B, formatBarcodeValue,
  generateBarcodePayload, isValidBarcodeValue, normalizeScannedBarcode,
} from '../../apps/api/src/modules/m25-label/code128';

// TS-U — permanent customer barcode value codec + Code 128-B encoder (WP-LBL-01/02, A27).
// Pure functions, no DB. These guard the two things a scanner cannot recover from: a wrong
// symbol table and a value whose check symbols do not actually detect corruption.

describe('TS-U barcode value format', () => {
  it('uses a 32-symbol alphabet with no visually ambiguous characters', () => {
    expect(BARCODE_ALPHABET).toHaveLength(32);
    expect(new Set(BARCODE_ALPHABET).size).toBe(32);
    for (const ambiguous of ['I', 'L', 'O', 'U']) {
      expect(BARCODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('formats as NZC-XXXX-XXXX-CC and validates', () => {
    const value = formatBarcodeValue('8H4P72KM');
    expect(value).toMatch(/^NZC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(value.startsWith('NZC-8H4P-72KM-')).toBe(true);
    expect(isValidBarcodeValue(value)).toBe(true);
  });

  it('check symbols are deterministic', () => {
    expect(computeBarcodeCheck('8H4P72KM')).toBe(computeBarcodeCheck('8H4P72KM'));
  });

  it('detects every single-symbol corruption', () => {
    const value = formatBarcodeValue('8H4P72KM');
    const payload = '8H4P72KM';
    let checked = 0;
    for (let i = 0; i < payload.length; i += 1) {
      for (const sym of BARCODE_ALPHABET) {
        if (sym === payload[i]) continue;
        const broken = payload.slice(0, i) + sym + payload.slice(i + 1);
        const candidate = `NZC-${broken.slice(0, 4)}-${broken.slice(4)}-${value.slice(-2)}`;
        expect(isValidBarcodeValue(candidate)).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBe(8 * 31);
  });

  it('detects adjacent transpositions', () => {
    const payload = '8H4P72KM';
    const check = computeBarcodeCheck(payload);
    for (let i = 0; i < payload.length - 1; i += 1) {
      if (payload[i] === payload[i + 1]) continue;
      const swapped = payload.slice(0, i) + payload[i + 1] + payload[i] + payload.slice(i + 2);
      const candidate = `NZC-${swapped.slice(0, 4)}-${swapped.slice(4)}-${check}`;
      expect(isValidBarcodeValue(candidate)).toBe(false);
    }
  });

  it('rejects malformed shapes outright', () => {
    for (const bad of ['', 'NZC-8H4P-72KM', 'ABC-8H4P-72KM-91', 'NZC-8H4P-72KM-911', 'NZC-8I4P-72KM-91']) {
      expect(isValidBarcodeValue(bad)).toBe(false);
    }
  });

  it('normalises realistic scanner output', () => {
    const value = formatBarcodeValue('8H4P72KM');
    const bare = value.replace(/-/g, '');
    expect(normalizeScannedBarcode(` ${value.toLowerCase()} \n`)).toBe(value);
    expect(normalizeScannedBarcode(bare)).toBe(value);
    expect(isValidBarcodeValue(normalizeScannedBarcode(bare))).toBe(true);
  });

  it('leaves unrepairable input alone rather than guessing', () => {
    expect(normalizeScannedBarcode('4901234567894')).toBe('4901234567894');
    expect(isValidBarcodeValue(normalizeScannedBarcode('4901234567894'))).toBe(false);
  });

  it('generates payloads from the injected randomness only (no PII input)', () => {
    const seq = [0, 1, 2, 3, 4, 5, 6, 7];
    let i = 0;
    const payload = generateBarcodePayload(() => seq[i++]!);
    expect(payload).toBe('01234567');
    expect(payload).toHaveLength(8);
  });
});

describe('TS-U Code 128-B encoder', () => {
  it('encodes START B + data + checksum + STOP with the standard patterns', () => {
    // START_B(104)=211214, 'A'(33)=111323, checksum=(104+33*1)%103=34=131123, STOP(106)=2331112
    expect(encodeCode128B('A')).toEqual([
      2, 1, 1, 2, 1, 4,
      1, 1, 1, 3, 2, 3,
      1, 3, 1, 1, 2, 3,
      2, 3, 3, 1, 1, 1, 2,
    ]);
  });

  it('every symbol is 11 modules wide and STOP is 13', () => {
    const widths = encodeCode128B('NZC-8H4P-72KM-91');
    const total = widths.reduce((a, b) => a + b, 0);
    const symbols = 1 + 16 + 1; // start + data + checksum
    expect(total).toBe(symbols * 11 + 13);
  });

  it('starts with a bar and alternates', () => {
    const widths = encodeCode128B('NZC-8H4P-72KM-91');
    expect(widths[0]).toBe(2);            // START B begins 2-1-1-2-1-4
    expect(widths.every((w) => w >= 1 && w <= 4)).toBe(true);
  });

  it('rejects characters outside Set B instead of encoding something wrong', () => {
    expect(() => encodeCode128B('')).toThrow();
    expect(() => encodeCode128B('café')).toThrow();   // é is outside ASCII 32..126
    expect(() => encodeCode128B('a\tb')).toThrow();
  });

  it('renders a self-contained SVG with a quiet zone and no external references', () => {
    const value = formatBarcodeValue('8H4P72KM');
    const svg = code128Svg(value, { moduleWidth: 1, height: 44, quietModules: 10 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`aria-label="Barcode ${value}"`);
    // No network references, scripts or external resources. The SVG XML-namespace declaration is
    // the one legitimate http: occurrence, so it is excluded before the check.
    const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
    expect(withoutNamespace).not.toMatch(/https?:|<script|xlink:href|url\(|<image|href=/);

    const widths = encodeCode128B(value);
    const expectedWidth = widths.reduce((a, b) => a + b, 0) + 20;
    expect(svg).toContain(`viewBox="0 0 ${expectedWidth.toFixed(3)} 44"`);
    // one <rect> per bar (every other element) plus the white background rect
    const bars = (svg.match(/<rect/g) ?? []).length;
    expect(bars).toBe(Math.ceil(widths.length / 2) + 1);
  });
});
