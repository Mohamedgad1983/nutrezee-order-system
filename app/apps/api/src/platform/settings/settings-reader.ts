import type { Pool } from 'pg';

// Light read-side for settings (full admin service = WP-03). Cached briefly;
// invalidation on settings.changed events arrives with the WP-03 service.
export class SettingsReader {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly pool: Pool,
    private readonly ttlMs = 5_000,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return (hit.value ?? fallback) as T;
    const { rows } = await this.pool.query('SELECT value FROM setting WHERE key = $1', [key]);
    const value = rows.length > 0 ? rows[0].value : undefined;
    this.cache.set(key, { value, at: Date.now() });
    return (value ?? fallback) as T;
  }

  clear(): void {
    this.cache.clear();
  }
}
