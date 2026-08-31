import { describe, it, expect } from 'vitest';
import { resolveCategoryFilters } from '../../analytical-models/contextEngine';
import { computeEquation } from '../../analytical-models/engine';

// §4.5 / §5.1 — every category filter declared in the frontend must be read
// here and produce a real numeric override, and the override must change the
// engine result. Tests the pure resolveCategoryFilters() mapping + engine effect.

describe('resolveCategoryFilters — every declared filter has a real override (§5.1)', () => {
  const cases: Array<[number, string, string, string, number]> = [
    // [toolId, filterId, selection, expectedKey, expectedValue]
    [10, 'land-cover', 'Forest', 'S', (1000 / 66) - 10],
    [10, 'soil-texture', 'Sand', 'S', (1000 / 72) - 10], // Cropland base (78) − 6 HSG-A
    [18, 'soil-texture', 'Sand', 'Ks', 1.19e-4],
    [21, 'fault-type', 'Reverse', 'rake', 90],
    [21, 'site-class', 'E (<180)', 'vs30', 150],
    [21, 'magnitude-range', '7.0', 'mag', 7],
    [43, 'soil-texture', 'Sand', 'alpha', 0.145],
    [43, 'soil-texture', 'Clay', 'n', 1.09],
    [44, 'soil-texture', 'Sand', 'psib', -7.3],
    [45, 'land-cover', 'Forest', 'C', 0.001],
    [45, 'soil-texture', 'Clay', 'K', 0.3],
    [47, 'soil-texture', 'Sand', 'sandFrac', 0.7],
    [48, 'atmospheric-stability', 'Unstable (A)', 'L', -10],
    [50, 'land-cover', 'Forest', 'a1', 9],
    [51, 'land-cover', 'Forest', 'eps', 1.3],
    [52, 'land-cover', 'Forest', 'k', 0.5],
    [54, 'land-cover', 'Grassland', 'GammaStar', 40],
    [55, 'land-cover', 'Wetland', 'E', 0.1],
    [61, 'crop-type', 'Maize', 'Ky', 1.25],
    [63, 'land-cover', 'Cropland', 'rs', 60],
    [91, 'climate-scenario', 'SSP5-8.5', 'DDF', 0.007],
    [96, 'climate-scenario', 'SSP5-8.5', 'I', 348],
    [97, 'climate-scenario', 'SSP5-8.5', 'dF', 8.5],
    [131, 'soil-texture', 'Sand', 'T', 500],
    [132, 'soil-texture', 'Sand', 'T', 500],
    [134, 'soil-texture', 'Clay', 'f0', 1.5],
    [135, 'event-type', 'Earthquakes only', 'H', 0.8],
    [135, 'risk-threshold', 'Extreme (1-in-5yr)', 'V', 0.8],
    [136, 'return-period', '100', 'P_high', 0.01],
    [138, 'return-period', '1000', 'Kp', 13],
  ];

  for (const [id, key, sel, expKey, expVal] of cases) {
    it(`tool ${id} filter ${key}='${sel}' → ${expKey}=${expVal}`, () => {
      const ov = resolveCategoryFilters(id, { [key]: sel });
      expect(ov[expKey]).toBeCloseTo(expVal, 5);
    });
  }

  it('unlisted filter keys produce no override (declared-only, §5.1)', () => {
    expect(resolveCategoryFilters(2, { elevation: '1000' })).toEqual({});
    expect(resolveCategoryFilters(1, { 'spatial-resolution': '30m' })).toEqual({});
  });

  it('satellite-sensor non-Landsat forces honest NaN bands for spectral tools', () => {
    const ov = resolveCategoryFilters(26, { 'satellite-sensor': 'Sentinel-2 MSI' });
    expect(Number.isNaN(ov.NIR)).toBe(true);
    expect(resolveCategoryFilters(26, { 'satellite-sensor': 'Landsat 8/9 TIRS' }).NIR).toBeUndefined();
  });
});

