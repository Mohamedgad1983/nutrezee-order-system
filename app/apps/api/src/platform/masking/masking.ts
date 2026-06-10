import type { VisibilityClass } from '../rbac/access.service';

export const MASK_SENTINEL = '***';

export interface MaskedResult<T> {
  data: T;
  masked: boolean;
}

// api_standards rule 4: masking is response-shaping at serialization; storage never
// masks; masked fields render as the sentinel + masked:true, never silent omission.
export function maskFields<T extends Record<string, unknown>>(
  obj: T,
  fieldClasses: Partial<Record<keyof T, VisibilityClass>>,
  grants: Set<VisibilityClass>,
): MaskedResult<T> {
  const out: Record<string, unknown> = { ...obj };
  let masked = false;
  for (const [field, cls] of Object.entries(fieldClasses) as [keyof T, VisibilityClass][]) {
    if (cls && !grants.has(cls) && out[field as string] !== undefined && out[field as string] !== null) {
      out[field as string] = MASK_SENTINEL;
      masked = true;
    }
  }
  return { data: out as T, masked };
}
