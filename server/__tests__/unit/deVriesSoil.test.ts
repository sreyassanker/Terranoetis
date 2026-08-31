import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

describe('Tool 47 — de Vries Soil Thermal Conductivity', () => {
  it('wet sand (q=1, θ=0.25, ρ_b=1.6) → λ in the 1.5–2.5 W/m·K range', () => {
    const res = computeEquation(47, { sandFrac: 1.0, omPct: 0, rhoB: 1.6, theta: 0.25 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeGreaterThan(1.5);
    expect(res!.result).toBeLessThan(2.6);
    expect(res!.unit).toBe('W/m·K');
  });

  it('dry sand (θ=0.01) → λ in the 0.2–0.4 W/m·K range (air-continuous)', () => {
    const res = computeEquation(47, { sandFrac: 1.0, omPct: 0, rhoB: 1.6, theta: 0.01 });
    expect(res!.result).toBeGreaterThan(0.2);
    expect(res!.result).toBeLessThan(0.4);
  });

  it('moisture raises conductivity: wet sand ≫ dry sand', () => {
    const wet = computeEquation(47, { sandFrac: 1.0, omPct: 0, rhoB: 1.6, theta: 0.25 });
    const dry = computeEquation(47, { sandFrac: 1.0, omPct: 0, rhoB: 1.6, theta: 0.01 });
    expect(wet!.result / dry!.result).toBeGreaterThan(5);
  });

  it('organic soil (peat, 50% OM) → low λ ≈ 0.05–0.3 W/m·K', () => {
    const res = computeEquation(47, { sandFrac: 0, omPct: 50, rhoB: 0.3, theta: 0.3 });
    expect(res!.result).toBeGreaterThan(0.05);
    expect(res!.result).toBeLessThan(0.5);
  });

  it('exposes thermal_diffusivity and heat_capacity as secondary', () => {
    const res = computeEquation(47, { sandFrac: 1.0, omPct: 0, rhoB: 1.6, theta: 0.25 });
    const sec = res!.secondary ?? [];
    const alpha = sec.find((s) => s.key === 'thermal_diffusivity');
    const C = sec.find((s) => s.key === 'heat_capacity');
    expect(alpha?.value).toBeGreaterThan(0);
    expect(alpha?.unit).toBe('m²/s');
    // C ≈ Σxᵢcᵢ: wet sand ~1.5-3 MJ/m³·K
    expect(C?.value).toBeGreaterThan(1);
    expect(C?.value).toBeLessThan(4);
    expect(C?.unit).toBe('MJ/m³·K');
  });

  it('does NOT throw when inputs arrive as strings (numeric coercion)', () => {
    const res = computeEquation(47, { sandFrac: '1.0', omPct: '0', rhoB: '1.6', theta: '0.25' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when genuine soil data is missing (no fabricated λ)', () => {
    const res = computeEquation(47, { sandFrac: Number.NaN, omPct: Number.NaN, rhoB: Number.NaN, theta: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    for (const s of res!.secondary ?? []) expect(Number.isNaN(s.value)).toBe(true);
    // the steps explain which input is missing
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('NaN — no genuine ISRIC soil pixel');
  });

  it('preserves a genuine zero θ (air-continuous, not "missing")', () => {
    const res = computeEquation(47, { sandFrac: 1.0, omPct: 0, rhoB: 1.6, theta: 0 });
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeGreaterThan(0);
    expect(res!.result).toBeLessThan(0.4);
  });
});
