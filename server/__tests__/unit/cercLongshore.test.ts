import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 77 — CERC Longshore Sediment Transport (SPM 1984) ───────────
// Source: U.S. Army Corps of Engineers (1984) Shore Protection Manual,
// 4th ed., Vol. I, Ch. 4 (Littoral Processes), §V Energy Flux Method:
//   eq 4-44: P_ls = 0.0884·ρ·g^(3/2)·H_b^(5/2)·sin(2α_b)   (breaking height)
//   eq 4-45: P_ls = 0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀) (deep water)
//   eq 4-48: I_l = K·P_ls        (K = 0.39 SPM design; Komar & Inman 0.77 deep-water)
//   eq 4-35/4-49: Q = I_l/((ρs−ρ)·g·(1−n))   (Table 4-8: ρs=2650, ρ=1025, 1−n=0.6)
//   eq 4-50a: Q(yr) = 1290·P_ls m³/yr  (dimensional design constant)
//
// The live pipeline supplies genuine CDS ERA5 swh as deep-water H_0s (→ eq
// 4-45, provenance-flagged) and ERA5 mwd × GEBCO 2020 shoreline for θ; the
// engine is a pure evaluation that must be NaN-honest on missing/invalid
// inputs.

const RHO_SW = 1025;
const G = 9.80665;
const g32 = Math.pow(G, 1.5);

describe('Tool 77 — CERC Longshore Transport Equation', () => {
  it('paper worked check (K=0.39, H=1.5 m, θ=20°): P_ls → I_l → Q', () => {
    const res = computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 20 * Math.PI / 180 });
    expect(res).not.toBeNull();
    // eq 4-44: P_ls = 0.0884·ρ·g^1.5·H^2.5·sin(2θ)
    const Pls = 0.0884 * RHO_SW * g32 * Math.pow(1.5, 2.5) * Math.sin(2 * 20 * Math.PI / 180);
    expect(Pls).toBeCloseTo(4928.93, 0); // 0.0884·1025·9.80665^1.5·1.5^2.5·sin(40°)
    // eq 4-48: I = K·P_ls
    const I = 0.39 * Pls;
    // eq 4-49: Q = I/((2650−1025)·g·0.6)
    const Q = I / ((2650 - RHO_SW) * G * 0.6);
    expect(res!.result).toBeCloseTo(Q, 6);
    expect(res!.unit).toBe('m³/s');
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'energy_flux')!.value).toBeCloseTo(Pls, 1);
    expect(sec.find((s) => s.key === 'immersed_weight')!.value).toBeCloseTo(I, 1);
    // eq 4-50a: Q(yr) = 1290·P_ls
    expect(sec.find((s) => s.key === 'transport_annual')!.value).toBeCloseTo(1290 * Pls, 0);
  });

  it('annual cross-check: Q (m³/s) × 3.156e7 ≈ 1290·P_ls (eq 4-50a) within the SPM constant rounding', () => {
    const res = computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 20 * Math.PI / 180 });
    const sec = res!.secondary ?? [];
    const qyr = sec.find((s) => s.key === 'transport_annual')!.value as number;
    expect(res!.result * 3.156e7).toBeCloseTo(qyr, -5); // ~0.3 % gap = the printed 1290 uses g=9.8
  });

  it('deep-water form (eq 4-45) when H is auto ERA5 swh: coefficient 0.05·(cos α)^(1/4)', () => {
    // Same H/θ with __deepWaterForm → P_ls uses 0.05·(cosθ)^0.25 instead of 0.0884
    const res = computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 20 * Math.PI / 180, __deepWaterForm: 1 as unknown as number });
    expect(res).not.toBeNull();
    const theta = 20 * Math.PI / 180;
    const PlsDeep = 0.05 * RHO_SW * g32 * Math.pow(1.5, 2.5) * Math.pow(Math.cos(theta), 0.25) * Math.sin(2 * theta);
    const Qdeep = (0.39 * PlsDeep) / ((2650 - RHO_SW) * G * 0.6);
    expect(res!.result).toBeCloseTo(Qdeep, 6);
    expect(res!.steps.join('\n')).toContain('0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀)');
  });

  it('normal incidence θ=0 and shore-parallel θ=90° give zero transport; max at 45°', () => {
    expect(computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 0 })!.result).toBeCloseTo(0, 10);
    expect(computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: Math.PI / 2 })!.result).toBeCloseTo(0, 10);
    const q45 = Math.abs(computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: Math.PI / 4 })!.result);
    const q20 = Math.abs(computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 20 * Math.PI / 180 })!.result);
    expect(q45).toBeGreaterThan(q20);
  });

  it('signed θ gives signed transport (direction from sin(2θ))', () => {
    const pos = computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 0.35 })!.result;
    const neg = computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: -0.35 })!.result;
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeLessThan(0);
    expect(Math.abs(pos)).toBeCloseTo(Math.abs(neg), 10);
  });

  it('honest NaN when K/H/θ missing, non-finite, or H ≤ 0', () => {
    expect(Number.isFinite(computeEquation(77, {})!.result)).toBe(false);
    expect(Number.isFinite(computeEquation(77, { K: 0.39, Hsb: 1.5 })!.result)).toBe(false); // θ missing
    expect(Number.isFinite(computeEquation(77, { K: 0.39, thetaB: 0.35 })!.result)).toBe(false); // H missing
    expect(Number.isFinite(computeEquation(77, { K: 0.39, Hsb: 0, thetaB: 0.35 })!.result)).toBe(false); // H = 0
    expect(Number.isFinite(computeEquation(77, { K: 0, Hsb: 1.5, thetaB: 0.35 })!.result)).toBe(false); // K = 0
    expect(Number.isFinite(computeEquation(77, { K: 0.39, Hsb: Number.NaN, thetaB: 0.35 })!.result)).toBe(false);
  });

  it('step text stays finite and honest when data is missing (no toFixed crash, no Infinity)', () => {
    const res = computeEquation(77, { K: 0.39, Hsb: Number.NaN, thetaB: 0.35 });
    expect(res).not.toBeNull();
    expect(res!.steps.every((s) => typeof s === 'string')).toBe(true);
    const text = res!.steps.join('\n');
    expect(text).toContain('honest NaN');
    expect(text).not.toContain('Infinity');
    expect(text).not.toContain('NaN NaN'); // no crash artifacts
  });

  it('alias normalization: H_sb → Hsb, θ_b → thetaB (PARAM_ALIASES[77])', () => {
    const norm = normalizeInputs(77, { K: 0.39, 'H_sb': 1.5, 'θ_b': 0.35 });
    expect(norm.Hsb).toBe(1.5);
    expect(norm.thetaB).toBe(0.35);
    const viaAlias = computeEquation(77, { K: 0.39, 'H_sb': 1.5, 'θ_b': 0.35 });
    const viaAscii = computeEquation(77, { K: 0.39, Hsb: 1.5, thetaB: 0.35 });
    expect(viaAlias!.result).toBeCloseTo(viaAscii!.result, 12);
  });
});
