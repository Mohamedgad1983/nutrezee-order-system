// Configuration: per-entity legacy routes/selectors come from a JSON config file
// (calibrated once legacy access is granted); ALL credentials come from env vars only.

import { readFileSync, existsSync } from 'node:fs';
import { log } from './logger.ts';
import type { EntityKey } from './types.ts';

/** Selector + route config for one legacy screen. Tuned per legacy DOM after access. */
export interface EntityConfig {
  /** Legacy path relative to LEGACY_BASE_URL (e.g. "/users/list/3"). */
  path: string;
  /** Whether this entity is calibrated for the live legacy DOM yet. */
  calibrated: boolean;
  /** CSS selector for the rows container / table. */
  rowSelector?: string;
  /** CSS for the "next page" control; absent = single page. */
  nextPageSelector?: string;
  /** Max pages to walk (hard safety cap). */
  maxPages?: number;
  /** field-name → cell CSS (relative to a row) OR column index "td:nth-child(N)". */
  columns?: Record<string, string>;
  /** Optional detail-page link selector + detail field map. */
  detail?: { linkSelector: string; columns: Record<string, string> };
}

export interface MigrationConfig {
  legacy: {
    baseUrlEnv: string;       // name of the env var holding the URL
    emailEnv: string;
    passwordEnv: string;
    loginPath: string;
    /** POST URLs/patterns allowed during the short auth-only phase. */
    authPostAllowlist: string[];
    /** Read-only GET URLs/patterns allowed even if they contain dangerous words. */
    readOnlyGetAllowlist: string[];
    emailSelector: string;
    passwordSelector: string;
    submitSelector: string;
    loggedInSelector: string; // selector proving login succeeded
  };
  newSystem: {
    baseUrlEnv: string;
    emailEnv: string;
    passwordEnv: string;
  };
  /** Throttle + retry safety knobs. */
  throttleMs: number;
  navTimeoutMs: number;
  retries: number;
  retryBackoffMs: number;
  /** Per-entity legacy screen config. */
  entities: Partial<Record<EntityKey, EntityConfig>>;
}

export interface ResolvedSecrets {
  legacyBaseUrl?: string;
  legacyEmail?: string;
  legacyPassword?: string;
  newBaseUrl?: string;
  newEmail?: string;
  newPassword?: string;
}

export function loadConfig(path = 'config.json'): MigrationConfig {
  const file = existsSync(path) ? path : 'config.example.json';
  if (file !== path) log.warn(`config.json not found — using ${file} (legacy selectors are placeholders).`);
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as MigrationConfig;
  cfg.legacy.authPostAllowlist ??= [cfg.legacy.loginPath];
  cfg.legacy.readOnlyGetAllowlist ??= [];
  return cfg;
}

/** Resolve credentials from env vars ONLY. Never read from config/files. */
export function resolveSecrets(cfg: MigrationConfig): ResolvedSecrets {
  const env = (k: string): string | undefined => {
    const v = process.env[k];
    return v && v.trim() ? v.trim() : undefined;
  };
  return {
    legacyBaseUrl: env(cfg.legacy.baseUrlEnv),
    legacyEmail: env(cfg.legacy.emailEnv),
    legacyPassword: env(cfg.legacy.passwordEnv),
    newBaseUrl: env(cfg.newSystem.baseUrlEnv),
    newEmail: env(cfg.newSystem.emailEnv),
    newPassword: env(cfg.newSystem.passwordEnv),
  };
}

export function haveLegacyAccess(s: ResolvedSecrets): boolean {
  return !!(s.legacyBaseUrl && s.legacyEmail && s.legacyPassword);
}
export function haveNewAccess(s: ResolvedSecrets): boolean {
  return !!(s.newBaseUrl && s.newEmail && s.newPassword);
}
