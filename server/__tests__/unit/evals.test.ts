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
  db.exec("DELETE FROM eval_scores");
});

describe('evaluateResponse', () => {
  it('returns scores 0-1 for all dimensions', async () => {
    const { evaluateResponse } = await import('../../ml/evals');
    // Without API key, should return default mid-range scores
    const scores = await evaluateResponse('test query', 'test response', { intentType: 'scan' }, '');
    expect(scores.relevance).toBeGreaterThanOrEqual(0);
    expect(scores.relevance).toBeLessThanOrEqual(1);
    expect(scores.factualAccuracy).toBeGreaterThanOrEqual(0);
    expect(scores.factualAccuracy).toBeLessThanOrEqual(1);
    expect(scores.helpfulness).toBeGreaterThanOrEqual(0);
    expect(scores.helpfulness).toBeLessThanOrEqual(1);
    expect(scores.conciseness).toBeGreaterThanOrEqual(0);
    expect(scores.conciseness).toBeLessThanOrEqual(1);
    expect(scores.overall).toBeGreaterThanOrEqual(0);
    expect(scores.overall).toBeLessThanOrEqual(1);
  });

  it('stores result in eval_scores table', async () => {
    const { storeEval } = await import('../../ml/evals');
    storeEval('ep1', 'test query', {
      relevance: 0.8, factualAccuracy: 0.7, helpfulness: 0.9, conciseness: 0.6, overall: 0.75,
    }, { intentType: 'scan' });
    const row = db.prepare("SELECT * FROM eval_scores WHERE episode_id = 'ep1'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.overall).toBeCloseTo(0.75);
  });
});

describe('getAvgScoresByIntent', () => {
  it('returns average scores grouped by intent', async () => {
    const { storeEval, getAvgScoresByIntent } = await import('../../ml/evals');
    storeEval('e1', 'q1', { relevance: 0.8, factualAccuracy: 0.7, helpfulness: 0.9, conciseness: 0.6, overall: 0.75 }, { intentType: 'scan' });
    storeEval('e2', 'q2', { relevance: 0.9, factualAccuracy: 0.8, helpfulness: 0.85, conciseness: 0.7, overall: 0.81 }, { intentType: 'scan' });
    storeEval('e3', 'q3', { relevance: 0.6, factualAccuracy: 0.7, helpfulness: 0.5, conciseness: 0.6, overall: 0.6 }, { intentType: 'weather' });
    const byIntent = getAvgScoresByIntent();
    expect(byIntent['scan']).toBeTruthy();
    expect(byIntent['scan'].count).toBe(2);
    expect(byIntent['scan'].avgOverall).toBeCloseTo(0.78, 1);
  });
});
