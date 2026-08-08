import { describe, expect, it } from 'vitest';
import { AuthConfigError, AuthManager, createPasswordHash } from '../src/api/auth.js';

const SALT = Buffer.alloc(16, 7);
const TOKEN = 'a'.repeat(43);

describe('independent display authentication', () => {
  it('verifies scrypt credentials and stores only a hashed opaque session token', async () => {
    const passwordHash = await createPasswordHash('correct horse battery staple', SALT);
    const auth = new AuthManager({
      username: 'kitchen-display',
      passwordHash,
      randomToken: () => TOKEN,
    });
    expect(await auth.login('kitchen-display', 'wrong')).toBeNull();
    const token = await auth.login('kitchen-display', 'correct horse battery staple');
    expect(token).toBe(TOKEN);
    expect(auth.isAuthenticated(TOKEN)).toBe(true);
    auth.logout(TOKEN);
    expect(auth.isAuthenticated(TOKEN)).toBe(false);
  });

  it('expires sessions without sliding their lifetime', async () => {
    let now = 1_000_000;
    const auth = new AuthManager({
      username: 'kitchen-display',
      passwordHash: await createPasswordHash('a secure password', SALT),
      sessionTtlMs: 5 * 60 * 1000,
      now: () => now,
      randomToken: () => TOKEN,
    });
    await auth.login('kitchen-display', 'a secure password');
    now += 4 * 60 * 1000;
    expect(auth.isAuthenticated(TOKEN)).toBe(true);
    now += 61 * 1000;
    expect(auth.isAuthenticated(TOKEN)).toBe(false);
  });

  it('rejects malformed credentials and hash parameters', async () => {
    await expect(createPasswordHash('')).rejects.toBeInstanceOf(AuthConfigError);
    expect(() => new AuthManager({ username: '../admin', passwordHash: 'bad' })).toThrow(AuthConfigError);
    expect(() => new AuthManager({
      username: 'valid-user',
      passwordHash: 'scrypt$1$8$1$c2FsdHNhbHRzYWx0c2FsdA$ZGlnaWVzdA',
    })).toThrowError(expect.objectContaining({ message: 'invalid_password_hash' }));
  });

  it('does not accept oversized or non-string login fields', async () => {
    const auth = new AuthManager({
      username: 'kitchen-display',
      passwordHash: await createPasswordHash('a secure password', SALT),
    });
    expect(await auth.login('kitchen-display', 'x'.repeat(257))).toBeNull();
    expect(await auth.login({ value: 'kitchen-display' }, 'a secure password')).toBeNull();
  });
});
