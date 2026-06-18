import { randomBytes } from 'crypto';

/**
 * Input validation utilities for authentication.
 */

/**
 * Sanitize and validate a username.
 * Rules:
 *   - Must be a string
 *   - Must be 3-32 characters long
 *   - Allowed characters: a-z, A-Z, 0-9, underscore, dash, dot
 *   - Cannot start with a dot
 *   - Reject if it contains HTML-special characters
 * Returns the normalized username (lowercase), or null if invalid.
 */
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!USERNAME_RE.test(trimmed)) return null;
  if (trimmed.startsWith('.')) return null;
  if (trimmed.includes('..')) return null;
  return trimmed.toLowerCase();
}

/**
 * Validate a password.
 * Rules:
 *   - Must be a string
 *   - 8-128 characters
 *   - No NUL bytes (defense against C-string truncation attacks)
 * Returns true if valid.
 */
export function isValidPassword(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  if (raw.length < 8 || raw.length > 128) return false;
  if (raw.indexOf('\0') !== -1) return false;
  return true;
}

/**
 * Validate a JWT secret strength.
 * Returns a list of weakness issues (empty if strong enough).
 */
export function validateJwtSecretStrength(secret: string | undefined): string[] {
  const issues: string[] = [];
  if (!secret) {
    issues.push('JWT_SECRET is not set');
    return issues;
  }
  if (secret.length < 32) {
    issues.push(`JWT_SECRET is too short (${secret.length} < 32 chars)`);
  }
  const weak = ['dev-secret', 'change-me', 'your-', 'secret', '12345', 'password', 'admin', 'test'];
  const lower = secret.toLowerCase();
  for (const w of weak) {
    if (lower.includes(w)) {
      issues.push(`JWT_SECRET contains weak pattern: "${w}"`);
      break;
    }
  }
  const unique = new Set(secret).size;
  if (unique < 8) {
    issues.push(`JWT_SECRET has low entropy (${unique} unique chars)`);
  }
  return issues;
}

/**
 * Generate a cryptographically random secret of given byte length.
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

