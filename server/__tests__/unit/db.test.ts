import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(import.meta.dirname, '../../db/schema.sql');

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
});

afterAll(() => {
  db.close();
});

describe('Database initialization', () => {
  it('sets WAL or memory mode', () => {
    const mode = db.pragma('journal_mode', { simple: true });
    expect(['wal', 'memory']).toContain(mode);
  });

  it('has foreign_keys enabled', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('CRUD operations', () => {
  it('users', () => {
    db.prepare("INSERT INTO users (id, name) VALUES ('u1','test')").run();
    expect((db.prepare("SELECT id FROM users WHERE id='u1'").get() as any).id).toBe('u1');
  });

  it('profiles', () => {
    db.prepare("INSERT INTO profiles (user_id) VALUES ('u1')").run();
    expect((db.prepare("SELECT user_id FROM profiles WHERE user_id='u1'").get() as any).user_id).toBe('u1');
  });

  it('episodes', () => {
    db.prepare("INSERT INTO episodes (user_id, episode_id, query, response) VALUES ('u1','ep1','q','r')").run();
    expect((db.prepare("SELECT query FROM episodes WHERE episode_id='ep1'").get() as any).query).toBe('q');
  });

  it('feedback', () => {
    db.prepare("INSERT INTO feedback (feedback_id, user_id, query, response, vote, intent_type, model_tier) VALUES ('f1','u1','q','r','up','scan','flash')").run();
    expect((db.prepare("SELECT vote FROM feedback WHERE feedback_id='f1'").get() as any).vote).toBe('up');
  });

  it('cache_entries', () => {
    db.prepare("INSERT INTO cache_entries (query_hash, query, response_json, expires_at) VALUES ('abc','test','{}',datetime('now','+1 hour'))").run();
    expect((db.prepare("SELECT query FROM cache_entries WHERE query_hash='abc'").get() as any).query).toBe('test');
  });

  it('config', () => {
    db.prepare("INSERT INTO config (key,value) VALUES ('k','v')").run();
    expect((db.prepare("SELECT value FROM config WHERE key='k'").get() as any).value).toBe('v');
  });

  it('facts', () => {
    db.prepare("INSERT INTO facts (user_id, fact_text) VALUES ('u1','fact')").run();
    expect((db.prepare("SELECT fact_text FROM facts WHERE user_id='u1'").get() as any).fact_text).toBe('fact');
  });

  it('audit_logs', () => {
    db.prepare("INSERT INTO audit_logs (user_id, action) VALUES ('u1','act')").run();
    expect((db.prepare("SELECT action FROM audit_logs WHERE user_id='u1'").get() as any).action).toBe('act');
  });

  it('vec_store with embeddings', () => {
    const b = Buffer.from(new Float32Array([0.1, 0.2]).buffer);
    db.prepare("INSERT INTO vec_store (user_id, entity_type, entity_id, content, embedding) VALUES ('u1','t','e1','c',?)").run(b);
    expect((db.prepare("SELECT content FROM vec_store WHERE entity_id='e1'").get() as any).content).toBe('c');
  });

  it('eval_scores', () => {
    db.prepare("INSERT INTO eval_scores (query, relevance, factual_accuracy, helpfulness, conciseness, overall) VALUES ('q',0.8,0.7,0.9,0.6,0.75)").run();
    expect((db.prepare("SELECT overall FROM eval_scores WHERE query='q'").get() as any).overall).toBeCloseTo(0.75);
  });

  it('knowledge_entities', () => {
    db.prepare("INSERT INTO knowledge_entities (name, type) VALUES ('Japan','loc')").run();
    expect((db.prepare("SELECT type FROM knowledge_entities WHERE name='Japan'").get() as any).type).toBe('loc');
  });

  it('historical_patterns', () => {
    db.prepare("INSERT INTO historical_patterns (pattern, outcome, accuracy) VALUES ('p','drought',0.7)").run();
    expect((db.prepare("SELECT accuracy FROM historical_patterns WHERE outcome='drought'").get() as any).accuracy).toBeCloseTo(0.7);
  });

  it('prediction_log', () => {
    db.prepare("INSERT INTO prediction_log (hazard_type, probability, severity, accuracy) VALUES ('eq',0.3,'low',0.8)").run();
    expect((db.prepare("SELECT probability FROM prediction_log WHERE hazard_type='eq'").get() as any).probability).toBeCloseTo(0.3);
  });

  it('synthetic_data', () => {
    db.prepare("INSERT INTO synthetic_data (query, response, intent_type, tags_json) VALUES ('q','r','scan','[]')").run();
    expect((db.prepare("SELECT intent_type FROM synthetic_data WHERE query='q'").get() as any).intent_type).toBe('scan');
  });
});

describe('Transaction rollback', () => {
  it('rolls back on constraint violation', () => {
    db.prepare("INSERT INTO users (id, name) VALUES ('tx1','valid')").run();
    expect(() => db.prepare("INSERT INTO users (id,name) VALUES ('tx1','dup')").run()).toThrow();
    expect((db.prepare("SELECT COUNT(*) as c FROM users WHERE id='tx1'").get() as any).c).toBe(1);
  });
});
