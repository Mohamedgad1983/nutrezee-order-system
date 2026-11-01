import { describe, expect, it } from 'vitest';
import { placeholderPhone } from '../../apps/api/src/modules/m19-migration/importers';
import { normalizePhone } from '../../apps/api/src/modules/m04-customers/phone';

// TS-U — A99: identity key for a Partner customer whose phone cannot be read.
describe('TS-U placeholderPhone (A99)', () => {
  it('derives a stable key from customer_ref, else order_number', () => {
    expect(placeholderPhone('25699', '31508')).toBe('+9650025699');
    expect(placeholderPhone(undefined, '31508')).toBe('+9650031508');
    expect(placeholderPhone('abc', '31508')).toBe('+9650031508');
    expect(placeholderPhone(undefined, 'x')).toBeNull();
  });
  it('never equals a real normalized Kuwaiti number (local numbers never start with 00)', () => {
    for (const real of ['99887766', '51234567', '22334455', '60001234', '41234567']) {
      expect(normalizePhone(real, '+965').startsWith('+96500')).toBe(false);
    }
    expect(placeholderPhone('1', '1')).toMatch(/^\+96500\d+$/);
  });
});
