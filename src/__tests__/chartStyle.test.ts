import { describe, it, expect } from 'vitest';
import { mergeSeries, CHART_COLORS } from '../components/chartShared';

// §4.4 Q1-journal chart style + §8 chart tests: mergeSeries produces
// chart-level data with y0,y1,... keys and keeps only finite real values.

describe('mergeSeries — chart-level data (§4.4/§8)', () => {
  it('builds chart-level rows with y0, y1 keys from multiple series', () => {
    const { data, keys } = mergeSeries([
      { label: 'A', points: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
      { label: 'B', points: [{ x: 1, y: 100 }, { x: 2, y: 200 }] },
    ]);
    expect(keys).toEqual(['y0', 'y1']);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ x: 1, y0: 10, y1: 100 });
    expect(data[1]).toEqual({ x: 2, y0: 20, y1: 200 });
  });

  it('preserves genuine zero (0 is not conflated with missing)', () => {
    const { data } = mergeSeries([{ label: 'A', points: [{ x: 1, y: 0 }, { x: 2, y: 5 }] }]);
    expect(data.find(r => r.x === 1)!.y0).toBe(0);
  });

  it('drops non-finite y values instead of emitting NaN', () => {
    const { data } = mergeSeries([{ label: 'A', points: [{ x: 1, y: Number.NaN }, { x: 2, y: 3 }] }]);
    const row = data.find(r => r.x === 2)!;
    expect(Number.isFinite(row.y0)).toBe(true);
    expect(row.y0).toBe(3);
  });

  it('aligns series on the union of x values (sorted)', () => {
    const { data } = mergeSeries([
      { label: 'A', points: [{ x: 3, y: 30 }] },
      { label: 'B', points: [{ x: 1, y: 10 }] },
    ]);
    expect(data.map(r => r.x)).toEqual([1, 3]);
  });

  it('empty input produces no chart data', () => {
    const { data, keys } = mergeSeries([]);
    expect(data).toHaveLength(0);
    expect(keys).toHaveLength(0);
  });
});

describe('Q1-journal Okabe-Ito palette (§4.4)', () => {
  it('uses the exact colour-blind-safe palette', () => {
    expect(CHART_COLORS).toEqual(['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000']);
  });
});
