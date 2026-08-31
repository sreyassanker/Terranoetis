import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 9 — FAO-56 Penman-Monteith (Allen et al. 1998) ──────────────
// ET₀ = [0.408·Δ·(Rₙ−G) + γ·(900/(T+273))·u₂·(eₛ−eₐ)] / [Δ + γ(1+0.34·u₂)]
// FAO-56 Example 18: Rₙ=14.5 MJ/m²/day (≈168 W/m²), G=0, T=25, u₂=2,
// eₛ=3.17, eₐ=1.5, Δ=0.189, γ=0.067:
//   rad = 0.408·0.189·14.5 = 1.117
//   aero = 0.067·(900/298)·2·1.67 = 0.676
//   den = 0.189 + 0.067·(1+0.68) = 0.3016
//   ET₀ = (1.117+0.676)/0.3016 ≈ 5.95 mm/day

describe('Tool 9 — FAO-56 Penman-Monteith', () => {
  it('worked example: Rₙ=168 W/m², G=0, T=25, u₂=2, eₛ=3.17, eₐ=1.5, Δ=0.189, γ=0.067 → ET₀≈5.95 mm/day', () => {
    const res = computeEquation(9, { Rn: 168, G: 0, T: 25, u2: 2, es: 3.17, ea: 1.5, delta: 0.189, gamma: 0.067 });
    expect(res).not.toBeNull();
    const Rn_MJ = 168 * 0.0864;
    const rad = 0.408 * 0.189 * (Rn_MJ - 0);
    const aero = 0.067 * (900 / 298) * 2 * (3.17 - 1.5);
    const den = 0.189 + 0.067 * (1 + 0.34 * 2);
    const ET0 = (rad + aero) / den;
    expect(res!.result).toBeCloseTo(ET0, 6);
    expect(res!.unit).toBe('mm/day');
  });

  it('higher net radiation increases ET₀ (radiation term dominates)', () => {
    const low = computeEquation(9, { Rn: 100, G: 0, T: 25, u2: 2, es: 3.17, ea: 1.5, delta: 0.189, gamma: 0.067 });
    const high = computeEquation(9, { Rn: 300, G: 0, T: 25, u2: 2, es: 3.17, ea: 1.5, delta: 0.189, gamma: 0.067 });
    expect(high!.result).toBeGreaterThan(low!.result);
  });

  it('higher VPD (eₛ−eₐ) increases the aerodynamic term', () => {
    const humid = computeEquation(9, { Rn: 168, G: 0, T: 25, u2: 2, es: 3.17, ea: 2.5, delta: 0.189, gamma: 0.067 });
    const dry = computeEquation(9, { Rn: 168, G: 0, T: 25, u2: 2, es: 3.17, ea: 1.0, delta: 0.189, gamma: 0.067 });
    expect(dry!.result).toBeGreaterThan(humid!.result);
  });

  it('exposes radiation_term, aerodynamic_term and contributions as secondary', () => {
    const res = computeEquation(9, { Rn: 168, G: 0, T: 25, u2: 2, es: 3.17, ea: 1.5, delta: 0.189, gamma: 0.067 });
    const sec = res!.secondary ?? [];
    const rad = sec.find((s) => s.key === 'radiation_term');
    const aero = sec.find((s) => s.key === 'aerodynamic_term');
    const radFrac = sec.find((s) => s.key === 'rad_fraction');
    const aeroFrac = sec.find((s) => s.key === 'aero_fraction');
    expect(rad?.value).toBeGreaterThan(0);
    expect(aero?.value).toBeGreaterThan(0);
    // fractions sum to 100%
    expect(radFrac!.value + aeroFrac!.value).toBeCloseTo(100, 4);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(9, { Rn: '168', G: '0', T: '25', u2: '2', es: '3.17', ea: '1.5', delta: '0.189', gamma: '0.067' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when Rₙ/weather is missing', () => {
    const res = computeEquation(9, { Rn: Number.NaN, G: Number.NaN, T: Number.NaN, u2: Number.NaN, es: Number.NaN, ea: Number.NaN, delta: Number.NaN, gamma: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param aliases: Rₙ→Rn, u₂→u2, eₛ→es, eₐ→ea, Δ→delta, γ→gamma', () => {
    const normalized = normalizeInputs(9, { 'Rₙ': 168, 'u₂': 2, 'eₛ': 3.17, 'eₐ': 1.5, 'Δ': 0.189, 'γ': 0.067 } as unknown as Record<string, number>);
    expect(normalized['Rn']).toBe(168);
    expect(normalized['u2']).toBe(2);
    expect(normalized['es']).toBe(3.17);
    expect(normalized['ea']).toBe(1.5);
    expect(normalized['delta']).toBe(0.189);
    expect(normalized['gamma']).toBe(0.067);
  });
});
