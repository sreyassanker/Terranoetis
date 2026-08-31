import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 10 — SCS Curve Number (USDA SCS, 1954) ──────────────────────
// Q = (P−Iₐ)²/(P−Iₐ+S) for P > Iₐ, else 0. CN = 25400/(S+254).
// Iₐ = 0.2·S (standard). Worked example: P=100, Iₐ=20, S=100 →
//   excess = 80, Q = 80²/180 = 6400/180 = 35.56 mm, CN = 25400/354 = 72.

describe('Tool 10 — SCS Curve Number', () => {
  it('worked example: P=100, Iₐ=20, S=100 → Q=35.56 mm, CN=72', () => {
    const res = computeEquation(10, { P: 100, Ia: 20, S: 100 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(6400 / 180, 6);
    expect(res!.unit).toBe('mm');
    const sec = res!.secondary ?? [];
    const cn = sec.find((s) => s.key === 'cn');
    expect(cn?.value).toBeCloseTo(25400 / 354, 6);
  });

  it('P ≤ Iₐ → zero runoff', () => {
    const res = computeEquation(10, { P: 15, Ia: 20, S: 100 });
    expect(res!.result).toBeCloseTo(0, 9);
  });

  it('higher CN (lower S) → more runoff', () => {
    const lowCN = computeEquation(10, { P: 100, Ia: 20, S: 200 }); // CN≈56
    const highCN = computeEquation(10, { P: 100, Ia: 20, S: 50 });  // CN≈84
    expect(highCN!.result).toBeGreaterThan(lowCN!.result);
  });

  it('exposes CN, runoff_ratio and Iₐ/S ratio as secondary', () => {
    const res = computeEquation(10, { P: 100, Ia: 20, S: 100 });
    const sec = res!.secondary ?? [];
    const rr = sec.find((s) => s.key === 'runoff_ratio');
    const ias = sec.find((s) => s.key === 'initial_abstraction_ratio');
    expect(rr?.value).toBeCloseTo((6400 / 180) / 100, 9);
    expect(ias?.value).toBeCloseTo(20 / 100, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(10, { P: '100', Ia: '20', S: '100' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(6400 / 180, 6);
  });

  it('returns honest NaN when P/Iₐ/S are missing', () => {
    const res = computeEquation(10, { P: Number.NaN, Ia: Number.NaN, S: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param aliases: Iₐ→Ia (frontend) via normalizeInputs', () => {
    const normalized = normalizeInputs(10, { 'Iₐ': 20 } as unknown as Record<string, number>);
    expect(normalized['Ia']).toBe(20);
  });
});