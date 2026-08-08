import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
const HASH_BYTES = 32;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAX_PASSWORD_LENGTH = 256;
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

interface ParsedHash {
  digest: Buffer;
  salt: Buffer;
}

export interface AuthManagerConfig {
  username: string;
  passwordHash: string;
  sessionTtlMs?: number;
  now?: () => number;
  randomToken?: () => string;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

/** Independent in-memory server sessions. Raw session tokens are never stored. */
export class AuthManager {
  private readonly expected: ParsedHash;
  private readonly now: () => number;
  private readonly randomToken: () => string;
  private readonly sessions = new Map<string, number>();
  private readonly sessionTtlMs: number;
  private readonly username: string;

  constructor(config: AuthManagerConfig) {
    const username = config.username.trim();
    if (!/^[A-Za-z0-9._@-]{3,80}$/.test(username)) {
      throw new AuthConfigError('invalid_display_username');
    }
    this.expected = parsePasswordHash(config.passwordHash);
    this.username = username;
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
    const [usernameMatches, passwordMatches] = await Promise.all([
      Promise.resolve(safeTextEqual(candidateUsername, this.username)),
      verifyPassword(candidatePassword, this.expected),
    ]);
    if (!usernameMatches || !passwordMatches || !candidatePassword) return null;

    this.prune();
    const token = this.randomToken();
    if (!SESSION_TOKEN_RE.test(token)) throw new AuthConfigError('invalid_session_token');
    this.sessions.set(hashToken(token), this.now() + this.sessionTtlMs);
    return token;
  }

  isAuthenticated(token: string | null): boolean {
    if (!token || !SESSION_TOKEN_RE.test(token)) return false;
    const key = hashToken(token);
    const expiresAt = this.sessions.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= this.now()) {
      this.sessions.delete(key);
      return false;
    }
    return true;
  }

  logout(token: string | null): void {
    if (token && SESSION_TOKEN_RE.test(token)) this.sessions.delete(hashToken(token));
  }

  private prune(): void {
    const now = this.now();
    for (const [tokenHash, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(tokenHash);
    }
  }
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
