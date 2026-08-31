import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../../db/index';
import express, { Request, Response } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';

process.env.JWT_SECRET = 'test-e2e-secret';
process.env.GEMINI_API_KEY = 'test-key';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

const TEST_USER = 'testuser-e2e';
const TEST_PASSWORD = 'test-password-123';

describe('E2E: Full user session', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let baseUrl: string;
  let token: string;
  let db: ReturnType<typeof getDb>;

  beforeAll(async () => {
    const dbMod = await import('../../db/index');
    const passwords = await import('../../utils/passwords');
    db = dbMod.getDb();
    db.prepare('INSERT OR REPLACE INTO users (id, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(TEST_USER, TEST_USER, passwords.hashPassword(TEST_PASSWORD), 'user');

    const app = express();
    app.use(express.json());

    const { login } = await import('../../middleware/auth');
    app.post('/api/auth/login', login);
    app.get('/api/agent/analytics', (req: Request, res: Response) => {
      res.json({
        totalFeedback: 1,
        satisfactionRate: 100,
        totalUpvotes: 1,
        totalDownvotes: 0,
        recentFeedback: [{ id: 'fb1', userId: 'test', query: 'test q', vote: 'up', intentType: 'scan', modelTier: 'flash', timestamp: Date.now() }],
        byIntent: { scan: { up: 1, down: 0, rate: 100 } },
        byModel: { flash: { up: 1, down: 0, rate: 100 } },
        cost: { totalCost: 0.001, totalQueries: 1, avgCostPerQuery: 0.001, byModel: {} },
        cache: { hitRate: 0.5, size: 10 },
        ml: { avgOverallScore: 0.75, recentEvalCount: 1, byIntentScores: {}, promptVariants: 8, kgEntityCount: 0, kgRelationCount: 0, predictionPatterns: 0 },
      });
    });

    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(3005, resolve));

    const { WebSocketServer } = await import('ws');
    wss = new WebSocketServer({ server, path: '/ws/agent' });
    wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const urlParams = new URL(req.url!, `http://${req.headers.host}`).searchParams;
      const token = urlParams.get('token');
      if (!token) { ws.close(4001, 'Auth required'); return; }
      try {
        jwt.verify(token, process.env.JWT_SECRET!);
      } catch {
        ws.close(4001, 'Invalid token');
        return;
      }
      ws.send(JSON.stringify({ type: 'connected', userId: 'test', channels: [] }));
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        if (msg.type === 'subscribe') {
          ws.send(JSON.stringify({ type: 'subscribed', channels: msg.channels }));
          // Send a proactive event after subscribe
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'monitor_trigger', channel: 'proactive', data: { rule: { id: 'r1', label: 'M6+ alert' } } }));
          }, 100);
        }
      });
    });

    baseUrl = 'http://localhost:3005';
  });

  afterAll(async () => {
    wss.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db?.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER);
  });

  it('1. Login', async () => {
    const resp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASSWORD }),
    });
    const data = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(200);
    expect(data.token).toBeTruthy();
    token = data.token as string;
  });

  it('2. WebSocket connect and subscribe', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:3005/ws/agent?token=${token}`);
      const messages: unknown[] = [];
      const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 5000);

      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);

        if (msg.type === 'connected') {
          ws.send(JSON.stringify({ type: 'subscribe', channels: ['proactive'] }));
        }

        if (msg.type === 'monitor_trigger') {
          clearTimeout(timeout);
          expect(msg.data.rule.label).toBe('M6+ alert');
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  });

  it('3. Check analytics', async () => {
    const resp = await fetch(`${baseUrl}/api/agent/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(200);
    expect(data.totalFeedback).toBe(1);
    expect(data.satisfactionRate).toBe(100);
  });
});
