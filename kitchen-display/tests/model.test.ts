import { describe, expect, it } from 'vitest';
import { formatQuantity, initialLanguage, kuwaitToday, LANGUAGE_STORAGE_KEY } from '../src/web/model';

describe('bilingual display model', () => {
  it('uses the Kuwait calendar day instead of browser UTC', () => {
    expect(kuwaitToday(new Date('2026-08-07T21:30:00.000Z'))).toBe('2026-08-08');
  });

  it('defaults to English, ignores the legacy preference key, and preserves fractional quantity formatting', () => {
    expect(initialLanguage({ getItem: () => null })).toBe('en');
    expect(initialLanguage({ getItem: () => 'en' })).toBe('en');
    expect(initialLanguage({ getItem: () => 'ar' })).toBe('ar');
    expect(initialLanguage({
      getItem: (key) => key === 'nutrezee-kds-language' ? 'ar' : null,
    })).toBe('en');
    expect(LANGUAGE_STORAGE_KEY).toBe('nutrezee-kds-language-v2');
    expect(formatQuantity(12.5, 'en')).toBe('12.5');
  });
});
