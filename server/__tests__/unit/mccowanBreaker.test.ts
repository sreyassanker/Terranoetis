import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 76 — McCowan Breaker Criterion (McCowan 1894) ───────────────
// Paper: McCowan, J. (1894) On the highest wave of permanent type.
// Philosophical Magazine, Series 5, 38(233), 351–358. doi:10.1080/14786449408620643.
//
// Paper result (eq 34): the highest solitary wave of permanent type in
// water of mean depth h rises to crest height c = 1.78h, so the maximum
// wave height is c − h = 0.78h. The tool evaluates this breaking criterion
// at the breaking depth: H_b = 0.78·d_b. Paper eq (35): the highest wave
// travels at V = √(1.56·g·h), ~25 % faster than a low wave (√(g·h)).
//
// In the live pipeline d_b auto-derives from genuine GEBCO 2020 bathymetry
// (positive only over water; land/fetch failure → honest NaN). The engine
// itself is a pure algebra evaluation that must be NaN-honest when d_b is
// missing/non-positive.

const G = 9.80665;

describe('Tool 76 — McCowan Breaker Criterion', () => {
  it('paper eq (34): H_b = 0.78 × d_b — d_b = 3 m → 2.34 m', () => {
    const res = computeEquation(76, { db: 3 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.78 * 3, 6); // 2.34 m
    expect(res!.unit).toBe('m');
    // catalogue worked examples
    expect(computeEquation(76, { db: 1 })!.result).toBeCloseTo(0.78, 6);
    expect(computeEquation(76, { db: 10 })!.result).toBeCloseTo(7.8, 6);
  });

  it('paper eq (35): celerity of the highest wave V = √(1.56·g·d_b)', () => {
    const res = computeEquation(76, { db: 3 });
    const sec = res!.secondary ?? [];
    const vs = sec.find((s) => s.key === 'wave_speed');
    expect(vs!.value).toBeCloseTo(Math.sqrt(1.56 * G * 3), 6); // ≈ 6.7746 m/s
  });

  it('breaker index γ_b = H_b/d_b = 0.78 constant (paper eq 34)', () => {
    const res = computeEquation(76, { db: 3 });
    const sec = res!.secondary ?? [];
    const gamma = sec.find((s) => s.key === 'breaker_index');
    expect(gamma!.value).toBeCloseTo(0.78, 6);
  });

  it('crest angle narrative: two branches cutting at 120° (paper §3/§5)', () => {
    const res = computeEquation(76, { db: 3 });
    const sec = res!.secondary ?? [];
    const crest = sec.find((s) => s.key === 'crest_angle');
    expect(crest!.value).toBe(120);
    expect(res!.steps.join('\n')).toContain('120°');
    expect(res!.steps.join('\n')).toContain('c = 1.78h');
  });

  it('honest NaN when d_b is missing / NaN / non-positive', () => {
    // missing
    expect(Number.isFinite(computeEquation(76, {})!.result)).toBe(false);
    // NaN
    expect(Number.isFinite(computeEquation(76, { db: Number.NaN })!.result)).toBe(false);
    // non-positive (zero/negative depth has no breaking wave)
    expect(Number.isFinite(computeEquation(76, { db: 0 })!.result)).toBe(false);
    expect(Number.isFinite(computeEquation(76, { db: -2 })!.result)).toBe(false);
  });

  it('step text stays finite and honest when data is missing (no Infinity, explains NaN)', () => {
    const res = computeEquation(76, { db: Number.NaN });
    expect(res).not.toBeNull();
    expect(res!.steps.every((s) => typeof s === 'string')).toBe(true);
    const text = res!.steps.join('\n');
    expect(text).toContain('N/A');
    expect(text).toContain('honest NaN');
    expect(text).not.toContain('Infinity');
  });

  it('alias normalization: d_b → db (PARAM_ALIASES[76])', () => {
    const norm = normalizeInputs(76, { 'd_b': 3 });
    expect(norm.db).toBe(3);
    // Both spellings must produce the same engine result.
    const viaAlias = computeEquation(76, { 'd_b': 3 });
    expect(viaAlias!.result).toBeCloseTo(2.34, 6);
  });

  it('deep-water honesty note present (depth-limited breaking not governing in deep water)', () => {
    const res = computeEquation(76, { db: 40 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(31.2, 6); // 0.78 × 40 — formula still evaluates
    const text = res!.steps.join('\n');
    expect(text).toContain('deep water');
  });
});
