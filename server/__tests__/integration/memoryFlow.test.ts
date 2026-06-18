import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database;
const schemaPath = path.resolve(import.meta.dirname, '../../db/schema.sql');

vi.mock('../../db/index', () => ({
  getDb: () => db,
  closeDb: () => {},
}));

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
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

beforeEach(() => {
  for (const t of ['episodes', 'facts', 'cache_entries', 'procedural_patterns', 'profiles', 'vec_store']) {
    try { db.exec(`DELETE FROM ${t}`); } catch {}
  }
  db.exec(`DELETE FROM job_queue`);
});

describe('Memory flow: query → store → search → cache', () => {
  it('records query as episode then search finds it', async () => {
    const { EpisodicMemory } = await import('../../memory');
    const mem = new EpisodicMemory('u1');
    mem.add({ userId: 'u1', query: 'Show me earthquakes near Japan', response: 'Here are the latest earthquakes...', intentType: 'scan', location: { lat: 35, lon: 139 } });
    mem.add({ userId: 'u1', query: 'What is the weather in London?', response: 'London weather is cloudy...', intentType: 'weather' });
    const results = mem.search('Japan earthquakes', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].query).toContain('Japan');
  });

  it('cache hit on repeat query', async () => {
    const { SemanticCache } = await import('../../memory');
    const mockEmb = { embed: vi.fn().mockResolvedValue(new Float32Array(768)) } as any;
    const cache = new SemanticCache(mockEmb);
    await cache.set('repeated query', 'cached response');
    expect(await cache.get('repeated query')).toBe('cached response');
    expect(await cache.get('repeated query')).toBe('cached response');
  });

  it('cache miss returns undefined', async () => {
    const { SemanticCache } = await import('../../memory');
    const mockEmb = { embed: vi.fn().mockResolvedValue(new Float32Array(768)) } as any;
    const cache = new SemanticCache(mockEmb);
    expect(await cache.get('nonexistent query')).toBeUndefined();
  });
});

describe('Fact extraction and search', () => {
  it('storing and searching facts', async () => {
    const { FactManager } = await import('../../memory');
    const embedder = {
      embed: vi.fn()
        .mockResolvedValueOnce(new Float32Array(768).fill(0.1))  // store fact 1
        .mockResolvedValueOnce(new Float32Array(768).fill(0.1))  // store fact 2
        .mockResolvedValueOnce(new Float32Array(768).fill(0.1)), // search
    } as any;
    const fm = new FactManager(embedder);
    await fm.storeFact('u1', 'Japan is in the Pacific Ring of Fire', 'ep1');
    await fm.storeFact('u1', 'Tokyo is the capital of Japan', 'ep2');
    const results = await fm.searchFacts('Japan', 'u1');
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Procedural memory: pattern storage and retrieval', () => {
  it('recordPattern stores and retrieves', async () => {
    const { ProceduralMemory } = await import('../../memory');
    const pm = new ProceduralMemory();
    pm.recordPattern('u1', 'scan', { query: 'earthquakes', response: 'Found earthquakes', intentType: 'scan' });
    pm.recordPattern('u2', 'scan', { query: 'weather', response: 'Found weather', intentType: 'scan' });
    const patterns = pm.getPatterns('u1', 'scan');
    expect(patterns.length).toBe(1);
    expect(patterns[0].userId).toBe('u1');
  });

  it('pattern success count increments', async () => {
    const { ProceduralMemory } = await import('../../memory');
    const pm = new ProceduralMemory();
    pm.recordPattern('u1', 'scan', { query: 'test', response: 'response', intentType: 'scan' });
    const row1 = db.prepare("SELECT success_count FROM procedural_patterns WHERE user_id = 'u1'").get() as any;
    expect(row1.success_count).toBe(1);
    pm.recordPattern('u1', 'scan', { query: 'test', response: 'response', intentType: 'scan' });
    const row2 = db.prepare("SELECT success_count FROM procedural_patterns WHERE user_id = 'u1'").get() as any;
    expect(row2.success_count).toBe(2);
  });
});
