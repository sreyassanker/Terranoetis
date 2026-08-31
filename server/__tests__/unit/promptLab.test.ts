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
  db.exec("DELETE FROM config WHERE key LIKE 'prompt_variant:%'");
});

describe('PromptLab', () => {
  it('stores template and tracks metrics', async () => {
    const { PromptLab } = await import('../../ml/promptLab');
    const lab = new PromptLab();
    lab.init();
    const variants = lab.getVariants('quick_scan');
    expect(variants.length).toBeGreaterThan(0);
    expect(variants[0].template).toContain('{location}');
    expect(variants[0].metrics.usageCount).toBe(0);
  });

  it('traffic split: 80/20 distribution over calls', async () => {
    const { PromptLab } = await import('../../ml/promptLab');
    const lab = new PromptLab();
    lab.init();
    const counts: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      const v = lab.selectVariant('quick_scan');
      counts[v.id] = (counts[v.id] || 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('promotion: records results and updates metrics', async () => {
    const { PromptLab } = await import('../../ml/promptLab');
    const lab = new PromptLab();
    lab.init();
    const variant = lab.selectVariant('quick_scan');
    lab.recordResult('quick_scan', variant.id, 0.9);
    const variants = lab.getVariants('quick_scan');
    const updated = variants.find((v: any) => v.id === variant.id) as any;
    expect((updated.metrics as Record<string, unknown>).usageCount).toBe(1);
    expect((updated.metrics as Record<string, unknown>).avgScore).toBeCloseTo(0.9);
  });

  it('fillTemplate replaces variables', async () => {
    const { PromptLab } = await import('../../ml/promptLab');
    const lab = new PromptLab();
    const result = lab.fillTemplate('Hello {name}, weather in {location}', { name: 'Test', location: 'Tokyo' });
    expect(result).toBe('Hello Test, weather in Tokyo');
  });
});
