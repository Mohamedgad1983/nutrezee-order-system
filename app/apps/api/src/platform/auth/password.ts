import { hash, verify } from '@node-rs/argon2';

// DEC-011: argon2id, server-side sessions, no JWTs. Library defaults are argon2id
// with current OWASP-aligned parameters [Proposed — pin explicit params at WP-02].
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
