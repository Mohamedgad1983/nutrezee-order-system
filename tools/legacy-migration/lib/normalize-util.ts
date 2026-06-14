// Pure normalization helpers (NO Playwright import → unit-testable in isolation).
// Conventions from the new schema: E.164 phones, EN/AR name split, money in minor
// units (SAR fils), ISO dates (Asia/Kuwait calendar), origin='legacy'.

/** Best-effort E.164. KSA local 05XXXXXXXX → +9665XXXXXXXX. ok=false ⇒ merge_review. */
export function normalizePhone(raw: string | null | undefined): { phone: string | null; ok: boolean } {
  if (!raw) return { phone: null, ok: false };
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+')) return { phone: d, ok: /^\+\d{8,15}$/.test(d) };
  if (/^0?5\d{8}$/.test(d)) return { phone: '+966' + d.replace(/^0/, ''), ok: true };
  if (/^\d{8,15}$/.test(d)) return { phone: '+' + d, ok: false }; // unknown country → review
  return { phone: null, ok: false };
}

const ARABIC = /[؀-ۿ]/;
/** Split a legacy name into EN/AR by script (legacy often stores one or the other). */
export function splitName(raw: string | null | undefined): { en: string | null; ar: string | null } {
  if (!raw) return { en: null, ar: null };
  const t = String(raw).trim();
  if (!t) return { en: null, ar: null };
  return ARABIC.test(t) ? { en: null, ar: t } : { en: t, ar: null };
}

/** Money string → integer minor units (SAR fils). null if unparseable. */
export function toFils(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Integer parse (durations, meals/day). null if unparseable. */
export function toInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = parseInt(String(raw).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Legacy date → ISO yyyy-mm-dd (best effort). ok=false ⇒ goes to import_notes. */
export function toIsoDate(raw: string | null | undefined): { date: string | null; ok: boolean } {
  if (!raw) return { date: null, ok: false };
  const d = new Date(String(raw));
  if (!Number.isNaN(d.getTime())) return { date: d.toISOString().slice(0, 10), ok: true };
  return { date: null, ok: false };
}

/** First non-empty value among candidate field names. */
export function pick(row: Record<string, string | null>, ...keys: string[]): string | null {
  for (const k of keys) { const v = row[k]; if (v !== null && v !== undefined && String(v).trim() !== '') return v; }
  return null;
}
