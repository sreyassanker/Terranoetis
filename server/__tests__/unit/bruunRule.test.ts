import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 75 — Bruun Rule (Bruun 1962) ────────────────────────────────
// Paper: Bruun, P. (1962) Sea-level rise as a cause of shore erosion.
// J. Waterways and Harbors Division, 88(1), 117-130.
// doi:10.1061/jwheau.0000252.
//
//   R = S·L/(B + h*)   — canonical form
//   R = S/tanβ         — equivalent slope form (L = (B + h*)/tanβ at the
//                        average active-profile slope; SCOR 1991 restatement)
//
// All four inputs (L, S, B, h*) auto-derive from genuine data in the live
// pipeline; the engine itself is a pure algebra evaluation that must be
// NaN-honest when any required datum is missing/invalid.

describe('Tool 75 — Bruun Rule', () => {
  it('worked example: L=500, S=0.003 m/yr, B=2, h*=8 → R = 0.15 m/yr', () => {
    const res = computeEquation(75, { L: 500, S: 0.003, B: 2, hstar: 8 });
    expect(res).not.toBeNull();
    // R = 500·0.003/(2+8) = 1.5/10 = 0.15 m/yr
    expect(res!.result).toBeCloseTo(0.15, 6);
    expect(res!.unit).toBe('m/yr');
  });

  it('Bruun factor R/S = L/(B+h*) = 50 and total retreat 2020-2100 = 12 m', () => {
    const res = computeEquation(75, { L: 500, S: 0.003, B: 2, hstar: 8 });
    const sec = res!.secondary ?? [];
    const factor = sec.find((s) => s.key === 'retreat_factor');
    const total = sec.find((s) => s.key === 'total_retreat');
    expect(factor!.value).toBeCloseTo(50, 6);
    expect(total!.value).toBeCloseTo(0.15 * 80, 6); // 80 yr (2020-2100)
  });

  it('slope-form cross-check: L=(B+h*)/tanβ ⇒ R = S/tanβ exactly', () => {
    // β = 2° → tanβ = 0.03492; B = 2, h* = 8 → L = 10/0.03492 = 286.36 m
    const beta = 2 * Math.PI / 180;
    const tanB = Math.tan(beta);
    const L = (2 + 8) / tanB;
    const S = 0.003;
    const res = computeEquation(75, { L, S, B: 2, hstar: 8 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(S / tanB, 6);
  });

  it('zero sea-level rise → zero retreat (not NaN)', () => {
    const res = computeEquation(75, { L: 500, S: 0, B: 2, hstar: 8 });
    expect(res).not.toBeNull();
    expect(res!.result).toBe(0);
  });

  it('honest NaN when any required datum is missing/non-finite', () => {
    // S missing (auto source unavailable in the pipeline)
    expect(Number.isFinite(computeEquation(75, { L: 500, B: 2, hstar: 8 })!.result)).toBe(false);
    // S explicitly NaN
    expect(Number.isFinite(computeEquation(75, { L: 500, S: Number.NaN, B: 2, hstar: 8 })!.result)).toBe(false);
    // L NaN
    expect(Number.isFinite(computeEquation(75, { L: Number.NaN, S: 0.003, B: 2, hstar: 8 })!.result)).toBe(false);
    // h* NaN
    expect(Number.isFinite(computeEquation(75, { L: 500, S: 0.003, B: 2, hstar: Number.NaN })!.result)).toBe(false);
    // B NaN
    expect(Number.isFinite(computeEquation(75, { L: 500, S: 0.003, B: Number.NaN, hstar: 8 })!.result)).toBe(false);
  });

  it('alias normalization: L* → L, h* → hstar (PARAM_ALIASES[75])', () => {
    const norm = normalizeInputs(75, { 'L*': 500, S: 0.003, B: 2, 'h*': 8 });
    expect(norm.L).toBe(500);
    expect(norm.hstar).toBe(8);
    expect(norm.S).toBe(0.003);
    expect(norm.B).toBe(2);
    // Both spellings must produce the same engine result.
    const viaAlias = computeEquation(75, { 'L*': 500, S: 0.003, B: 2, 'h*': 8 });
    expect(viaAlias!.result).toBeCloseTo(0.15, 6);
  });

  it('step text stays finite and honest when data is missing (no toFixed crash)', () => {
    const res = computeEquation(75, { L: Number.NaN, S: 0.003, B: 2, hstar: 8 });
    expect(res).not.toBeNull();
    expect(res!.steps.every((s) => typeof s === 'string')).toBe(true);
    const text = res!.steps.join('\n');
    expect(text).toContain('N/A');
    expect(text).not.toContain('Infinity');
  });
});
