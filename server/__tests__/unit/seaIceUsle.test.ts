import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 35 — Sea Ice Concentration (Comiso 1986) ────────────────────
// T_B = (1−C)·T_water + C·T_ice. Worked example: C=0.5, T_water=0, T_ice=−5
// → T_B = 0.5·0 + 0.5·(−5) = −2.5 °C.

describe('Tool 35 — Sea Ice Concentration', () => {
  it('worked example: C=0.5, T_water=0, T_ice=−5 → T_B=−2.5 °C', () => {
    const res = computeEquation(35, { C: 0.5, Twater: 0, Tice: -5 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(-2.5, 6);
    expect(res!.unit).toBe('°C');
  });

  it('100% ice → T_B = T_ice; 0% ice → T_B = T_water', () => {
    expect(computeEquation(35, { C: 1, Twater: 0, Tice: -5 })!.result).toBeCloseTo(-5, 6);
    expect(computeEquation(35, { C: 0, Twater: 0, Tice: -5 })!.result).toBeCloseTo(0, 6);
  });

  it('exposes brightness_kelvin as secondary', () => {
    const sec = computeEquation(35, { C: 0.5, Twater: 0, Tice: -5 })!.secondary ?? [];
    const k = sec.find((s) => s.key === 'brightness_kelvin');
    expect(k?.value).toBeCloseTo(-2.5 + 273.15, 6);
    expect(k?.unit).toBe('K');
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(35, { C: '0.5', Twater: '0', Tice: '-5' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(-2.5, 6);
  });

  it('returns honest NaN when ice concentration is missing', () => {
    const res = computeEquation(35, { C: Number.NaN, Twater: Number.NaN, Tice: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param aliases: T_water→Twater, T_ice→Tice via normalizeInputs', () => {
    const normalized = normalizeInputs(35, { T_water: 0, T_ice: -5 } as unknown as Record<string, number>);
    expect(normalized['Twater']).toBe(0);
    expect(normalized['Tice']).toBe(-5);
  });
});

// ── Tool 45 — USLE/RUSLE (Wischmeier & Smith 1978) ───────────────────
// A = R × K × LS × C × P. Worked example: R=2000, K=0.3, LS=5, C=0.5, P=1
// → A = 2000·0.3·5·0.5·1 = 1500 t/ha/yr.

describe('Tool 45 — USLE/RUSLE', () => {
  it('worked example: R=2000, K=0.3, LS=5, C=0.5, P=1 → A=1500 t/ha/yr', () => {
    const res = computeEquation(45, { R: 2000, K: 0.3, LS: 5, C: 0.5, P: 1 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1500, 6);
    expect(res!.unit).toBe('t/ha/yr');
  });

  it('conservation practice (P<1) reduces soil loss', () => {
    const noPractice = computeEquation(45, { R: 2000, K: 0.3, LS: 5, C: 0.5, P: 1 });
    const withPractice = computeEquation(45, { R: 2000, K: 0.3, LS: 5, C: 0.5, P: 0.5 });
    expect(withPractice!.result).toBeCloseTo(noPractice!.result / 2, 6);
  });

  it('exposes tolerance and excess as secondary', () => {
    const sec = computeEquation(45, { R: 2000, K: 0.3, LS: 5, C: 0.5, P: 1 })!.secondary ?? [];
    const tol = sec.find((s) => s.key === 'tolerance');
    const excess = sec.find((s) => s.key === 'excess_above_tolerance');
    expect(tol?.value).toBe(11);
    expect(excess?.value).toBeCloseTo(1500 - 11, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(45, { R: '2000', K: '0.3', LS: '5', C: '0.5', P: '1' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1500, 6);
  });

  it('returns honest NaN when a factor is missing', () => {
    const res = computeEquation(45, { R: Number.NaN, K: Number.NaN, LS: Number.NaN, C: Number.NaN, P: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('Cannot compute');
  });
});