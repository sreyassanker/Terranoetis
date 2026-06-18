import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let testDb: Database.Database | null = null;
const TABLES = [
  'users', 'profiles', 'episodes', 'monitor_rules', 'scheduled_tasks',
  'feedback', 'cache_entries', 'chats', 'config', 'facts',
  'audit_logs', 'vec_store', 'procedural_patterns', 'eval_scores',
  'synthetic_data', 'knowledge_entities', 'knowledge_relations',
  'historical_patterns', 'prediction_log', 'job_queue',
];

export function createTestDb(): Database.Database {
  if (testDb) return testDb;

  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('busy_timeout = 5000');
  testDb.pragma('foreign_keys = ON');

  const schemaPath = path.resolve(import.meta.dirname, '../../db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  testDb.exec(schema);

  return testDb;
}

export function getTestDb(): Database.Database {
  if (!testDb) throw new Error('Test DB not initialized. Call createTestDb() first.');
  return testDb;
}

export function resetTestDb(): void {
  if (!testDb) return;
  for (const table of TABLES) {
    try {
      testDb.exec(`DELETE FROM ${table}`);
    } catch {
      // table may not exist
    }
  }
}

export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

export function getTestDbPath(): string {
  return ':memory:';
}
