// Redacting logger. Secrets (passwords, cookies, tokens, emails, phones) must never
// hit stdout or any committed file. Every log line passes through redaction.

const REDACTORS: Array<[RegExp, string]> = [
  [/(password|passwd|pwd|secret|token|cookie|authorization|nz_session)("?\s*[:=]\s*"?)([^"\s,}]+)/gi, '$1$2***'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  // phones only: E.164 (+9665…) or KSA-local (05…). Avoids matching ISO timestamps/paths.
  [/(\+\d[\d().\s-]{6,}\d)|(\b0?5\d[\d().\s-]{6,}\d\b)/g, '<phone>'],
];

/** Redact secrets / PII from an arbitrary string (used for all log output). */
export function redact(input: string): string {
  let out = input;
  for (const [re, rep] of REDACTORS) out = out.replace(re, rep);
  return out;
}

/** Deep-redact an object for safe JSON logging (does NOT touch files written to disk). */
export function redactObject(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/pass|secret|token|cookie|auth/i.test(k)) o[k] = '***';
      else o[k] = redactObject(v);
    }
    return o;
  }
  return value;
}

type Level = 'info' | 'warn' | 'error' | 'debug';
const ICON: Record<Level, string> = { info: 'ℹ', warn: '⚠', error: '✖', debug: '·' };

function emit(level: Level, msg: string, extra?: unknown): void {
  const line = `${ICON[level]} ${redact(msg)}`;
  const tail = extra === undefined ? '' : ' ' + redact(JSON.stringify(redactObject(extra)));
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line + tail);
}

export const log = {
  info: (m: string, e?: unknown) => emit('info', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  error: (m: string, e?: unknown) => emit('error', m, e),
  debug: (m: string, e?: unknown) => { if (process.env.DEBUG) emit('debug', m, e); },
};
