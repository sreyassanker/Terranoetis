/**
 * Tool 70 — TEOS-10 Seawater Density (Roquet et al. 2015 75-term polynomial)
 *
 * Cross-validated against:
 *  - the canonical TEOS-10 reference value ρ(S_A=35.16504, Θ=25 °C, p=0) = 1023.3431 kg/m³
 *    (IOC/SCOR/IAPSO Manual 56 §3.3 / gsw_specvol(35.16504, 25, 0) = 9.7718196e-4 m³/kg)
 *  - the catalogue's worked examples (S_A=35, Θ=10, p=0 → 1026.825; Θ=25 → 1023.221)
 *  - TEOS-10 sound speed references (S_A=35, Θ=10, p=0 → 1490 m/s; Θ=25 → 1530; p=5000 → 1580)
 */
import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const run70 = (inputs: Record<string, number>) =>
  computeEquation(70, inputs);

describe('Tool 70 — TEOS-10 Seawater Density', () => {
  it('reproduces the canonical TEOS-10 reference value (SSO, 25 °C, 0 dbar)', () => {
    const r = run70({ S: 35.16504, Theta: 25, p: 0 })!;
    // gsw: ρ = 1023.3431 kg/m³
    expect(r.result).toBeCloseTo(1023.3431, 3);
  });

  it('reproduces the catalogue worked examples', () => {
    const a = run70({ S: 35, Theta: 10, p: 0 })!;
    expect(a.result).toBeCloseTo(1026.825, 2); // 1026.825 kg/m³

    const b = run70({ S: 35, Theta: 25, p: 0 })!;
    expect(b.result).toBeCloseTo(1023.221, 2); // 1023.221 kg/m³

    const c = run70({ S: 35, Theta: 10, p: 5000 })!;
    expect(c.result).toBeCloseTo(1048.14, 1); // pressure compression
  });

  it('computes TEOS-10 sound speed secondaries', () => {
    const sec = (r: ReturnType<typeof run70>) => r!.secondary?.find((s) => s.key === 'sound_speed')?.value;
    expect(sec(run70({ S: 35, Theta: 10, p: 0 }))).toBeCloseTo(1490, -1);
    expect(sec(run70({ S: 35, Theta: 25, p: 0 }))).toBeCloseTo(1530, -1);
    expect(sec(run70({ S: 35, Theta: 10, p: 5000 }))).toBeCloseTo(1580, -1);
  });

  it('returns honest NaN for non-finite inputs (no fabricated defaults)', () => {
    const r = run70({ S: Number.NaN, Theta: 25, p: 0 })!;
    expect(Number.isNaN(r.result)).toBe(true);
  });

  it('returns honest NaN outside the polynomial valid range', () => {
    // S_A < 0, Θ outside [-18, 40], p < 0 → NaN (never a clipped extrapolation)
    const a = run70({ S: -5, Theta: 25, p: 0 })!;
    expect(Number.isNaN(a.result)).toBe(true);

    const b = run70({ S: 35, Theta: 60, p: 0 })!;
    expect(Number.isNaN(b.result)).toBe(true);

    const c = run70({ S: 35, Theta: 10, p: -100 })!;
    expect(Number.isNaN(c.result)).toBe(true);
  });

  it('density increases with pressure and salinity, decreases with temperature', () => {
    const s35t10p0 = run70({ S: 35, Theta: 10, p: 0 })!.result;
    const s35t10p5000 = run70({ S: 35, Theta: 10, p: 5000 })!.result;
    const s35t25p0 = run70({ S: 35, Theta: 25, p: 0 })!.result;
    const s37t10p0 = run70({ S: 37, Theta: 10, p: 0 })!.result;
    expect(s35t10p5000).toBeGreaterThan(s35t10p0);
    expect(s35t10p0).toBeGreaterThan(s35t25p0);
    expect(s37t10p0).toBeGreaterThan(s35t10p0);
  });

  it('narrates the gsw_specvol polynomial form in the steps', () => {
    const r = run70({ S: 35.16504, Theta: 25, p: 0 })!;
    expect(r.steps.join('\n')).toContain('75-term');
    expect(r.steps.join('\n')).toContain('1023.3431');
    expect(r.steps.join('\n')).toContain('gsw_specvol');
  });
});
