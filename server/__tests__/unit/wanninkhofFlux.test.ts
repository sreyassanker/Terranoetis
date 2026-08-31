import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 56 — Air-Sea CO₂ Flux (Wanninkhof 1992) ─────────────────────
// F = k·K₀·ΔpCO₂ (µatm→atm ×10⁻⁶). Worked example: k=1000 m/yr,
// K₀=30 mol/m³·atm, ΔpCO₂=10 µatm → F = 1000·30·10·1e-6 = 0.3 mol/m²/yr
// (frontend-cited). Negative ΔpCO₂ (undersaturated ocean) = sink.

describe('Tool 56 — Air-Sea CO₂ Flux', () => {
  it('worked example: k=1000, K₀=30, ΔpCO₂=10 → F=0.3 mol/m²/yr (source)', () => {
    const res = computeEquation(56, { k: 1000, K0: 30, dCO2: 10 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.3, 6);
    expect(res!.unit).toBe('mol/m²/yr');
  });

  it('negative ΔpCO₂ (undersaturated) → negative F = sink', () => {
    const res = computeEquation(56, { k: 1000, K0: 30, dCO2: -10 });
    expect(res!.result).toBeCloseTo(-0.3, 6);
  });

  it('exposes carbon_uptake and gas_transfer_velocity as secondary', () => {
    const res = computeEquation(56, { k: 1000, K0: 30, dCO2: 10 });
    const sec = res!.secondary ?? [];
    const cu = sec.find((s) => s.key === 'carbon_uptake');
    const k = sec.find((s) => s.key === 'gas_transfer_velocity');
    expect(cu?.value).toBeCloseTo(0.3 * 12.01, 6); // F × 12.01 gC/mol
    expect(cu?.unit).toBe('gC/m²/yr');
    expect(k?.value).toBeCloseTo(1000, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(56, { k: '1000', K0: '30', dCO2: '10' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.3, 6);
  });

  it('returns honest NaN when a genuine input is missing', () => {
    const res = computeEquation(56, { k: Number.NaN, K0: Number.NaN, dCO2: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('no fabricated values');
  });
});
