import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizePhone, splitName, toFils, toInt, toIsoDate } from '../lib/normalize-util.ts';
import { normalizeCustomers } from '../normalizers/customers.normalizer.ts';
import { normalizeOrders } from '../normalizers/orders.normalizer.ts';
import { normalizeProducts, normalizePackages } from '../normalizers/catalog.normalizer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(join(here, '../fixtures/sample-legacy-output.json'), 'utf8'));

describe('normalize-util', () => {
  it('phone → E.164 (KSA local + intl)', () => {
    expect(normalizePhone('0561234567')).toEqual({ phone: '+966561234567', ok: true });
    expect(normalizePhone('00966551112233')).toEqual({ phone: '+966551112233', ok: true });
    expect(normalizePhone('12345')).toEqual({ phone: null, ok: false });        // too short
    expect(normalizePhone('').phone).toBeNull();
  });
  it('splits name by script', () => {
    expect(splitName('John Doe')).toEqual({ en: 'John Doe', ar: null });
    expect(splitName('سارة الراشد')).toEqual({ en: null, ar: 'سارة الراشد' });
  });
  it('money → fils, ints, dates', () => {
    expect(toFils('45.00')).toBe(4500);
    expect(toFils('30')).toBe(3000);
    expect(toFils('')).toBeNull();
    expect(toInt('30')).toBe(30);
    expect(toIsoDate('1990-04-12')).toEqual({ date: '1990-04-12', ok: true });
    expect(toIsoDate('bad-date')).toEqual({ date: null, ok: false });
  });
});

describe('normalizeCustomers', () => {
  const out = normalizeCustomers(sample.customers);
  it('maps fields + provenance', () => {
    expect(out[0]!.data.full_name_en).toBe('Sara Al-Rashed');
    expect(out[0]!.data.phone).toBe('+966561234567');
    expect(out[0]!.data.origin).toBe('legacy');
    expect(out[0]!.legacy_id).toBe('1001');
    expect(out[0]!.confidence).toBe('VERIFIED');
  });
  it('flags Arabic-only name + bad dob for review', () => {
    expect(out[1]!.data.full_name_ar).toBe('سارة الراشد');
    expect(out[1]!.data.full_name_en).toBeNull();
    expect(out[1]!.confidence).toBe('NEEDS_MANUAL_REVIEW');
    expect(out[1]!.notes.join(' ')).toMatch(/Arabic/);
  });
  it('flags unparseable phone for merge_review', () => {
    expect(out[2]!.confidence).toBe('NEEDS_MANUAL_REVIEW');
    expect(out[2]!.notes.join(' ')).toMatch(/merge_review/);
  });
});

describe('normalizeOrders', () => {
  const out = normalizeOrders(sample.orders);
  it('maps active/pause, drops out-of-scope statuses', () => {
    expect(out[0]!.data.status).toBe('active');
    expect(out[1]!.data.status).toBe('paused');
    expect(out[2]!.data.status).toBeNull();                 // "completed" → not imported
    expect(out[2]!.notes.join(' ')).toMatch(/outside active-plan scope|stays legacy/);
  });
  it('always flags off-day/address as unverified', () => {
    expect(out[0]!.data.off_days_unverified).toBe(true);
    expect(out[1]!.data.end_date).toBeNull();               // missing end → derive note
    expect(out[1]!.notes.join(' ')).toMatch(/derive from package/);
  });
});

describe('normalizeCatalog', () => {
  it('products → M19 kind=product, price in fils', () => {
    const p = normalizeProducts(sample.products);
    expect(p[0]!.data.kind).toBe('product');
    expect(p[0]!.data.price_fils).toBe(4500);
    expect(p[2]!.data.name_ar).toBe('كبسة دجاج');           // arabic-only product name
  });
  it('packages → kind=package with duration/meals', () => {
    const pk = normalizePackages(sample.packages);
    expect(pk[0]!.data.kind).toBe('package');
    expect(pk[0]!.data.duration_days).toBe(30);
    expect(pk[0]!.data.meals_per_day).toBe(2);
    expect(pk[0]!.data.price_fils).toBe(120000);
  });
});
