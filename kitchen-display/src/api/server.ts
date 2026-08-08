import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { KdsApiError, KdsDisplayConfig } from '../contracts.js';
import { AuthManager } from './auth.js';
import { PartnerSource, validCalendarDate, type PartnerSourceGateway } from './partner-source.js';
import { TotalsError, TotalsService } from './totals.js';

const COOKIE_NAME = 'kds_session';
const JSON_LIMIT_BYTES = 8 * 1024;
const KITCHEN_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export interface KdsServerOptions {
  auth: AuthManager;
  source: PartnerSourceGateway;
  kitchens: string[];
  publicOrigin: string;
  secureCookies: boolean;
  webRoot: string;
  refreshSeconds?: number;
  sessionMaxAgeSeconds?: number;
  trustProxy?: boolean;
  logger?: (event: Record<string, unknown>) => void;
}

interface RuntimeConfig extends KdsServerOptions {
  port: number;
}

interface Attempt {
  count: number;
  resetAt: number;
}

class LoginLimiter {
  private readonly attempts = new Map<string, Attempt>();

  allowed(key: string, maximum: number, now = Date.now()): boolean {
    this.prune(now);
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
      return true;
    }
    current.count += 1;
    return current.count <= maximum;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }

  private prune(now: number): void {
    if (this.attempts.size < 1000) return;
    for (const [key, attempt] of this.attempts) {
      if (attempt.resetAt <= now) this.attempts.delete(key);
    }
    if (this.attempts.size > 10_000) this.attempts.clear();
  }
}

export function createKdsServer(options: KdsServerOptions): Server {
  const totals = new TotalsService(options.source);
  const limiter = new LoginLimiter();
  const kitchens = new Set(options.kitchens);
  const refreshSeconds = options.refreshSeconds ?? 60;
  const sessionMaxAgeSeconds = options.sessionMaxAgeSeconds ?? 43_200;
  const logger = options.logger ?? ((event) => console.info(JSON.stringify(event)));

  return createServer(async (request, response) => {
    const started = Date.now();
    let pathname = 'invalid';
    try {
      setSecurityHeaders(response, options.secureCookies);
      const url = new URL(request.url ?? '/', options.publicOrigin);
      pathname = url.pathname;

      if (request.method === 'GET' && pathname === '/health') {
        return sendJson(response, 200, { status: 'ok', service: 'nutrezee-kds' });
      }
      if (request.method === 'POST' && pathname === '/api/auth/login') {
        if (!validOrigin(request, options.publicOrigin)) return sendError(response, 403, 'origin_forbidden');
        const body = await readJson(request);
        const username = isRecord(body) ? body.username : undefined;
        const password = isRecord(body) ? body.password : undefined;
        const address = clientAddress(request, options.trustProxy === true);
        const ipKey = `ip:${address}`;
        const attemptKey = `account:${address}:${safeUsername(username)}`;
        if (!limiter.allowed(ipKey, 40) || !limiter.allowed(attemptKey, 8)) {
          return sendError(response, 429, 'login_rate_limited');
        }
        const token = await options.auth.login(username, password);
        if (!token) return sendError(response, 401, 'invalid_credentials');
        limiter.clear(ipKey);
        limiter.clear(attemptKey);
        response.setHeader('Set-Cookie', sessionCookie(token, options.secureCookies, sessionMaxAgeSeconds));
        return sendJson(response, 200, { authenticated: true });
      }

      const sessionToken = readCookie(request, COOKIE_NAME);
      if (pathname.startsWith('/api/') && !options.auth.isAuthenticated(sessionToken)) {
        return sendError(response, 401, 'authentication_required');
      }
      if (request.method === 'GET' && pathname === '/api/auth/me') {
        return sendJson(response, 200, { authenticated: true });
      }
      if (request.method === 'POST' && pathname === '/api/auth/logout') {
        if (!validOrigin(request, options.publicOrigin)) return sendError(response, 403, 'origin_forbidden');
        options.auth.logout(sessionToken);
        response.setHeader('Set-Cookie', clearSessionCookie(options.secureCookies));
        return sendJson(response, 200, { authenticated: false });
      }
      if (request.method === 'GET' && pathname === '/api/display-config') {
        const config: KdsDisplayConfig = { kitchens: [...kitchens], refresh_seconds: refreshSeconds };
        return sendJson(response, 200, config);
      }
      if (request.method === 'GET' && pathname === '/api/section-totals') {
        if ([...url.searchParams.keys()].some((key) => !['date', 'kitchen'].includes(key))) {
          return sendError(response, 400, 'invalid_query');
        }
        const date = url.searchParams.get('date') ?? '';
        const kitchen = url.searchParams.get('kitchen') ?? '';
        if (!validCalendarDate(date) || !KITCHEN_RE.test(kitchen) || !kitchens.has(kitchen)) {
          return sendError(response, 400, 'invalid_query');
        }
        try {
          return sendJson(response, 200, await totals.totals(date, kitchen));
        } catch (error) {
          return sendTotalsError(response, error);
        }
      }
      if (pathname === '/api/section-totals') return sendError(response, 405, 'method_not_allowed');
      if (pathname.startsWith('/api/')) return sendError(response, 404, 'not_found');
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendError(response, 405, 'method_not_allowed');
      return await serveWeb(response, request.method, pathname, options.webRoot);
    } catch (error) {
      if (error instanceof RequestError) return sendError(response, error.status, error.code);
      logger({ level: 'error', event: 'request_failed', method: request.method, path: pathname });
      return sendError(response, 500, 'internal_error');
    } finally {
      response.once('finish', () => logger({
        level: 'info',
        event: 'request',
        method: request.method,
        path: pathname,
        status: response.statusCode,
        duration_ms: Date.now() - started,
      }));
    }
  });
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const port = integerEnv(env.KDS_PORT, 8080, 1, 65_535, 'invalid_port');
  const publicOrigin = normalizeOrigin(env.KDS_PUBLIC_ORIGIN);
  const secureCookies = env.KDS_COOKIE_SECURE === undefined
    ? env.NODE_ENV === 'production'
    : env.KDS_COOKIE_SECURE === 'true';
  if (env.NODE_ENV === 'production' && (!secureCookies || !publicOrigin.startsWith('https://'))) {
    throw new Error('production_requires_https');
  }
  const kitchens = (env.KDS_KITCHENS ?? 'main').split(',').map((value) => value.trim()).filter(Boolean);
  if (kitchens.length === 0 || new Set(kitchens).size !== kitchens.length
    || kitchens.some((value) => !KITCHEN_RE.test(value))) {
    throw new Error('invalid_kitchens');
  }
  const sessionTtlMs = integerEnv(env.KDS_SESSION_TTL_MINUTES, 720, 5, 1440, 'invalid_session_ttl') * 60_000;
  const refreshSeconds = integerEnv(env.KDS_REFRESH_SECONDS, 60, 15, 300, 'invalid_refresh_seconds');
  const username = env.KDS_DISPLAY_USERNAME?.trim();
  const passwordHash = secretValue(env.KDS_DISPLAY_PASSWORD_HASH, env.KDS_DISPLAY_PASSWORD_HASH_FILE);
  if (!username || !passwordHash) throw new Error('display_auth_not_configured');
  const compiledDir = dirname(fileURLToPath(import.meta.url));
  return {
    port,
    publicOrigin,
    secureCookies,
    kitchens,
    refreshSeconds,
    sessionMaxAgeSeconds: sessionTtlMs / 1000,
    trustProxy: env.KDS_TRUST_PROXY === 'true',
    webRoot: env.KDS_WEB_ROOT?.trim() || resolve(compiledDir, '../../web'),
    source: PartnerSource.fromEnv(env),
    auth: new AuthManager({ username, passwordHash, sessionTtlMs }),
  };
}

