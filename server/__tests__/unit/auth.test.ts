import { describe, it, expect, vi, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret-key';

describe('JWT sign/verify', () => {
  it('should sign and verify with valid secret', () => {
    const token = jwt.sign({ sub: 'test-user', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>;
    expect(decoded.sub).toBe('test-user');
    expect(decoded.role).toBe('user');
  });

  it('should reject expired token', () => {
    const token = jwt.sign({ sub: 'test-user' }, process.env.JWT_SECRET!, { expiresIn: '0ms' });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(() => jwt.verify(token, process.env.JWT_SECRET!)).toThrow('expired');
        resolve();
      }, 20);
    });
  });

  it('should reject token with wrong secret', () => {
    const token = jwt.sign({ sub: 'test-user' }, 'wrong-secret', { expiresIn: '1h' });
    expect(() => jwt.verify(token, process.env.JWT_SECRET!)).toThrow();
  });
});

describe('authGuard', () => {
  let authGuard: (req: unknown, res: unknown, next: unknown) => void;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-key';
    const mod = await import('../../middleware/auth');
    authGuard = mod.authGuard;
  });

  function mockReqRes(headers: Record<string, string>) {
    const req: Record<string, unknown> = { headers };
    req.get = (h: string) => headers[h.toLowerCase()] || headers[h];
    const res: Record<string, unknown> = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    return { req, res, next };
  }

  it('should pass with valid token', () => {
    const token = jwt.sign({ sub: 'test-user', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${token}` });
    authGuard(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('test-user');
  });

  it('should return 401 with missing token', () => {
    const { req, res, next } = mockReqRes({});
    authGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 with bad token', () => {
    const { req, res, next } = mockReqRes({ authorization: 'Bearer invalid-token' });
    authGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('sseAuthGuard', () => {
  let sseAuthGuard: (req: unknown, res: unknown, next: unknown) => void;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-key';
    const mod = await import('../../middleware/auth');
    sseAuthGuard = mod.sseAuthGuard;
  });

  it('should accept header auth', () => {
    const token = jwt.sign({ sub: 'test-user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res: Record<string, unknown> = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    sseAuthGuard(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should accept query param auth', () => {
    const token = jwt.sign({ sub: 'test-user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const req: Record<string, unknown> = { headers: {}, query: { token } };
    const res: Record<string, unknown> = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    sseAuthGuard(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 401 with no auth', () => {
    const req: Record<string, unknown> = { headers: {}, query: {} };
    const res: Record<string, unknown> = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    sseAuthGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
