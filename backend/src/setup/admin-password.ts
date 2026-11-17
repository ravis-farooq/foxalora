import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Administrator password hashing (FOX-081). scrypt from Node's crypto module, so no new
 * dependency; parameters follow the OWASP Password Storage Cheat Sheet minimum
 * (N=2^17, r=8, p=1). Stored as scrypt$N$r$p$salt$hash (base64url), so the cost can be
 * raised later without breaking existing hashes.
 *
 * Mailbox passwords are never hashed or stored here: they live only in the session vault.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, key) => (e ? reject(e) : resolve(key))));
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const params = [Number(n), Number(r), Number(p)];
  // Refuse absurd parameters from a tampered row instead of burning CPU or memory.
  if (!params.every(Number.isInteger) || params[0] < 2 ** 14 || params[0] > 2 ** 20 || params[1] > 16 || params[2] > 4) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), params[0], params[1], params[2]);
  return expected.length === key.length && timingSafeEqual(expected, key);
}

/** NIST SP 800-63B: length, not composition rules. */
export function adminPasswordProblem(password: unknown, email: string): string | null {
  if (typeof password !== 'string' || password.length < 12) return 'The password must have at least 12 characters.';
  if (password.length > 200) return 'The password can have at most 200 characters.';
  if (password.trim().toLowerCase() === email.toLowerCase()) return 'The password must not be the email address.';
  return null;
}
