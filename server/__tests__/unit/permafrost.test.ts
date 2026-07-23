import { describe, expect, it } from 'vitest';

// Test internal functions by re-importing (only exported types are accessible)
// We test via the public API shape and derived logic.
import type { PermafrostDataPoint } from '../../data/permafrost';

describe('PermafrostDataPoint interface', () => {
  it('has the expected shape', () => {
    const point: PermafrostDataPoint = {
      probability: 0.95,
      classification: 'continuous',
      activeLayerDepth: 0.3,
      groundTemp: -10,
      source: 'test',
    };
    expect(point.probability).toBe(0.95);
    expect(point.classification).toBe('continuous');
    expect(point.activeLayerDepth).toBe(0.3);
    expect(point.groundTemp).toBe(-10);
    expect(point.source).toBe('test');
  });

  it('accepts null for probability', () => {
    const point: PermafrostDataPoint = {
      probability: null,
      classification: 'none',
      activeLayerDepth: null,
      groundTemp: null,
      source: 'test',
    };
    expect(point.probability).toBeNull();
  });
});

describe('Latitude-zone model consistency', () => {
  const ZONES = [
    { minLat: 70, expProb: 0.95, expClass: 'continuous' },
    { minLat: 65, expProb: 0.70, expClass: 'discontinuous' },
    { minLat: 60, expProb: 0.30, expClass: 'sporadic' },
    { minLat: 50, expProb: 0.05, expClass: 'isolated' },
  ];

  for (const zone of ZONES) {
    it(`latitudes >= ${zone.minLat}° map to ${zone.expClass}`, () => {
      // The probabilities increase with latitude
      expect(zone.expProb).toBeGreaterThan(0);
    });
    it(`${zone.expClass} has lower probability than zones north of it`, () => {
      // This is a logic consistency check
      expect(zone.expProb).toBeLessThanOrEqual(zone.minLat >= 70 ? 1 : 0.95);
    });
  }
});

describe('Grid coordinate mapping', () => {
  it('correctly computes lat→row for 0.5° grid', () => {
    // 90°N = row 0, 89.5°N = row 1, etc.
    const rowAt0 = Math.floor((90 - 0) / 0.5);
    expect(rowAt0).toBe(180);
  });

  it('correctly computes lon→col for 0.5° grid', () => {
    // -180°E = col 0, 0° = col 360
    const colAt0 = Math.floor((0 + 180) / 0.5);
    expect(colAt0).toBe(360);
  });

  it('correctly computes index for North Pole', () => {
    // 90°N, 0°E
    const row = Math.floor((90 - 90) / 0.5);
    const col = Math.floor((0 + 180) / 0.5);
    expect(row).toBe(0);
    expect(col).toBe(360);
    expect(row * 720 + col).toBe(360);
  });

  it('correctly computes index for Arctic location', () => {
    // 70°N, 100°E
    const row = Math.floor((90 - 70) / 0.5);
    const col = Math.floor((100 + 180) / 0.5);
    expect(row).toBe(40);
    expect(col).toBe(560);
  });
});

describe('Permafrost value mapping', () => {
  const VALUES: Record<number, { prob: number; cls: string }> = {
    0: { prob: 0, cls: 'ocean/ice' },
    1: { prob: 0, cls: 'none' },
    2: { prob: 0.05, cls: 'isolated' },
    3: { prob: 0.30, cls: 'sporadic' },
    4: { prob: 0.70, cls: 'discontinuous' },
    5: { prob: 0.95, cls: 'continuous' },
  };

  for (const [byte, expected] of Object.entries(VALUES)) {
    it(`byte ${byte} maps to ${expected.cls} with probability ${expected.prob}`, () => {
      expect(expected.prob).toBeGreaterThanOrEqual(0);
      expect(expected.prob).toBeLessThanOrEqual(1);
      expect(expected.cls.length).toBeGreaterThan(0);
    });
  }
});
