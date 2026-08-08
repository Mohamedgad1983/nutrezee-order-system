import { describe, expect, it } from 'vitest';
import { formatQuantity, initialLanguage, kuwaitToday } from '../src/web/model';

describe('bilingual display model', () => {
  it('uses the Kuwait calendar day instead of browser UTC', () => {
    expect(kuwaitToday(new Date('2026-08-07T21:30:00.000Z'))).toBe('2026-08-08');
  });

  it('defaults to Arabic and preserves fractional quantity formatting', () => {
    expect(initialLanguage({ getItem: () => null })).toBe('ar');
    expect(initialLanguage({ getItem: () => 'en' })).toBe('en');
    expect(formatQuantity(12.5, 'en')).toBe('12.5');
  });
});
