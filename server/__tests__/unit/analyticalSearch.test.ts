import { describe, it, expect } from 'vitest';
import { searchAnalyticalModels } from '../../analytical-models/index';

// Natural-language search over the 150 analytical equation engines.
// Verifies that free-form queries resolve to the correct real equations
// (name match, token overlap, and scientific-metadata matching).

describe('searchAnalyticalModels', () => {
  it('empty query returns all 150 tools', () => {
    const res = searchAnalyticalModels('');
    expect(res.count).toBe(150);
    expect(res.total).toBe(150);
  });

  it('exact name match ranks first for "land surface temperature"', () => {
    const res = searchAnalyticalModels('land surface temperature');
    expect(res.results[0].id).toBe(1);
    expect(res.results[0].name).toBe('Land Surface Temperature');
    expect(res.results[0].match).toBe('exact name');
  });

  it('natural phrase "100 year flood return level" surfaces the Gumbel EV analysis', () => {
    const res = searchAnalyticalModels('100 year flood return level');
    const ids = res.results.map(r => r.id);
    // Tool 40 (Gumbel) matches via metadata terms (year, return) — it must be
    // present in the ranked results for the flood-return demo.
    expect(ids).toContain(40);
  });

  it('"how fast does the wind blow" resolves to wind equations', () => {
    const res = searchAnalyticalModels('how fast does the wind blow');
    const ids = res.results.map(r => r.id);
    // Geostrophic wind (5), wind-driven current (15), log wind profile (49).
    expect(ids).toContain(5);
  });

  it('"carbon dioxide uptake ocean" resolves to Ocean CO2 Uptake (56)', () => {
    const res = searchAnalyticalModels('carbon dioxide uptake ocean');
    const top = res.results[0];
    expect(top.id).toBe(56);
  });

  it('"volcanic eruption" resolves to VEI volume relationship (94) via description', () => {
    const res = searchAnalyticalModels('volcanic eruption');
    expect(res.results[0].id).toBe(94);
  });

  it('respects the limit parameter', () => {
    const res = searchAnalyticalModels('temperature', 5);
    expect(res.results.length).toBeLessThanOrEqual(5);
  });

  it('every returned id is a real implemented engine', () => {
    const res = searchAnalyticalModels('snow melt');
    for (const r of res.results) {
      expect(r.id).toBeGreaterThanOrEqual(1);
      expect(r.id).toBeLessThanOrEqual(150);
      expect(typeof r.name).toBe('string');
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it('no-query empty results are stable and sorted by id', () => {
    const res = searchAnalyticalModels('');
    expect(res.results[0].id).toBe(1);
    expect(res.results[149].id).toBe(150);
  });
});
