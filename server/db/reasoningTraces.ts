import type Database from 'better-sqlite3';
import { logger } from '../observability/logger';

const REQUIRED_COLUMNS = [
  { name: 'trace_id', definition: 'TEXT' },
  { name: 'interaction_id', definition: 'TEXT' },
  { name: 'user_id', definition: 'TEXT' },
  { name: 'query', definition: 'TEXT' },
  { name: 'response', definition: 'TEXT' },
  { name: 'system_used', definition: "TEXT NOT NULL DEFAULT 'system2'" },
  { name: 'trace_json', definition: 'TEXT' },
  { name: 'steps_json', definition: 'TEXT' },
  { name: 'duration_ms', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'total_duration_ms', definition: 'INTEGER' },
  { name: 'final_confidence', definition: 'REAL' },
  { name: 'confidence', definition: 'REAL' },
  { name: 'critic_score', definition: 'REAL' },
  { name: 'iteration_count', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { name: 'needs_review', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'model_used', definition: 'TEXT' },
  { name: 'intent_type', definition: 'TEXT' },
  { name: 'created_at', definition: "TEXT NOT NULL DEFAULT ''" },
];

const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_reasoning_trace_id ON reasoning_traces(trace_id) WHERE trace_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_reasoning_interaction_id ON reasoning_traces(interaction_id) WHERE interaction_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_reasoning_user ON reasoning_traces(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_reasoning_created ON reasoning_traces(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_reasoning_intent ON reasoning_traces(intent_type)',
  'CREATE INDEX IF NOT EXISTS idx_reasoning_query ON reasoning_traces(query)',
  'CREATE INDEX IF NOT EXISTS idx_reasoning_review ON reasoning_traces(needs_review)',
];

export function ensureReasoningTracesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasoning_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT,
      interaction_id TEXT,
      user_id TEXT,
      query TEXT,
      response TEXT,
      system_used TEXT NOT NULL DEFAULT 'system2',
      trace_json TEXT,
      steps_json TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER,
      final_confidence REAL,
      confidence REAL,
      critic_score REAL,
      iteration_count INTEGER NOT NULL DEFAULT 1,
      needs_review INTEGER NOT NULL DEFAULT 0,
      model_used TEXT,
      intent_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(reasoning_traces)').all() as { name: string }[])
      .map(col => col.name),
  );

  for (const col of REQUIRED_COLUMNS) {
    if (!existingColumns.has(col.name)) {
      db.exec(`ALTER TABLE reasoning_traces ADD COLUMN ${col.name} ${col.definition}`);
    }
  }

  try {
    db.exec(`
      UPDATE reasoning_traces
      SET interaction_id = trace_id
      WHERE (interaction_id IS NULL OR interaction_id = '') AND trace_id IS NOT NULL
    `);
    db.exec(`
      UPDATE reasoning_traces
      SET steps_json = trace_json
      WHERE (steps_json IS NULL OR steps_json = '') AND trace_json IS NOT NULL
    `);
    db.exec(`
      UPDATE reasoning_traces
      SET total_duration_ms = duration_ms
      WHERE total_duration_ms IS NULL AND duration_ms IS NOT NULL
    `);
    db.exec(`
      UPDATE reasoning_traces
      SET confidence = COALESCE(final_confidence, critic_score, 0)
      WHERE confidence IS NULL
    `);
  } catch (e) {
    logger.warn({ err: e }, 'Reasoning traces backfill failed (best-effort)');
  }

  for (const sql of INDEXES) {
    try {
      db.exec(sql);
    } catch (e) {
      logger.warn({ err: e }, 'Reasoning traces index creation failed');
    }
  }
}
