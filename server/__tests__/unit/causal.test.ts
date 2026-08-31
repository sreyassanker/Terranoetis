import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CausalKnowledgeGraph } from '../../causal/kg';
import { EntropyMixer } from '../../causal/entropyMixer';

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: () => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    }),
  }),
}));

vi.mock('../../pubsub', () => ({
  pubsub: {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe('CausalKnowledgeGraph', () => {
  let kg: CausalKnowledgeGraph;

  beforeEach(() => {
    kg = new CausalKnowledgeGraph();
  });

  it('upsertNode does not throw', () => {
    expect(() => kg.upsertNode({
      nodeId: 'test-node',
      name: 'Test Node',
      type: 'seismic',
      lat: 35.7,
      lon: 139.7,
      properties: { magnitude: 7.5 },
      createdAt: Date.now(),
    })).not.toThrow();
  });

  it('upsertEdge does not throw', () => {
    expect(() => kg.upsertEdge({
      edgeId: 'test-edge',
      sourceId: 'Source',
      targetId: 'Target',
      relation: 'CAUSES',
      correlation: 0.8,
      causalStrength: 0.75,
      timeLagHours: 12,
      confidence: 0.9,
      evidenceCount: 5,
      lastUpdated: Date.now(),
      isSynthetic: true,
    })).not.toThrow();
  });

  it('findCausalPath returns null for disconnected nodes', () => {
    const path = kg.findCausalPath('A', 'B', 0.5);
    expect(path).toBeNull();
  });
});

describe('EntropyMixer', () => {
  let mixer: EntropyMixer;

  beforeEach(() => {
    mixer = new EntropyMixer();
  });

  afterEach(() => {
    mixer.stop();
  });

  it('initializes and starts without throwing', () => {
    expect(() => mixer.start()).not.toThrow();
  });

  it('interpretEntropy returns correct levels', () => {
    expect((mixer as unknown as { interpretEntropy: (v: number) => string }).interpretEntropy(0.1)).toBe('baseline');
    expect((mixer as unknown as { interpretEntropy: (v: number) => string }).interpretEntropy(0.4)).toBe('restless');
    expect((mixer as unknown as { interpretEntropy: (v: number) => string }).interpretEntropy(0.7)).toBe('critical');
    expect((mixer as unknown as { interpretEntropy: (v: number) => string }).interpretEntropy(0.95)).toBe('catastrophic');
  });
});
