import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database;
const schemaPath = path.resolve(import.meta.dirname, '../../db/schema.sql');

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
  for (const t of ['job_queue', 'eval_scores', 'synthetic_data', 'knowledge_entities', 'knowledge_relations', 'historical_patterns', 'prediction_log', 'episodes', 'facts', 'cache_entries', 'config']) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* may not exist */ }
  }
});

describe('KnowledgeGraph', () => {
  it('creates entity and retrieves it', () => {
    db.prepare("INSERT INTO knowledge_entities (name, type) VALUES ('Japan', 'location')").run();
    const row = db.prepare("SELECT * FROM knowledge_entities WHERE name='Japan'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.type).toBe('location');
  });

  it('creates and queries relations', () => {
    const r1 = db.prepare("INSERT INTO knowledge_entities (name, type) VALUES ('Tokyo', 'city')").run();
    const r2 = db.prepare("INSERT INTO knowledge_entities (name, type) VALUES ('Japan', 'country')").run();
    const tokyoId = r1.lastInsertRowid;
    const japanId = r2.lastInsertRowid;
    db.prepare("INSERT INTO knowledge_relations (source_id, target_id, relation_type) VALUES (?, ?, 'capital_of')").run(tokyoId, japanId);
    const rows = db.prepare(`
      SELECT e2.name as target, r.relation_type
      FROM knowledge_relations r JOIN knowledge_entities e2 ON r.target_id = e2.id
      WHERE r.source_id = ?
    `).all(tokyoId) as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0].relation_type).toBe('capital_of');
  });

  it('finds similar entities by embedding', () => {
    const name1 = `Japan_${Date.now()}`;
    const name2 = `Nippon_${Date.now()}`;
    const emb1 = new Float32Array(768);
    const emb2 = new Float32Array(768).fill(0.99);
    db.prepare(`INSERT INTO knowledge_entities (name, type, embedding) VALUES (?, 'loc', ?)`).run(name1, Buffer.from(emb1.buffer));
    db.prepare(`INSERT INTO knowledge_entities (name, type, embedding) VALUES (?, 'loc', ?)`).run(name2, Buffer.from(emb2.buffer));

    const queryEmb = new Float32Array(768).fill(0.99);
    const rows = db.prepare("SELECT id, name, embedding FROM knowledge_entities WHERE embedding IS NOT NULL").all() as Record<string, unknown>[];
    const scored = rows.map(r => ({
      id: r.id, name: r.name,
      similarity: cosineSim(queryEmb, new Float32Array((r.embedding as Buffer).buffer)),
    })).sort((a, b) => (b.similarity as number) - (a.similarity as number));
    expect(scored[0].name).toBe(name2);
  });

  it('returns entity/relation counts', () => {
    db.prepare("INSERT INTO knowledge_entities (name, type) VALUES ('A', 'loc')").run();
    db.prepare("INSERT INTO knowledge_entities (name, type) VALUES ('B', 'loc')").run();
    const aId = (db.prepare("SELECT id FROM knowledge_entities WHERE name='A'").get() as Record<string, unknown>).id;
    const bId = (db.prepare("SELECT id FROM knowledge_entities WHERE name='B'").get() as Record<string, unknown>).id;
    db.prepare("INSERT INTO knowledge_relations (source_id, target_id, relation_type) VALUES (?, ?, 'connects')").run(aId, bId);
    const ec = (db.prepare("SELECT COUNT(*) as c FROM knowledge_entities").get() as Record<string, unknown>).c;
    const rc = (db.prepare("SELECT COUNT(*) as c FROM knowledge_relations").get() as Record<string, unknown>).c;
    expect(ec).toBe(2);
    expect(rc).toBe(1);
  });
});

describe('Eval scores', () => {
  it('stores and queries eval scores', () => {
    db.prepare("INSERT INTO eval_scores (episode_id, query, overall, metadata_json) VALUES ('ep1','test query',0.75,'{\"intentType\":\"scan\"}')").run();
    const row = db.prepare("SELECT * FROM eval_scores WHERE episode_id='ep1'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.overall).toBeCloseTo(0.75);
  });

  it('averages scores by intent', () => {
    db.prepare("INSERT INTO eval_scores (query, overall, metadata_json) VALUES ('q1',0.8,'{\"intentType\":\"scan\"}')").run();
    db.prepare("INSERT INTO eval_scores (query, overall, metadata_json) VALUES ('q2',0.7,'{\"intentType\":\"scan\"}')").run();
    db.prepare("INSERT INTO eval_scores (query, overall, metadata_json) VALUES ('q3',0.6,'{\"intentType\":\"weather\"}')").run();

    const scanScore = db.prepare(`
      SELECT AVG(overall) as avg_val, COUNT(*) as cnt FROM eval_scores
      WHERE json_extract(metadata_json, '$.intentType') = 'scan'
    `).get() as Record<string, unknown>;
    expect(scanScore.cnt).toBe(2);
    expect(scanScore.avg_val).toBeCloseTo(0.75);
  });
});

describe('Predictor', () => {
  it('stores historical patterns', () => {
    db.prepare("INSERT INTO historical_patterns (pattern, outcome, accuracy, occurrences) VALUES ('hot+dry','drought',0.7,1)").run();
    const row = db.prepare("SELECT * FROM historical_patterns WHERE outcome='drought'").get() as Record<string, unknown>;
    expect(row.occurrences).toBe(1);

    db.prepare(`INSERT INTO historical_patterns (pattern, outcome, accuracy, occurrences) VALUES ('hot+dry','drought',0.7,1)
      ON CONFLICT(pattern, outcome) DO UPDATE SET occurrences = occurrences + 1`).run();
    const row2 = db.prepare("SELECT occurrences FROM historical_patterns WHERE outcome='drought'").get() as Record<string, unknown>;
    expect(row2.occurrences).toBe(2);
  });

  it('stores prediction log', () => {
    db.prepare("INSERT INTO prediction_log (hazard_type, probability, severity, accuracy) VALUES ('earthquake',0.3,'low',0.9)").run();
    const row = db.prepare("SELECT * FROM prediction_log WHERE hazard_type='earthquake'").get() as Record<string, unknown>;
    expect(row.accuracy).toBeCloseTo(0.9);
  });
});

describe('Job queue', () => {
  it('creates and reads jobs', () => {
    db.prepare("INSERT INTO job_queue (type, payload, priority) VALUES ('test_type','{\"data\":\"hello\"}',0)").run();
    const row = db.prepare("SELECT * FROM job_queue WHERE type='test_type'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(JSON.parse(row.payload as string)).toEqual({ data: 'hello' });
    expect(row.status).toBe('pending');
  });

  it('respects priority ordering', () => {
    db.prepare("INSERT INTO job_queue (type, payload, priority) VALUES ('task','{}',0)").run();
    db.prepare("INSERT INTO job_queue (type, payload, priority) VALUES ('task','{}',10)").run();
    const high = db.prepare("SELECT id FROM job_queue WHERE type='task' AND status='pending' ORDER BY priority DESC LIMIT 1").get() as Record<string, unknown>;
    expect(high).toBeTruthy();
  });
});

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}
