import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine.js';

describe('Tool 73 — Pierson-Moskowitz Sea State (Pierson & Moskowitz 1964, eq 12)', () => {
  const U = 10;      // m/s, weather-ship wind (paper data range 20-40 kt)
  const g = 9.81;    // m/s²

  it('evaluates the paper eq (12) spectrum S(ω) = (αg²/ω⁵)e^(−β(ω₀/ω)⁴) at the peak', () => {
    const r = computeEquation(73, { U, g, omega: (4 * 0.74 / 5) ** 0.25 * g / U });
    expect(r).not.toBeNull();
    const wp = (4 * 0.74 / 5) ** 0.25 * g / U;   // 0.877·g/U
    const w0 = g / U;
    const expectS = 8.10e-3 * g * g / wp ** 5 * Math.exp(-0.74 * (w0 / wp) ** 4);
    expect(r!.result).toBeCloseTo(expectS, 10);
    // Paper-fixed α and β: ω_p = (4β/5)^(1/4)·g/U = 0.877·g/U
    expect(wp).toBeCloseTo(0.877 * g / U, 3);
  });

  it('derives the classic P-M significant wave height H_s = 0.209·U²/g', () => {
    const r = computeEquation(73, { U, g, omega: 1 });
    expect(r).not.toBeNull();
    const m0 = 8.10e-3 * U ** 4 / (4 * 0.74 * g * g);
    const Hs = 4 * Math.sqrt(m0);
    expect(Hs).toBeCloseTo(0.209 * U * U / g, 2);
    const secHs = r!.secondary!.find((s) => s.key === 'Hs')!;
    expect(secHs.value).toBeCloseTo(Hs, 10);
    expect(secHs.value).toBeCloseTo(2.13, 1);   // classic U=10 → H_s ≈ 2.13 m
  });

  it('derives the peak period T_p = 2π/ω_p = 7.16·U/g (classic 0.729·U s)', () => {
    const r = computeEquation(73, { U, g, omega: 1 });
    expect(r).not.toBeNull();
    const secTp = r!.secondary!.find((s) => s.key === 'Tp')!;
    const Tp = 2 * Math.PI / ((4 * 0.74 / 5) ** 0.25 * g / U);
    expect(secTp.value).toBeCloseTo(Tp, 10);
    expect(secTp.value).toBeCloseTo(7.30, 1);   // U=10 → T_p ≈ 7.30 s
  });

  it('scales S(ω) as ω⁻⁵ in the equilibrium range above the peak', () => {
    const r1 = computeEquation(73, { U, g, omega: 2 });
    const r2 = computeEquation(73, { U, g, omega: 4 });
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // ω⁻⁵ dominates: S(4)/S(2) ≈ (2/4)⁵ = 1/32 (e^(−β(ω₀/ω)⁴) → 1 for ω ≫ ω₀)
    expect(r2!.result / r1!.result).toBeCloseTo(1 / 32, 2);
  });

  it('returns honest NaN (not a fabricated fallback) when U is missing', () => {
    const r = computeEquation(73, { g, omega: 1 });
    expect(r).not.toBeNull();
    expect(Number.isNaN(r!.result)).toBe(true);
    const secHs = r!.secondary!.find((s) => s.key === 'Hs')!;
    expect(Number.isNaN(secHs.value)).toBe(true);
  });

  it('returns honest NaN for non-positive U (the paper requires wind > 0)', () => {
    const r = computeEquation(73, { U: 0, g, omega: 1 });
    expect(r).not.toBeNull();
    expect(Number.isNaN(r!.result)).toBe(true);
  });

  it('applies the paper\'s 19.5 m weather-ship reference height: ERA5 10 m wind converted via the neutral log profile', () => {
    // The paper: "The spectral form given by (12) will describe the spectrum
    // of a fully developed wind sea for a wind measured at 19.5 meters." The
    // context engine converts the genuine ERA5 10 m wind to 19.5 m with
    // U₂ = U₁·ln(z₂/z₀)/ln(z₁/z₀), z₀ = 0.0002 m open-ocean roughness.
    const u10 = 10;
    const u195 = u10 * Math.log(19.5 / 0.0002) / Math.log(10 / 0.0002);
    expect(u195).toBeCloseTo(10.62, 2);
    // Feeding the converted wind gives a slightly higher H_s than the raw 10 m
    // wind would (H_s ∝ U²): the α = 0.0081 calibration is for the ship-height wind.
    const r195 = computeEquation(73, { U: u195, g, omega: 1 });
    const r10 = computeEquation(73, { U: u10, g, omega: 1 });
    expect(r195!.secondary!.find((s) => s.key === 'Hs')!.value).toBeGreaterThan(
      r10!.secondary!.find((s) => s.key === 'Hs')!.value,
    );
    // ω_p = 0.877·g/U shifts to lower frequency for the (higher) ship-height wind.
    expect(r195!.secondary!.find((s) => s.key === 'wp')!.value).toBeLessThan(
      r10!.secondary!.find((s) => s.key === 'wp')!.value,
    );
  });

  it('classifies the sea state by H_s (m), not by S(ω) (m²·s) — OCEAN_BANDS are wave-height bands', () => {
    // H_s = 0.209·U²/g: U=10 → 2.13 m (Moderate 1–5 m); U=20 → 8.5 m (High 5–10 m).
    const u10 = computeEquation(73, { U: 10, g, omega: 1 });
    const u20 = computeEquation(73, { U: 20, g, omega: 1 });
    const hs10 = u10!.secondary!.find((s) => s.key === 'Hs')!.value as number;
    const hs20 = u20!.secondary!.find((s) => s.key === 'Hs')!.value as number;
    expect(hs10).toBeCloseTo(2.13, 2);
    expect(hs20).toBeCloseTo(8.5, 1);
    // U=10 → Moderate (1–5 m); U=20 → High (5–10 m); U=30 → Extreme (>10 m).
    expect(hs10 >= 1 && hs10 < 5).toBe(true);
    expect(hs20 >= 5 && hs20 < 10).toBe(true);
    const u30 = computeEquation(73, { U: 30, g, omega: 1 });
    const hs30 = u30!.secondary!.find((s) => s.key === 'Hs')!.value as number;
    expect(hs30).toBeGreaterThan(10);
  });
});
