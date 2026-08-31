import { describe, it, expect, vi, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database;
const schemaPath = path.resolve(import.meta.dirname, '../../db/schema.sql');

vi.mock('../../db/index', () => ({
  getDb: () => db,
  closeDb: () => {},
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function setGeminiResponse(text: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  });
}

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  setGeminiResponse(JSON.stringify({ nodes: [], synthesisPrompt: '' }));
});

describe('Orchestrator: end-to-end flow', () => {
  it('simple query flows through orchestrate', async () => {
    const { AgentOrchestrator } = await import('../../orchestrator');
    const orchestrator = new AgentOrchestrator('test-api-key');
    setGeminiResponse(JSON.stringify({ nodes: [], synthesisPrompt: '' }));
    const result = await orchestrator.orchestrate('Tokyo earthquake risk');
    expect(result).toBeTruthy();
    expect(typeof result.output).toBe('string');
  });

  it('query with plan results', async () => {
    const { AgentOrchestrator } = await import('../../orchestrator');
    const orchestrator = new AgentOrchestrator('test-api-key');
    setGeminiResponse(JSON.stringify({
      nodes: [
        { id: 'n1', role: 'analyst', prompt: 'analyze seismic data', dependencies: [] },
      ],
      synthesisPrompt: 'Combine results',
    }));
    // Need a second mock response for the executeDag → geminiText call
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ findings: ['seismic activity detected'], summary: 'Analysis' }) }] } }],
      }),
    });
    const result = await orchestrator.orchestrate('seismic activity near Tokyo');
    expect(result).toBeTruthy();
    expect(typeof result.output).toBe('string');
  });

  it('circuit breaker opens after repeated failures', async () => {
    const { CircuitBreaker } = await import('../../resilience');
    const cb = new CircuitBreaker(3, 60000, 60000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail');
    }
    expect(cb.getState()).toBe('OPEN');
  });
});
