import { describe, expect, it } from 'vitest';
import {
  AuthConfigError,
  AuthManager,
  createPasswordHash,
  parseAuthUsers,
  type AuthUserConfig,
} from '../src/api/auth.js';

const SALT = Buffer.alloc(16, 7);
const TOKEN = 'a'.repeat(43);

describe('section-assigned display authentication', () => {
  it('binds the authenticated user and exact section assignments to the opaque session', async () => {
    const passwordHash = await createPasswordHash('correct horse battery staple', SALT);
    const auth = new AuthManager({
      users: [user('hot-display', passwordHash, ['hot'])],
      randomToken: () => TOKEN,
    });
    expect(await auth.login('hot-display', 'wrong')).toBeNull();
    const token = await auth.login('hot-display', 'correct horse battery staple');
    expect(token).toBe(TOKEN);
    expect(auth.principal(TOKEN)).toEqual({ username: 'hot-display', sectionCodes: ['hot'] });
    expect(auth.isAuthenticated(TOKEN)).toBe(true);
    auth.logout(TOKEN);
    expect(auth.principal(TOKEN)).toBeNull();
  });

  it('isolates users with different section assignments even when their password is the same', async () => {
    const passwordHash = await createPasswordHash('shared fixture password', SALT);
    let sequence = 0;
    const auth = new AuthManager({
      users: [
        user('hot-display', passwordHash, ['hot']),
        user('packing-display', passwordHash, ['packing']),
      ],
      randomToken: () => `${sequence++ ? 'b' : 'a'}`.repeat(43),
    });
    const hotToken = await auth.login('hot-display', 'shared fixture password');
    const packingToken = await auth.login('packing-display', 'shared fixture password');
    expect(auth.principal(hotToken)).toMatchObject({ username: 'hot-display', sectionCodes: ['hot'] });
    expect(auth.principal(packingToken)).toMatchObject({ username: 'packing-display', sectionCodes: ['packing'] });
  });

  it('expires sessions without sliding their lifetime', async () => {
    let now = 1_000_000;
    const auth = new AuthManager({
      users: [user('hot-display', await createPasswordHash('a secure password', SALT), ['hot'])],
      sessionTtlMs: 5 * 60 * 1000,
      now: () => now,
      randomToken: () => TOKEN,
    });
    await auth.login('hot-display', 'a secure password');
    now += 4 * 60 * 1000;
    expect(auth.isAuthenticated(TOKEN)).toBe(true);
    now += 61 * 1000;
    expect(auth.isAuthenticated(TOKEN)).toBe(false);
  });

  it('parses the protected versioned user manifest and rejects malformed assignments', async () => {
    const passwordHash = await createPasswordHash('a secure password', SALT);
    expect(parseAuthUsers(JSON.stringify({
      version: 1,
      users: [{ username: 'hot-display', password_hash: passwordHash, section_codes: ['hot'] }],
    }))).toEqual([user('hot-display', passwordHash, ['hot'])]);

    expect(() => parseAuthUsers('{')).toThrow(AuthConfigError);
    expect(() => new AuthManager({ users: [user('../admin', passwordHash, ['hot'])] }))
      .toThrow(AuthConfigError);
    expect(() => new AuthManager({ users: [user('hot-display', passwordHash, [])] }))
      .toThrowError(expect.objectContaining({ message: 'invalid_section_assignments' }));
    expect(() => new AuthManager({
      users: [user('hot-display', passwordHash, ['hot']), user('hot-display', passwordHash, ['packing'])],
    })).toThrowError(expect.objectContaining({ message: 'invalid_display_username' }));
    expect(() => new AuthManager({
      users: [user('valid-user', 'bad', ['hot'])],
    })).toThrowError(expect.objectContaining({ message: 'invalid_password_hash' }));
  });

  it('does not accept oversized or non-string login fields', async () => {
    const auth = new AuthManager({
      users: [user('hot-display', await createPasswordHash('a secure password', SALT), ['hot'])],
    });
    expect(await auth.login('hot-display', 'x'.repeat(257))).toBeNull();
    expect(await auth.login({ value: 'hot-display' }, 'a secure password')).toBeNull();
  });
});

function user(username: string, passwordHash: string, sectionCodes: string[]): AuthUserConfig {
  return { username, passwordHash, sectionCodes };
}
