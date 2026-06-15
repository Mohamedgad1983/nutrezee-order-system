// SAFETY LAYER — the legacy system must stay strictly read-only after authentication.
// This is enforced at three levels: (1) an auth-only phase that allows only the configured
// login POST, (2) strict network read-only mode that blocks mutations plus dangerous GETs,
// and (3) a DOM click guard. Plus throttle/retry so we never hammer the legacy host.

import type { BrowserContext, Page } from 'playwright';
import { log } from './logger.ts';

/** HTTP methods that could mutate legacy data — aborted on the read-only context. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const DANGEROUS_GET_TOKENS = [
  'delete', 'remove', 'destroy', 'update', 'save', 'approve', 'reject', 'cancel',
  'assign', 'autoassign', 'confirm', 'payment', 'paid', 'status', 'action',
];

/** Button/label text that indicates a mutation — clicks on these are refused. */
const DANGEROUS = /\b(save|update|delete|remove|confirm|submit|create|edit|approve|reject|pay|refund|send|publish|deactivate|reset|merge|import|apply)\b/i;

export type LegacySafetyMode = 'auth' | 'strict';

export interface LegacySafetyOptions {
  baseUrl: string;
  authPostAllowlist: string[];
  readOnlyGetAllowlist: string[];
}

export interface RequestDecision {
  allow: boolean;
  reason?: string;
}

export interface LegacySafetyController {
  mode: () => LegacySafetyMode;
  enableStrictReadOnly: () => void;
}

/**
 * Stateful legacy guard. It starts in auth-only mode so exactly the configured login POST
 * can succeed, then callers must switch it to strict read-only mode after login completes.
 */
export async function installLegacySafety(
  context: BrowserContext,
  opts: LegacySafetyOptions,
): Promise<LegacySafetyController> {
  let mode: LegacySafetyMode = 'auth';
  await context.route('**/*', (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    const decision = evaluateLegacyRequest(method, url, opts, mode);
    if (!decision.allow) {
      log.warn(`[legacy safety] BLOCKED ${method} ${redactUrl(url)} (${decision.reason ?? 'blocked'})`);
      void route.abort('blockedbyclient');
      return;
    }
    void route.continue();
  });

  return {
    mode: () => mode,
    enableStrictReadOnly: () => { mode = 'strict'; },
  };
}

/** Install the legacy guard and immediately force strict read-only mode. */
export async function enforceReadOnly(context: BrowserContext, opts: LegacySafetyOptions): Promise<LegacySafetyController> {
  const controller = await installLegacySafety(context, opts);
  controller.enableStrictReadOnly();
  return controller;
}

export function evaluateLegacyRequest(
  method: string,
  url: string,
  opts: LegacySafetyOptions,
  mode: LegacySafetyMode,
): RequestDecision {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' && isDangerousLegacyGetUrl(url, opts)) {
    return { allow: false, reason: 'dangerous GET URL' };
  }
  if (!MUTATING_METHODS.has(normalizedMethod)) return { allow: true };
  if (
    mode === 'auth'
    && normalizedMethod === 'POST'
    && matchesAnyConfiguredPattern(url, opts.baseUrl, opts.authPostAllowlist)
  ) {
    return { allow: true };
  }
  return {
    allow: false,
    reason: mode === 'auth' ? 'mutating request outside auth allowlist' : 'strict read-only mode',
  };
}

export function isDangerousLegacyGetUrl(url: string, opts: Pick<LegacySafetyOptions, 'baseUrl' | 'readOnlyGetAllowlist'>): boolean {
  const target = parseUrl(url, opts.baseUrl);
  const base = parseUrl(opts.baseUrl, opts.baseUrl);
  if (!target || !base || target.origin !== base.origin) return false;
  if (matchesAnyConfiguredPattern(target.href, opts.baseUrl, opts.readOnlyGetAllowlist)) return false;
  const pathAndQuery = decodeURIComponent(`${target.pathname}${target.search}`).toLowerCase();
  return DANGEROUS_GET_TOKENS.some((token) => pathAndQuery.includes(token));
}

export interface SafeClickOptions {
  baseUrl?: string;
  readOnlyGetAllowlist?: string[];
}

/** DOM-level guard: a safe click that refuses mutating controls and dangerous GET hrefs. */
export async function safeClick(page: Page, selector: string, opts: SafeClickOptions = {}): Promise<void> {
  const el = page.locator(selector).first();
  const text = ((await el.textContent().catch(() => '')) ?? '').trim();
  const value = (await el.getAttribute('value').catch(() => null)) ?? '';
  if (DANGEROUS.test(text) || DANGEROUS.test(value)) {
    throw new Error(`[click guard] refused to click a mutating control: "${text || value}" (${selector})`);
  }
  if (opts.baseUrl) {
    const readOnlyGetAllowlist = opts.readOnlyGetAllowlist ?? [];
    const href = (await el.getAttribute('href').catch(() => null))
      ?? (await el.getAttribute('formaction').catch(() => null));
    if (href && isDangerousLegacyGetUrl(href, { baseUrl: opts.baseUrl, readOnlyGetAllowlist })) {
      throw new Error(`[click guard] refused to click a dangerous legacy GET URL: "${href}" (${selector})`);
    }
  }
  await el.click();
}

/** Throttle between navigations so we don't scrape aggressively. */
export function throttle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry an async op with exponential backoff. Re-throws after the last attempt. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; backoffMs: number; label: string },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < opts.retries) {
        const wait = opts.backoffMs * 2 ** attempt;
        log.warn(`${opts.label}: attempt ${attempt + 1} failed, retrying in ${wait}ms`);
        await throttle(wait);
      }
    }
  }
  throw new Error(`${opts.label}: failed after ${opts.retries + 1} attempts: ${String(lastErr)}`);
}

function redactUrl(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '<url>'; }
}

function matchesAnyConfiguredPattern(url: string, baseUrl: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesConfiguredPattern(url, baseUrl, pattern));
}

function matchesConfiguredPattern(url: string, baseUrl: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const target = parseUrl(url, baseUrl);
  if (!target) return false;
  const candidate = trimmed.startsWith('http')
    ? target.href
    : `${target.pathname}${target.search}`;
  if (trimmed.endsWith('*')) return candidate.startsWith(trimmed.slice(0, -1));
  return candidate === trimmed || candidate.startsWith(`${trimmed}?`);
}

function parseUrl(url: string, baseUrl: string): URL | undefined {
  try { return new URL(url, baseUrl); } catch { return undefined; }
}
