export type Language = 'ar' | 'en';

export const LANGUAGE_STORAGE_KEY = 'nutrezee-kds-language-v2';

export function kuwaitToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatQuantity(value: number, language: Language): string {
  return new Intl.NumberFormat(language === 'ar' ? 'ar-KW' : 'en-KW', {
    maximumFractionDigits: 3,
  }).format(value);
}

export function initialLanguage(storage: Pick<Storage, 'getItem'> = localStorage): Language {
  return storage.getItem(LANGUAGE_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
}
