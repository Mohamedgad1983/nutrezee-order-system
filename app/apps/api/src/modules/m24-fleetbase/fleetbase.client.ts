// m24-fleetbase — thin typed HTTP client for the Fleetbase Fleet-Ops public REST API.
// Auth: Authorization: Bearer <FLEETBASE_API_KEY> against <FLEETBASE_API_BASE>/v1.
// The key is read from the environment ONLY and is never logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FleetbaseOrderCreate } from './fleetbase.types';

export interface FleetbaseClientConfig {
  baseUrl: string; // e.g. https://fleetapi.13-140-159-201.sslip.io
  apiKey: string; // flb_live_...
  timeoutMs?: number;
}

export interface FleetbaseOrder {
  id: string; // order public id (order_xxx)
  internal_id?: string;
  status?: string;
  [k: string]: unknown;
}

export class FleetbaseClient {
  private readonly base: string;
  private readonly key: string;
  private readonly timeoutMs: number;

  constructor(cfg: FleetbaseClientConfig) {
    this.base = cfg.baseUrl.replace(/\/+$/, '') + '/v1';
    this.key = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 20000;
  }

  /** Loads config from the environment. Throws if the key is missing (so we fail closed). */
  static fromEnv(): FleetbaseClient {
    const apiKey = process.env.FLEETBASE_API_KEY;
    const baseUrl = process.env.FLEETBASE_API_BASE ?? 'https://fleetapi.13-140-159-201.sslip.io';
    if (!apiKey) throw new Error('FLEETBASE_API_KEY not set — Fleetbase integration disabled');
    return new FleetbaseClient({ apiKey, baseUrl });
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      const json: unknown = text ? safeJson(text) : null;
      if (!res.ok) {
        // Never include the request body (may carry PII) or the key in the error.
        const j = json as { error?: string; errors?: string[] } | null;
        const msg = (j && (j.error || (j.errors && j.errors[0]))) || `HTTP ${res.status}`;
        throw new FleetbaseApiError(res.status, String(msg));
      }
      return json as T;
    } finally {
      clearTimeout(t);
    }
  }

  /** Read-only health/auth check. */
  organizations(): Promise<Array<{ id: string; name: string }>> {
    return this.req('GET', '/organizations');
  }

  /** Look up an existing order by our internal_id (idempotency guard). */
  async findByInternalId(internalId: string): Promise<FleetbaseOrder | null> {
    const list = await this.req<FleetbaseOrder[]>('GET', `/orders?internal_id=${encodeURIComponent(internalId)}`);
    return (Array.isArray(list) ? list[0] : null) ?? null;
  }

  /**
   * Find a contact by phone, else create one. Fleetbase REQUIRES an email on create,
   * so a placeholder is derived upstream when the customer has none. Returns the contact public_id.
   */
  async upsertContact(c: { name: string; phone: string; email: string }): Promise<string> {
    const found = await this.req<Array<{ id: string }>>('GET', `/contacts?phone=${encodeURIComponent(c.phone)}`).catch(() => []);
    if (Array.isArray(found) && found.length && found[0]?.id) return found[0].id;
    const created = await this.req<{ id: string }>('POST', '/contacts', { ...c, type: 'customer' });
    return created.id;
  }

  createOrder(body: FleetbaseOrderCreate): Promise<FleetbaseOrder> {
    return this.req('POST', '/orders', body);
  }

  getOrder(id: string): Promise<FleetbaseOrder> {
    return this.req('GET', `/orders/${encodeURIComponent(id)}`);
  }
}

export class FleetbaseApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'FleetbaseApiError';
  }
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return null; }
}

/**
 * Verify a Fleetbase webhook signature. Fleetbase signs the RAW request body with
 * HMAC-SHA256 using the webhook secret and puts it in the header literally named "Signature"
 * (NOT X-Fleetbase-Signature). Timing-safe compare.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
