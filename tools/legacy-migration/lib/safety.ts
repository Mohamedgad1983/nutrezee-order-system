// SAFETY LAYER — the legacy system must stay strictly read-only. This is enforced at
// two levels: (1) the network (abort any non-GET/HEAD request on the legacy context),
// and (2) the DOM (refuse to click any save/update/delete/confirm control). Plus a
// throttle and a retry-with-backoff so we never hammer the legacy host.

import type { BrowserContext, Page } from 'playwright';
import { log } from './logger.ts';

/** HTTP methods that could mutate legacy data — aborted on the read-only context. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Button/label text that indicates a mutation — clicks on these are refused. */
const DANGEROUS = /\b(save|update|delete|remove|confirm|submit|create|edit|approve|reject|pay|refund|send|publish|deactivate|reset|merge|import|apply)\b/i;

/**
 * Network-level read-only guard: abort every mutating request on the legacy context.
 * GET/HEAD pass through; everything else is blocked and logged. This makes accidental
 * legacy writes impossible even if a stray click slips past the DOM guard.
 */
export async function enforceReadOnly(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route) => {
    const method = route.request().method().toUpperCase();
    if (MUTATING_METHODS.has(method)) {
      log.warn(`[read-only guard] BLOCKED ${method} ${redactUrl(route.request().url())}`);
      void route.abort('blockedbyclient');
      return;
    }
    void route.continue();
  });
}

/** DOM-level guard: a safe click that refuses mutating controls (defence in depth). */
export async function safeClick(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector).first();
  const text = ((await el.textContent().catch(() => '')) ?? '').trim();
  const value = (await el.getAttribute('value').catch(() => null)) ?? '';
  if (DANGEROUS.test(text) || DANGEROUS.test(value)) {
    throw new Error(`[click guard] refused to click a mutating control: "${text || value}" (${selector})`);
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
