import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
const HASH_BYTES = 32;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAX_PASSWORD_LENGTH = 256;
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,80}$/;
const SECTION_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const MAX_USERS = 100;
const MAX_SECTIONS_PER_USER = 50;

interface ParsedHash {
  digest: Buffer;
  salt: Buffer;
}

export interface AuthUserConfig {
  username: string;
  passwordHash: string;
  sectionCodes: string[];
}

export interface AuthManagerConfig {
  users: AuthUserConfig[];
  sessionTtlMs?: number;
  now?: () => number;
  randomToken?: () => string;
}

export interface AuthPrincipal {
  username: string;
  sectionCodes: string[];
}

interface Credential {
  expected: ParsedHash;
  principal: AuthPrincipal;
}

interface Session {
  expiresAt: number;
  principal: AuthPrincipal;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

/** Independent in-memory server sessions. Raw session tokens are never stored. */
export class AuthManager {
  private readonly credentials = new Map<string, Credential>();
  private readonly dummyExpected: ParsedHash;
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionTtlMs: number;

  constructor(config: AuthManagerConfig) {
    if (!Array.isArray(config.users) || config.users.length === 0 || config.users.length > MAX_USERS) {
      throw new AuthConfigError('invalid_display_users');
    }
    for (const user of config.users) {
      const username = user.username.trim();
      if (!USERNAME_RE.test(username) || this.credentials.has(username)) {
        throw new AuthConfigError('invalid_display_username');
      }
      if (!Array.isArray(user.sectionCodes) || user.sectionCodes.length === 0
        || user.sectionCodes.length > MAX_SECTIONS_PER_USER) {
        throw new AuthConfigError('invalid_section_assignments');
      }
      const sectionCodes = user.sectionCodes.map((value) => value.trim());
      if (sectionCodes.some((value) => !SECTION_CODE_RE.test(value))
        || new Set(sectionCodes).size !== sectionCodes.length) {
        throw new AuthConfigError('invalid_section_assignments');
      }
      this.credentials.set(username, {
        expected: parsePasswordHash(user.passwordHash),
        principal: { username, sectionCodes },
      });
    }
    this.dummyExpected = this.credentials.values().next().value!.expected;
    this.sessionTtlMs = config.sessionTtlMs ?? 12 * 60 * 60 * 1000;
    if (!Number.isInteger(this.sessionTtlMs) || this.sessionTtlMs < 5 * 60 * 1000
      || this.sessionTtlMs > 24 * 60 * 60 * 1000) {
      throw new AuthConfigError('invalid_session_ttl');
    }
    this.now = config.now ?? Date.now;
    this.randomToken = config.randomToken ?? (() => randomBytes(32).toString('base64url'));
  }

  async login(username: unknown, password: unknown): Promise<string | null> {
    const candidateUsername = typeof username === 'string' && username.length <= 80 ? username : '';
    const candidatePassword = typeof password === 'string' && password.length <= MAX_PASSWORD_LENGTH
      ? password
      : '';
    const credential = this.credentials.get(candidateUsername);
    const passwordMatches = await verifyPassword(
      candidatePassword,
      credential?.expected ?? this.dummyExpected,
    );
    if (!credential || !safeTextEqual(candidateUsername, credential.principal.username)
      || !passwordMatches || !candidatePassword) return null;

    this.prune();
    const token = this.randomToken();
    if (!SESSION_TOKEN_RE.test(token)) throw new AuthConfigError('invalid_session_token');
    this.sessions.set(hashToken(token), {
      expiresAt: this.now() + this.sessionTtlMs,
      principal: clonePrincipal(credential.principal),
    });
    return token;
  }

  isAuthenticated(token: string | null): boolean {
    return this.principal(token) !== null;
  }

  principal(token: string | null): AuthPrincipal | null {
    if (!token || !SESSION_TOKEN_RE.test(token)) return null;
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    return clonePrincipal(session.principal);
  }

  logout(token: string | null): void {
    if (token && SESSION_TOKEN_RE.test(token)) this.sessions.delete(hashToken(token));
  }

  private prune(): void {
    const now = this.now();
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(tokenHash);
    }
  }
}

export function parseAuthUsers(raw: string): AuthUserConfig[] {
  if (!raw || raw.length > 128 * 1024) throw new AuthConfigError('invalid_display_users');
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new AuthConfigError('invalid_display_users');
  }
  if (!isRecord(decoded) || decoded.version !== 1 || !Array.isArray(decoded.users)) {
    throw new AuthConfigError('invalid_display_users');
  }
  return decoded.users.map((value) => {
    if (!isRecord(value) || typeof value.username !== 'string'
      || typeof value.password_hash !== 'string' || !Array.isArray(value.section_codes)
      || value.section_codes.some((code) => typeof code !== 'string')) {
      throw new AuthConfigError('invalid_display_users');
    }
    return {
      username: value.username,
      passwordHash: value.password_hash,
      sectionCodes: value.section_codes as string[],
    };
  });
}

export async function createPasswordHash(password: string, salt = randomBytes(16)): Promise<string> {
  if (!password || password.length > MAX_PASSWORD_LENGTH || salt.length < 16) {
    throw new AuthConfigError('invalid_password');
  }
  const derived = await derive(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function parsePasswordHash(encoded: string): ParsedHash {
  const [algorithm, n, r, p, saltRaw, digestRaw, ...extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R
    || Number(p) !== SCRYPT_P || !saltRaw || !digestRaw || extra.length > 0) {
    throw new AuthConfigError('invalid_password_hash');
  }
  try {
    const salt = Buffer.from(saltRaw, 'base64url');
    const digest = Buffer.from(digestRaw, 'base64url');
    if (salt.length < 16 || digest.length !== HASH_BYTES) throw new Error('invalid');
    return { salt, digest };
  } catch {
    throw new AuthConfigError('invalid_password_hash');
  }
}

async function verifyPassword(password: string, expected: ParsedHash): Promise<boolean> {
  const candidate = await derive(password, expected.salt);
  return timingSafeEqual(candidate, expected.digest);
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, HASH_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function safeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function clonePrincipal(principal: AuthPrincipal): AuthPrincipal {
  return { username: principal.username, sectionCodes: [...principal.sectionCodes] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
