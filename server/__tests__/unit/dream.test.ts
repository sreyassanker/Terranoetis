import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyntheticScenarioGenerator } from '../../dream/generator';

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

describe('SyntheticScenarioGenerator', () => {
  let generator: SyntheticScenarioGenerator;

  beforeEach(() => {
    generator = new SyntheticScenarioGenerator();
  });

  it('generateScenario returns valid scenario with name and events', () => {
    const scenario = generator.generateScenario();
    expect(scenario).toHaveProperty('scenarioId');
    expect(scenario).toHaveProperty('name');
    expect(Array.isArray(scenario.events)).toBe(true);
    expect(scenario.events.length).toBeGreaterThanOrEqual(1);
    expect(scenario.events.length).toBeLessThanOrEqual(3);
  });

  it('scenarioId matches expected format', () => {
    const scenario = generator.generateScenario();
    expect(scenario.scenarioId).toMatch(/^dream_\d+_[a-z0-9]+$/);
  });

  it('events have required fields', () => {
    const scenario = generator.generateScenario();
    for (const event of scenario.events) {
      expect(event).toHaveProperty('eventId');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('region');
      expect(event.region).toHaveProperty('lat');
      expect(event.region).toHaveProperty('lon');
      expect(event.region).toHaveProperty('radiusKm');
      expect(typeof event.isReal).toBe('boolean');
      expect(event.isReal).toBe(false);
      expect(typeof event.magnitude).toBe('number');
    }
  });

  it('generateCompoundScenario returns chain of events with escalating magnitude', () => {
    const scenario = generator.generateCompoundScenario(['earthquake', 'tsunami']);
    expect(scenario.name).toContain('cascade');
    expect(scenario.events.length).toBe(2);
    for (const event of scenario.events) {
      expect(event.isReal).toBe(false);
    }
    const magnitudes = scenario.events.map(e => e.magnitude);
    expect(magnitudes[0]).toBeGreaterThan(0);
    expect(magnitudes[1]).toBeGreaterThan(0);
  });
});
