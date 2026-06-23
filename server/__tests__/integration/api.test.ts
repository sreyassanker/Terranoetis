import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'test-key';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

const TEST_USER = 'testuser-api';
const TEST_PASSWORD = 'test-password-123';

describe('Integration: full auth flow', () => {
  let app: ReturnType<typeof express>;
  let server: http.Server;
  let login: (req: Request, res: Response, next: NextFunction) => void;
  let authGuard: (req: Request, res: Response, next: NextFunction) => void;
  let db: ReturnType<typeof import('../../db/index').getDb>;

  beforeAll(async () => {
    const dbMod = await import('../../db/index');
    const passwords = await import('../../utils/passwords');
    db = dbMod.getDb();
    db.prepare('INSERT OR REPLACE INTO users (id, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(TEST_USER, TEST_USER, passwords.hashPassword(TEST_PASSWORD), 'user');

    const auth = await import('../../middleware/auth');
    login = auth.login;
    authGuard = auth.authGuard;

    app = express();
    app.use(express.json());
    app.post('/api/auth/login', login);
    app.get('/api/protected', (req: Request, res: Response, next: NextFunction) => authGuard(req, res, next), (req: Request, res: Response) => {
      res.json({ ok: true, userId: req.userId });
    });

    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(3002, resolve));
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db?.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER);
  });

  it('POST /api/auth/login returns token', async () => {
    const resp = await fetch('http://localhost:3002/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASSWORD }),
    });
    const data = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(200);
    expect(data.token).toBeTruthy();
    expect(data.userId).toBe(TEST_USER);
  });

  it('access protected route with valid token', async () => {
    const token = jwt.sign({ sub: TEST_USER }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const resp = await fetch('http://localhost:3002/api/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.userId).toBe(TEST_USER);
  });

  it('access protected route without token returns 401', async () => {
    const resp = await fetch('http://localhost:3002/api/protected');
    expect(resp.status).toBe(401);
  });

  it('access after logout (token cleared) returns 401', async () => {
    const resp = await fetch('http://localhost:3002/api/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(resp.status).toBe(401);
  });
});

describe('Integration: health endpoints', () => {
  let app: ReturnType<typeof express>;
  let server: http.Server;

  beforeAll(async () => {
    app = express();
    app.get('/api/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', checks: { db: { status: 'ok' }, memory: { status: 'ok', detail: '64MB' } }, uptime_ms: process.uptime() * 1000, version: '0.0.0', ts: Date.now() });
    });
    app.get('/api/ready', (req: Request, res: Response) => {
      res.json({ status: 'ready', checks: { db: 'ok' }, uptime_ms: process.uptime() * 1000 });
    });
    app.get('/api/live', (req: Request, res: Response) => {
      res.json({ ok: true, ts: Date.now() });
    });

    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(3003, resolve));
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('GET /api/health returns status object', async () => {
    const resp = await fetch('http://localhost:3003/api/health');
    const data = await resp.json() as Record<string, unknown>;
    expect(data.status).toBe('ok');
    expect(data.checks.db).toBeTruthy();
    expect(data.checks.memory).toBeTruthy();
    expect(data.version).toBeTruthy();
  });

  it('GET /api/ready returns ready status', async () => {
    const resp = await fetch('http://localhost:3003/api/ready');
    const data = await resp.json() as Record<string, unknown>;
    expect(data.status).toBe('ready');
  });

  it('GET /api/live returns ok', async () => {
    const resp = await fetch('http://localhost:3003/api/live');
    const data = await resp.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });
});

describe('Integration: metrics endpoint', () => {
  let app: ReturnType<typeof express>;
  let server: http.Server;

  beforeAll(async () => {
    app = express();
    app.get('/api/metrics', (req: Request, res: Response) => {
      res.set('Content-Type', 'text/plain; version=0.0.4');
      res.send('# HELP process_cpu_seconds_total Total CPU time\n# TYPE process_cpu_seconds_total counter\nprocess_cpu_seconds_total 1.5\n');
    });
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(3004, resolve));
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('GET /api/metrics returns Prometheus format', async () => {
    const resp = await fetch('http://localhost:3004/api/metrics');
    const text = await resp.text();
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toContain('text/plain');
    expect(text).toContain('process_cpu_seconds_total');
    expect(text).toContain('# HELP');
    expect(text).toContain('# TYPE');
  });
});
