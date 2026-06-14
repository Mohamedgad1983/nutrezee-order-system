// Minimal read-only client for the NEW staging API (for comparison only). Logs in once
// (POST /auth/login → nz_session cookie) and exposes GET helpers. Never writes.

import { log } from './logger.ts';

export class NewApiClient {
  private cookie = '';
  constructor(private readonly baseUrl: string) {}

  async login(email: string, password: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`new-system login failed: HTTP ${res.status}`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const m = /nz_session=([^;]+)/.exec(setCookie);
    if (!m) throw new Error('new-system login: no nz_session cookie returned');
    this.cookie = `nz_session=${m[1]}`;
    log.info('new-system API: authenticated');
  }

  /** GET a path and return parsed JSON (read-only). */
  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { Cookie: this.cookie } });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Count items from a `{ items: [...] }` list endpoint (best-effort). */
  async count(path: string): Promise<number> {
    try {
      const body = await this.get<{ items?: unknown[] }>(path);
      return Array.isArray(body.items) ? body.items.length : 0;
    } catch (e) {
      log.warn(`count(${path}) failed: ${String(e)}`);
      return 0;
    }
  }
}
