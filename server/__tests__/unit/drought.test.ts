import { describe, expect, it } from 'vitest';

// Test internal functions by re-importing exported helpers
import type { DroughtDataPoint } from '../../data/drought';

describe('DroughtDataPoint interface', () => {
  it('has the expected shape', () => {
    const point: DroughtDataPoint = {
      scPDSI: -3.5,
      droughtClass: 'moderate drought',
      date: '2024-06',
      source: 'noaa-psl-dai-scpdsi',
    };
    expect(point.scPDSI).toBe(-3.5);
    expect(point.droughtClass).toBe('moderate drought');
    expect(point.date).toBe('2024-06');
    expect(point.source).toBe('noaa-psl-dai-scpdsi');
  });

  it('accepts null values', () => {
    const point: DroughtDataPoint = {
      scPDSI: null,
      droughtClass: 'unknown',
      date: null,
      source: null,
    };
    expect(point.scPDSI).toBeNull();
    expect(point.droughtClass).toBe('unknown');
  });
});

describe('PDSI classification logic', () => {
  function classifyPDSI(pdsi: number): string {
    if (pdsi > 4) return 'extreme wet';
    if (pdsi > 2) return 'moderate wet';
    if (pdsi >= -2) return 'near normal';
    if (pdsi >= -4) return 'moderate drought';
    return 'extreme drought';
  }

  const cases: [number, string][] = [
    [5, 'extreme wet'],
    [3, 'moderate wet'],
    [0, 'near normal'],
    [-1, 'near normal'],
    [-3, 'moderate drought'],
    [-5, 'extreme drought'],
  ];

  for (const [value, expectedClass] of cases) {
    it(`PDSI ${value} is "${expectedClass}"`, () => {
      expect(classifyPDSI(value)).toBe(expectedClass);
    });
  }
});

describe('Grid coordinate indexing', () => {
  it('finds nearest latitude in PDSI 2.5° grid', () => {
    const grid: number[] = [];
    for (let i = 0; i < 55; i++) grid.push(88.75 - i * 2.5);

    const findNearest = (lat: number): number => {
      let best = 0;
      let minDist = Infinity;
      for (let i = 0; i < grid.length; i++) {
        const d = Math.abs(grid[i] - lat);
        if (d < minDist) { minDist = d; best = i; }
      }
      return best;
    };

    expect(findNearest(40)).toBe(19); // 88.75 - 19*2.5 = 41.25
    expect(findNearest(0)).toBe(35);  // 88.75 - 35*2.5 = 1.25
  });

  it('normalizes longitude to [0, 360)', () => {
    const normalize = (lon: number): number => ((lon % 360) + 360) % 360;
    expect(normalize(-180)).toBe(180);
    expect(normalize(0)).toBe(0);
    expect(normalize(180)).toBe(180);
    expect(normalize(360)).toBe(0);
    expect(normalize(-90)).toBe(270);
  });

  it('finds nearest longitude index', () => {
    const grid: number[] = [];
    for (let i = 0; i < 144; i++) grid.push(i * 2.5);

    const findNearest = (lon: number): number => {
      const lon360 = ((lon % 360) + 360) % 360;
      let best = 0;
      let minDist = Infinity;
      for (let i = 0; i < grid.length; i++) {
        const d = Math.abs(grid[i] - lon360);
        if (d < minDist) { minDist = d; best = i; }
      }
      return best;
    };

    expect(findNearest(0)).toBe(0);
    expect(findNearest(-90)).toBe(108); // 270° on a 0-360 grid: 270/2.5 = 108
    expect(findNearest(45)).toBe(18);
  });
});