describe('filter effect on the engine result (§4.5: filter changes result)', () => {
  // Van Genuchten: soil-texture filter drives α/n → θ(ψ) must differ Sand vs Clay.
  it('tool 43 θ(ψ) differs between Sand and Clay soil-texture filters', () => {
    const sand = computeEquation(43, { ...resolveCategoryFilters(43, { 'soil-texture': 'Sand' }), psi: -100, thetaS: 0.43, thetaR: 0.045 });
    const clay = computeEquation(43, { ...resolveCategoryFilters(43, { 'soil-texture': 'Clay' }), psi: -100, thetaS: 0.38, thetaR: 0.068 });
    expect(sand!.result).not.toBeCloseTo(clay!.result, 3);
  });

  it('tool 45 USLE A differs between Forest (C=0.001) and Cropland (C=0.5)', () => {
    const forest = computeEquation(45, { ...resolveCategoryFilters(45, { 'land-cover': 'Forest' }), R: 2000, LS: 5, P: 1, K: 0.3 });
    const crop = computeEquation(45, { ...resolveCategoryFilters(45, { 'land-cover': 'Cropland' }), R: 2000, LS: 5, P: 1, K: 0.3 });
    expect(crop!.result).toBeGreaterThan(forest!.result * 100);
  });

  it('tool 61 FAO yield response differs between Maize (Ky=1.25) and Wheat (Ky=1.0)', () => {
    const maize = computeEquation(61, { ...resolveCategoryFilters(61, { 'crop-type': 'Maize' }), Ya: 8, Ym: 10, ETa: 70, ETm: 100 });
    const wheat = computeEquation(61, { ...resolveCategoryFilters(61, { 'crop-type': 'Wheat' }), Ya: 8, Ym: 10, ETa: 70, ETm: 100 });
    expect(maize!.result).not.toBeCloseTo(wheat!.result, 3);
  });

  it('tool 97 climate sensitivity differs between SSP1-2.6 and SSP5-8.5', () => {
    const low = computeEquation(97, { ...resolveCategoryFilters(97, { 'climate-scenario': 'SSP1-2.6' }), lambda0: 3.2, f: 0 });
    const high = computeEquation(97, { ...resolveCategoryFilters(97, { 'climate-scenario': 'SSP5-8.5' }), lambda0: 3.2, f: 0 });
    expect(high!.result).toBeGreaterThan(low!.result);
  });

  it('tool 40 Gumbel return-period filter changes the quantile result', () => {
    const noF = computeEquation(40, { mu: 100, beta: 20, x: 100 });
    const t100 = computeEquation(40, { mu: 100, beta: 20, x: 100 - 20 * Math.log(-Math.log(1 - 1 / 100)) });
    expect(t100!.result).toBeGreaterThan(noF!.result);
  });

  it('tool 107 pressure-level filter changes the barotropic-vorticity tendency (div scaled)', () => {
    const base = computeEquation(107, { zeta: 1e-4, f: 1e-4, dudx: 1e-5, dvdy: 1e-5, div: 2e-5 });
    const ov = resolveCategoryFilters(107, { 'pressure-level': '200' });
    const filt = computeEquation(107, { zeta: 1e-4, f: 1e-4, dudx: 1e-5, dvdy: 1e-5, ...ov });
    expect(filt!.result).not.toBeCloseTo(base!.result, 12);
    expect(filt!.result).toBeCloseTo(-(1e-4 + 1e-4) * (2e-5 * 2.2), 9);
  });

  it('tool 106 pressure-level filter changes frontogenesis', () => {
    const full = { dtheta: 5, D: 1e-7, cos2b: 0.5, delta: 0.5, dudy: 1e-3 };
    const base = computeEquation(106, full);
    const filt = computeEquation(106, { ...full, ...resolveCategoryFilters(106, { 'pressure-level': '200' }) });
    expect(filt!.result).toBeGreaterThan(base!.result);
  });

  it('tool 132 Theis drawdown differs between Sand (T=500) and Clay (T=10)', () => {
    const sand = computeEquation(132, { ...resolveCategoryFilters(132, { 'soil-texture': 'Sand' }), Q: 1000, t: 1, r: 100, S: 0.0005 });
    const clay = computeEquation(132, { ...resolveCategoryFilters(132, { 'soil-texture': 'Clay' }), Q: 1000, t: 1, r: 100, S: 0.0005 });
    expect(clay!.result).toBeGreaterThan(sand!.result);
  });

  it('tool 135 UNISDR risk differs between hazard event types', () => {
    const all = computeEquation(135, { ...resolveCategoryFilters(135, { 'event-type': 'All events' }), V: 0.4, E: 0.6 });
    const eq = computeEquation(135, { ...resolveCategoryFilters(135, { 'event-type': 'Earthquakes only' }), V: 0.4, E: 0.6 });
    expect(eq!.result).toBeGreaterThan(all!.result);
  });
});
