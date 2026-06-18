import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing using scrypt (RFC 7914).
 * Format: scrypt$N=16384,r=8,p=1$<saltBase64>$<hashBase64>
 * No external dependencies — uses Node's built-in crypto.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const HASH_LEN = 64;
const SALT_LEN = 16;
const SCRYPT_PREFIX = `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$`;

export function hashPassword(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0 || plaintext.length > 1024) {
    throw new Error('Invalid password');
  }
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(plaintext.normalize('NFKC'), salt, HASH_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `${SCRYPT_PREFIX}${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(plaintext: string, stored: string): boolean {
  if (typeof plaintext !== 'string' || typeof stored !== 'string') return false;
  if (!stored.startsWith(SCRYPT_PREFIX)) return false;
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const saltStr = parts[2];
  const hashStr = parts[3];
  if (!saltStr || !hashStr) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltStr, 'base64');
    expected = Buffer.from(hashStr, 'base64');
  } catch {
    return false;
  }
  if (expected.length !== HASH_LEN) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(plaintext.normalize('NFKC'), salt, HASH_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
