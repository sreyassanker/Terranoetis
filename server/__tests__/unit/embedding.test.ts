import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockGenerateEmbedding = vi.fn();

vi.mock('../../ai-router/omninet', () => ({
  omninet: {
    generateEmbedding: mockGenerateEmbedding,
  },
}));

let EmbeddingEngine: any;
let cosineSimilarity: (a: Float32Array, b: Float32Array) => number;

beforeAll(async () => {
  const mod = await import('../../embedding');
  EmbeddingEngine = mod.EmbeddingEngine;
  cosineSimilarity = mod.cosineSimilarity;
});

describe('EmbeddingEngine', () => {
  let engine: any;

  beforeEach(() => {
    mockGenerateEmbedding.mockReset();
    mockGenerateEmbedding.mockImplementation(async (text: string) => {
      return new Float32Array(768).map((_, i) => Math.cos(i * 0.1 + text.length));
    });
    engine = new EmbeddingEngine('test-key');
  });

  it('embed() returns Float32Array length 768', async () => {
    const result = await engine.embed('test');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
  });

  it('embedBatch() returns array', async () => {
    const results = await engine.embedBatch(['a', 'b']);
    expect(results).toHaveLength(2);
  });

  it('caches embeddings (second call returns cached value)', async () => {
    const e1 = await engine.embed('sometext');
    expect(e1).toBeInstanceOf(Float32Array);
    const e2 = await engine.embed('sometext');
    expect(e2).toBeTruthy();
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('second call is faster than first (cache hit)', async () => {
    await engine.embed('cachetest');
    const start = Date.now();
    await engine.embed('cachetest');
    expect(Date.now() - start).toBeLessThan(10);
  });
});

describe('cosineSimilarity', () => {
  it('identical vectors → 1.0', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1.0);
  });

  it('orthogonal vectors → 0.0', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0.0);
  });

  it('opposite vectors → -1.0', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1.0);
  });

  it('zero vector → 0', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBe(0);
  });
});

describe('maxConcurrent', () => {
  it('limits concurrent calls to 5', async () => {
    mockGenerateEmbedding.mockReset();
    let active = 0;
    let maxObserved = 0;
    mockGenerateEmbedding.mockImplementation(async () => {
      active++;
      maxObserved = Math.max(maxObserved, active);
      await new Promise(r => setTimeout(r, 50));
      active--;
      return new Float32Array(768);
    });
    const eng = new EmbeddingEngine('test-key', 5);
    await Promise.all(Array.from({ length: 10 }, (_, i) => eng.embed(`q${i}`)));
    expect(maxObserved).toBeLessThanOrEqual(5);
  });
});