function sendTotalsError(response: ServerResponse, error: unknown): void {
  if (!(error instanceof TotalsError)) throw error;
  if (error.code === 'response_invalid') return sendError(response, 502, 'kds_source_response_invalid');
  return sendError(response, 503, 'kds_source_unavailable');
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new RequestError(415, 'json_required');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > JSON_LIMIT_BYTES) throw new RequestError(413, 'body_too_large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RequestError(400, 'invalid_json');
  }
}

async function serveWeb(
  response: ServerResponse,
  method: string | undefined,
  pathname: string,
  webRoot: string,
): Promise<void> {
  let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!extname(relative)) relative = 'index.html';
  if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.split('/').includes('..')) {
    return sendError(response, 404, 'not_found');
  }
  const target = resolve(webRoot, relative);
  if (!target.startsWith(`${resolve(webRoot)}/`) && target !== resolve(webRoot, 'index.html')) {
    return sendError(response, 404, 'not_found');
  }
  try {
    const body = await readFile(target);
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType(target));
    response.setHeader('Cache-Control', relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
    response.end(method === 'HEAD' ? undefined : body);
  } catch {
    sendError(response, 404, 'not_found');
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, code: string): void {
  const body: KdsApiError = { error_code: code };
  sendJson(response, status, body);
}

function setSecurityHeaders(response: ServerResponse, secure: boolean): void {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header || header.length > 4096) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function validOrigin(request: IncomingMessage, expected: string): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first?.trim()) return first.trim().slice(0, 80);
  }
  return request.socket.remoteAddress?.slice(0, 80) ?? 'unknown';
}

function safeUsername(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 80) : '';
}

function normalizeOrigin(value: string | undefined): string {
  if (!value) throw new Error('public_origin_not_configured');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid_public_origin');
  }
  return url.origin;
}

function integerEnv(raw: string | undefined, fallback: number, min: number, max: number, code: string): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(code);
  return value;
}

function secretValue(direct: string | undefined, filePath: string | undefined): string | undefined {
  if (direct?.trim() && filePath?.trim()) throw new Error('ambiguous_secret_configuration');
  if (filePath?.trim()) {
    try {
      const value = readFileSync(filePath.trim(), 'utf8').trim();
      return value || undefined;
    } catch {
      throw new Error('secret_file_unreadable');
    }
  }
  return direct?.trim() || undefined;
}

function contentType(pathname: string): string {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
  } as Record<string, string>)[extname(pathname)] ?? 'application/octet-stream';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const server = createKdsServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.info(JSON.stringify({ level: 'info', event: 'server_started', port: config.port }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error(JSON.stringify({ level: 'error', event: 'startup_failed' }));
    process.exit(1);
  });
}
