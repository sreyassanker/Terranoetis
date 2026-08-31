import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 6 — Advection-Diffusion (Bird, Stewart & Lightfoot 2007) ────
// C = C₀ · (1 + 2Dt/σ₀²)^(-3/2). Worked example: u=5, D=100, C₀=100,
// t=3600, σ₀=50 → 2Dt/σ₀² = 2·100·3600/2500 = 288, dilution = 289^(-1.5)
// = 2.03e-4, C = 100·2.03e-4 = 0.0203 µg/m³.

describe('Tool 6 — Advection-Diffusion', () => {
  it('worked example: u=5, D=100, C₀=100, t=3600, σ₀=50 → C≈0.0203 µg/m³', () => {
    const res = computeEquation(6, { u: 5, D: 100, C0: 100, t: 3600, sigma0: 50 });
    expect(res).not.toBeNull();
    const dilution = Math.pow(1 + 2 * 100 * 3600 / (50 * 50), -1.5);
    expect(res!.result).toBeCloseTo(100 * dilution, 6);
    expect(res!.unit).toBe('µg/m³');
  });

  it('higher diffusivity → more dilution', () => {
    const lowD = computeEquation(6, { u: 5, D: 10, C0: 100, t: 3600, sigma0: 50 });
    const highD = computeEquation(6, { u: 5, D: 1000, C0: 100, t: 3600, sigma0: 50 });
    expect(highD!.result).toBeLessThan(lowD!.result);
  });

  it('exposes peclet, advection_distance and diffusion_spread as secondary', () => {
    const res = computeEquation(6, { u: 5, D: 100, C0: 100, t: 3600, sigma0: 50 });
    const sec = res!.secondary ?? [];
    const pe = sec.find((s) => s.key === 'peclet');
    const adv = sec.find((s) => s.key === 'advection_distance');
    const sigma = sec.find((s) => s.key === 'diffusion_spread');
    expect(pe?.value).toBeCloseTo(5 * 5 * 3600 / (4 * 100), 6);
    expect(adv?.value).toBeCloseTo(5 * 3600, 6);
    expect(sigma?.value).toBeCloseTo(Math.sqrt(2 * 100 * 3600), 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(6, { u: '5', D: '100', C0: '100', t: '3600', sigma0: '50' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when D/C₀/t are missing', () => {
    const res = computeEquation(6, { u: 5, D: Number.NaN, C0: Number.NaN, t: Number.NaN, sigma0: 50 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});