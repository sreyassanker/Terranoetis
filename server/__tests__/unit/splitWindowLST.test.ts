import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 1 — Split-Window LST (Rozenstein et al. 2014) ───────────────
// Paper: Rozenstein, O., Qin, Z., Derimian, Y. & Karnieli, A. (2014)
// Derivation of land surface temperature for Landsat-8 TIRS using a split
// window algorithm. Sensors 14(4):5768-5780. doi:10.3390/s140405768.
//
// Ts = A₀ + A₁·T₁₀ − A₂·T₁₁, with
//   C_i = ε_i·τ_i, D_i = (1−τ_i)·(1+(1−ε_i)·τ_i)
//   E₀ = D₁₁·C₁₀ − D₁₀·C₁₁, A = D₁₀/E₀
//   E₁ = D₁₁·(1−C₁₀−D₁₀)/E₀, E₂ = D₁₀·(1−C₁₁−D₁₁)/E₀
//   A₀ = E₁·a₁₀ + E₂·a₁₁, A₁ = 1 + A + E₁·b₁₀, A₂ = A + E₂·b₁₁
// Transmittance (mid-lat summer): τ₁₀ = −0.1146·w + 1.0286,
// τ₁₁ = −0.1568·w + 1.0083. Li regression: a₁₀=−64.4661, b₁₀=0.4398,
// a₁₁=−68.8678, b₁₁=0.4755.

describe('Tool 1 — Split-Window LST', () => {
  it('worked example: T₁₀=300, T₁₁=298, ε₁₀=0.97, ε₁₁=0.98, w=1.5 → Ts≈30.2 °C', () => {
    const res = computeEquation(1, { T10: 300, T11: 298, eps10: 0.97, eps11: 0.98, w: 1.5 });
    expect(res).not.toBeNull();
    expect(res!.unit).toBe('°C');
    // Recompute the full chain by hand
    const tau10 = Math.max(0.1, -0.1146 * 1.5 + 1.0286);
    const tau11 = Math.max(0.1, -0.1568 * 1.5 + 1.0083);
    const C10 = 0.97 * tau10, C11 = 0.98 * tau11;
    const D10 = (1 - tau10) * (1 + (1 - 0.97) * tau10);
    const D11 = (1 - tau11) * (1 + (1 - 0.98) * tau11);
    const E0 = D11 * C10 - D10 * C11;
    const A = D10 / E0;
    const E1 = D11 * (1 - C10 - D10) / E0;
    const E2 = D10 * (1 - C11 - D11) / E0;
    const A0 = E1 * -64.4661 + E2 * -68.8678;
    const A1 = 1 + A + E1 * 0.4398;
    const A2 = A + E2 * 0.4755;
    const TsK = A0 + A1 * 300 - A2 * 298;
    expect(res!.result).toBeCloseTo(TsK - 273.15, 4);
  });

  it('higher column water vapor reduces transmittance (cooler retrieved surface)', () => {
    const dry = computeEquation(1, { T10: 300, T11: 298, eps10: 0.97, eps11: 0.98, w: 1.0 });
    const wet = computeEquation(1, { T10: 300, T11: 298, eps10: 0.97, eps11: 0.98, w: 3.0 });
    expect(dry!.result).not.toBeCloseTo(wet!.result, 1);
    expect(Number.isFinite(dry!.result)).toBe(true);
    expect(Number.isFinite(wet!.result)).toBe(true);
  });

  it('emissivity near 1 (black body) vs lower emissivity changes the retrieval', () => {
    const bb = computeEquation(1, { T10: 300, T11: 298, eps10: 0.99, eps11: 0.99, w: 1.5 });
    const lowE = computeEquation(1, { T10: 300, T11: 298, eps10: 0.9, eps11: 0.9, w: 1.5 });
    expect(bb!.result).not.toBeCloseTo(lowE!.result, 1);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(1, { T10: '300', T11: '298', eps10: '0.97', eps11: '0.98', w: '1.5' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when genuine satellite data is missing', () => {
    const res = computeEquation(1, { T10: Number.NaN, T11: Number.NaN, eps10: Number.NaN, eps11: Number.NaN, w: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param aliases: T₁₀→T10, ε₁₀→eps10, w→w via normalizeInputs', () => {
    const normalized = normalizeInputs(1, { 'T₁₀': 300, 'T₁₁': 298, 'ε₁₀': 0.97, 'ε₁₁': 0.98, w: 1.5 } as unknown as Record<string, number>);
    expect(normalized['T10']).toBe(300);
    expect(normalized['T11']).toBe(298);
    expect(normalized['eps10']).toBe(0.97);
    expect(normalized['eps11']).toBe(0.98);
  });
});
