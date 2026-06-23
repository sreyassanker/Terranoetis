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
});

beforeEach(() => {
  db.exec("DELETE FROM historical_patterns; DELETE FROM prediction_log");
});

describe('Predictor', () => {
  it('storePattern and recordOutcome without predict call', async () => {
    const { Predictor } = await import('../../ml/predictor');
    const predictor = new Predictor();
    predictor.storePattern('high_temp+low_rain', 'drought', 0.5);
    const row1 = db.prepare("SELECT * FROM historical_patterns WHERE outcome = 'drought'").get() as Record<string, unknown>;
    expect(row1.occurrences).toBe(1);

    predictor.recordOutcome(
      { hazardType: 'drought', probability: 0.6, severity: 'medium', timeframe: '7d', confidence: 0.5, contributingFactors: ['test'] },
      true, true,
    );
    const row2 = db.prepare("SELECT * FROM historical_patterns WHERE outcome = 'drought'").get() as Record<string, unknown>;
    expect(row2.occurrences).toBe(2);

    const rows = db.prepare("SELECT * FROM prediction_log WHERE hazard_type = 'drought' ORDER BY id DESC").all() as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].accuracy).toBe(0.9);
  });

  it('toPrediction maps correctly', async () => {
    const { Predictor } = await import('../../ml/predictor');
    const predictor = new Predictor();
    const data = [
      { hazardType: 'fire', probability: 0.5, severity: 'medium' as const, timeframe: '24h', confidence: 0.7, contributingFactors: [], source: 'physics' as const, confidenceInterval: [0, 0] as [number, number] },
    ];
    const result = (predictor as unknown as { toPrediction: (data: unknown[]) => Record<string, unknown>[] }).toPrediction(data);
    expect(result).toHaveLength(1);
    expect(result[0].hazardType).toBe('fire');
    expect(result[0].probability).toBe(0.5);
  });
});
