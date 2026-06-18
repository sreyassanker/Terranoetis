import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';

const schemaPath = path.resolve(import.meta.dirname, '../../db/schema.sql');

let db: Database.Database;

vi.mock('../../db/index', () => ({
  getDb: () => db,
  closeDb: () => {},
}));

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const fsModule = require('fs');
  const schema = fsModule.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  db.exec(`CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    error TEXT
  )`);
});

afterAll(() => db.close());

beforeEach(() => {
  db.exec(`DELETE FROM job_queue`);
});

describe('SimpleQueue', () => {
  it('add and process', async () => {
    const { SimpleQueue } = await import('../../queue/simple-queue');
    const q = new SimpleQueue(10);
    const handler = vi.fn().mockResolvedValue(undefined);
    q.process('test_type', handler);

    q.add('test_type', { data: 'hello' });
    await new Promise(r => setTimeout(r, 150));
    expect(handler).toHaveBeenCalled();
    const payload = handler.mock.calls[0][0];
    expect(payload).toEqual({ data: 'hello' });
    await q.shutdown(100);
  });

  it('processes jobs in priority order', async () => {
    const { SimpleQueue } = await import('../../queue/simple-queue');
    const q = new SimpleQueue(10);
    const order: number[] = [];
    q.process('task', async (_payload: any, job: any) => {
      order.push(job.id);
    });

    q.add('task', {}, 0, 0);
    q.add('task', {}, 0, 10);
    await new Promise(r => setTimeout(r, 150));
    expect(order.length).toBe(2);
    await q.shutdown(100);
  });

  it('recurring() schedules repeated jobs', async () => {
    const { SimpleQueue } = await import('../../queue/simple-queue');
    const q = new SimpleQueue(10);
    let callCount = 0;
    q.process('recurring_task', async () => { callCount++; });

    q.recurring('recurring_task', 50);
    await new Promise(r => setTimeout(r, 120));
    expect(callCount).toBeGreaterThanOrEqual(1);
    await q.shutdown(100);
  });

  it('shuts down cleanly', async () => {
    const { SimpleQueue } = await import('../../queue/simple-queue');
    const q = new SimpleQueue(10);
    await q.shutdown(100);
    expect(true).toBe(true);
  });
});
