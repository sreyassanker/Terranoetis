import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index';
import { hashPassword, verifyPassword } from '../utils/passwords';
import { normalizeUsername, isValidPassword, generateSecret } from '../utils/validation';
import { logger } from '../observability/logger';

const TOKEN_TTL = process.env.NODE_ENV === 'production' ? '1h' : '1d';
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (IS_PROD && (!secret || secret.length < 32)) {
    throw new Error('JWT_SECRET must be at least 32 chars in production');
  }
  if (!secret) {
    if (IS_PROD) throw new Error('JWT_SECRET required in production');
    const generated = generateSecret(48);
    logger.warn({ length: generated.length }, 'JWT_SECRET not set — generated ephemeral dev secret (DO NOT use in production)');
    return generated;
  }
  return secret;
}

let cachedSecret: string | null = null;
function JWT_SECRET(): string {
  if (!cachedSecret) cachedSecret = getSecret();
  return cachedSecret;
}

interface UserRow {
  id: string;
  name: string;
  password_hash: string;
  role: string;
  failed_attempts: number;
  locked_until: string | null;
}


function getUserByName(name: string): UserRow | null {
  try {
    const row = getDb()
      .prepare('SELECT id, name, password_hash, role, failed_attempts, locked_until FROM users WHERE name = ?')
      .get(name) as UserRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function recordFailedAttempt(userId: string): void {
  try {
    getDb()
      .prepare('UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= ? THEN datetime(\'now\', \'+\' || ? || \' seconds\') ELSE locked_until END WHERE id = ?')
      .run(MAX_FAILED_ATTEMPTS, Math.floor(LOCKOUT_MS / 1000), userId);
  } catch (err) {
    logger.warn({ err, userId }, 'failed to record failed login attempt');
  }
}

function recordSuccessfulLogin(userId: string): void {
  try {
    getDb()
      .prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime(\'now\') WHERE id = ?')
      .run(userId);
  } catch (err) {
    logger.warn({ err, userId }, 'failed to record successful login');
  }
}

function isLocked(user: UserRow): boolean {
  if (!user.locked_until) return false;
  const until = Date.parse(user.locked_until);
  if (Number.isNaN(until)) return false;
  return until > Date.now();
}

/**
 * Provision an admin user if one does not exist. Logs a one-time password.
 * In production, ADMIN_BOOTSTRAP_PASSWORD must be set or the admin is disabled.
 */
export function ensureDefaultAdmin(): void {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string } | undefined;
    if (existing) return;

    const adminId = 'admin';
    let password: string;
    if (IS_PROD) {
      const envPwd = process.env.ADMIN_BOOTSTRAP_PASSWORD;
      if (!envPwd || envPwd.length < 16) {
        logger.error('Admin user does not exist and ADMIN_BOOTSTRAP_PASSWORD is not set (or < 16 chars). Set it in .env or create an admin manually via the CLI. Skipping admin bootstrap.');
        return;
      }
      password = envPwd;
    } else {
      password = generateSecret(18);
      logger.warn({ adminId, devPassword: password }, 'Provisioned default admin user (DEV ONLY). Set ADMIN_BOOTSTRAP_PASSWORD in production.');
    }

    const hash = hashPassword(password);
    db.prepare('INSERT OR REPLACE INTO users (id, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
      adminId, adminId, hash, 'admin',
    );
  } catch (err) {
    logger.error({ err }, 'Failed to ensure default admin user');
  }
}

export function login(req: Request, res: Response): void {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  const normalized = normalizeUsername(username);
  if (!normalized) {
    res.status(400).json({ error: 'Invalid username format' });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: 'Invalid password format' });
    return;
  }

  const user = getUserByName(normalized);
  if (!user) {
    // Constant-time-ish: still hash to avoid timing oracles on user existence
    hashPassword(password);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (isLocked(user)) {
    res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
    return;
  }

  if (!user.password_hash) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const ok = verifyPassword(password, user.password_hash);
  if (!ok) {
    recordFailedAttempt(user.id);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  recordSuccessfulLogin(user.id);
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET(), { expiresIn: TOKEN_TTL });
  res.json({ token, userId: user.id, role: user.role });
}

export function authGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <token>' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET()) as { sub?: unknown; role?: unknown };
    if (typeof payload.sub !== 'string') {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }
    (req as unknown as Record<string, unknown>).userId = payload.sub;
    (req as unknown as Record<string, unknown>).userRole = typeof payload.role === 'string' ? payload.role : 'user';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as unknown as Record<string, unknown>).userRole as string;
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'Forbidden — insufficient role' });
      return;
    }
    next();
  };
}


export function sseAuthGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET()) as { sub?: unknown };
      if (typeof payload.sub === 'string') {
        (req as unknown as Record<string, unknown>).userId = payload.sub;
        next();
        return;
      }
    } catch {
      /* fall through */
    }
  }
  const token = req.query.token as string;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET()) as { sub?: unknown };
      if (typeof payload.sub === 'string') {
        (req as unknown as Record<string, unknown>).userId = payload.sub;
        next();
        return;
      }
    } catch {
      /* fall through */
    }
  }
  res.status(401).json({ error: 'Authentication required. Provide token via ?token= query param or Authorization Bearer header.' });
}

/** Dev-only: issue JWT for admin without password (never mount in production). */
export function devAutoLogin(req: Request, res: Response): void {
  if (IS_PROD) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const user = getUserByName('admin');
  if (!user) {
    res.status(503).json({ error: 'Admin user not provisioned. Restart server and check logs for devPassword.' });
    return;
  }
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET(), { expiresIn: TOKEN_TTL });
  res.json({ token, userId: user.id, role: user.role });
}


export { JWT_SECRET as _JWT_SECRET };
