import { hash, verify } from '@node-rs/argon2';

// DEC-011: argon2id, server-side sessions, no JWTs.
// Parameters pinned (WP-02, closing the WP-01 NC): OWASP-recommended argon2id
// profile — 19 MiB memory, t=2, p=1.
const ARGON2_OPTS = {
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
