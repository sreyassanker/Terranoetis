import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 39 — Gaussian Plume (Pasquill & Smith 1983) ─────────────────
// C = Q/(2π·u·σ_y·σ_z) · exp(−y²/2σ_y²) · [exp(−(z−H)²/2σ_z²) + exp(−(z+H)²/2σ_z²)].
// Worked example (frontend-cited): Q=1000, u=5, σ_y=50, σ_z=30, y=0, z=0, H=0
//   → denom = 2π·5·50·30 = 47124; expY=1; vert = exp(0)+exp(0) = 2
//   → C = 1000/47124 × 2 = 0.0424 µg/m³.

describe('Tool 39 — Gaussian Plume', () => {
  it('worked example: Q=1000, u=5, σ_y=50, σ_z=30, y=0, z=0, H=0 → C≈0.0424 µg/m³', () => {
    const res = computeEquation(39, { Q: 1000, u: 5, sigmaY: 50, sigmaZ: 30, y: 0, z: 0, H: 0 });
    expect(res).not.toBeNull();
    const denom = 2 * Math.PI * 5 * 50 * 30;
    expect(res!.result).toBeCloseTo(1000 / denom * 2, 6);
    expect(res!.unit).toBe('µg/m³');
  });

  it('off-centerline (y>0) gives lower concentration', () => {
    const center = computeEquation(39, { Q: 1000, u: 5, sigmaY: 50, sigmaZ: 30, y: 0, z: 0, H: 0 });
    const off = computeEquation(39, { Q: 1000, u: 5, sigmaY: 50, sigmaZ: 30, y: 100, z: 0, H: 0 });
    expect(off!.result).toBeLessThan(center!.result);
  });

  it('elevated stack (H>0) reduces ground-level concentration', () => {
    const ground = computeEquation(39, { Q: 1000, u: 5, sigmaY: 50, sigmaZ: 30, y: 0, z: 0, H: 0 });
    const elevated = computeEquation(39, { Q: 1000, u: 5, sigmaY: 50, sigmaZ: 30, y: 0, z: 0, H: 30 });
    expect(elevated!.result).toBeLessThan(ground!.result);
  });

  it('exposes centerline concentration as secondary', () => {
    const res = computeEquation(39, { Q: 1000, u: 5, sigmaY: 50, sigmaZ: 30, y: 0, z: 0, H: 0 });
    const sec = res!.secondary ?? [];
    const cl = sec.find((s) => s.key === 'centerline');
    const denom = 2 * Math.PI * 5 * 50 * 30;
    expect(cl?.value).toBeCloseTo(1000 / denom * 2, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(39, { Q: '1000', u: '5', sigmaY: '50', sigmaZ: '30', y: '0', z: '0', H: '0' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when emission/dispersion inputs are missing', () => {
    const res = computeEquation(39, { Q: Number.NaN, u: 5, sigmaY: Number.NaN, sigmaZ: Number.NaN, y: 0, z: 0, H: 0 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
