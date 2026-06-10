// Phone normalization (DM-03): E.164-style [Proposed], default country from the
// default_phone_country_code setting (config, not code — [NC workshop]).
// Raw input is preserved separately (phone_raw) for dispute resolution.

export class PhoneError extends Error {
  readonly code = 'phone_unparseable';
}

export function normalizePhone(raw: string, defaultCountryCode: string): string {
  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    s = s.replace(/^0/, ''); // local format: drop trunk zero, prepend default country
    s = `${defaultCountryCode}${s}`;
  }
  if (!/^\+[1-9]\d{6,14}$/.test(s)) throw new PhoneError();
  return s;
}
