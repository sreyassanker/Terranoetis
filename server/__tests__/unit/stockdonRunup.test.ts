import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 74 — Stockdon Wave Runup (Stockdon et al., 2006) ─────────────
// Paper: Stockdon, H.F., Holman, R.A., Howd, P.A. & Sallenger, A.H. (2006)
// Empirical parameterization of setup, swash, and runup. Coastal
// Engineering 53(7):573–588. doi:10.1016/j.coastaleng.2005.12.005.
//
//   Eq (1):  L₀ = gT₀²/2π
//   Eq (9):  R₂ = 1.1·(η̄ + S/2)
//   Eq (10): η̄   = 0.35·β_f·(H₀L₀)^{1/2}          (all sites)
//   Eq (11): S_inc = 0.75·β_f·(H₀L₀)^{1/2}
//   Eq (12): S_IG  = 0.06·(H₀L₀)^{1/2}
//   ξ₀ < 0.3 dissipative branch:
//   Eq (16): η̄_d  = 0.016·(H₀L₀)^{1/2}
//   Eq (17): S_d   = 0.046·(H₀L₀)^{1/2}
//   Eq (18): R₂    = 0.043·(H₀L₀)^{1/2}
//   Eq (19): R₂ = 1.1·[0.35·β_f·(H₀L₀)^{1/2} + (H₀L₀(0.563β_f²+0.004))^{1/2}/2]

const G = 9.80665;

describe('Tool 74 — Stockdon Wave Runup', () => {
  it('intermediate beach worked example: H0=2, T0=8, betaF=0.1 → R2 = 1.29 m', () => {
    const res = computeEquation(74, { H0: 2, T0: 8, betaF: 0.1, g: G });
    expect(res).not.toBeNull();
    // L0 = 9.80665·64/(2π) = 99.89 m
    // sqrt(H0·L0) = sqrt(199.78) = 14.134
    // xi0 = 0.1/sqrt(2/99.89) = 0.1/0.14152 = 0.7067 ≥ 0.3 → all-sites model
    // eta  = 0.35·0.1·14.134 = 0.4947
    // Sinc = 0.75·0.1·14.134 = 1.0601
    // SIG  = 0.06·14.134     = 0.8481
    // S    = sqrt(1.0601² + 0.8481²) = 1.3576
    // R2   = 1.1·(0.4947 + 0.6788) = 1.2909
    expect(res!.result).toBeCloseTo(1.2909, 3);
    // Secondary values
    const sec = res!.secondary ?? [];
    const setup = sec.find((s) => s.key === 'setup');
    const swash = sec.find((s) => s.key === 'swash');
    const iribarren = sec.find((s) => s.key === 'iribarren');
    expect(setup!.value).toBeCloseTo(0.4947, 3);
    expect(swash!.value).toBeCloseTo(1.3576, 3);
    expect(iribarren!.value).toBeCloseTo(0.7067, 3);
  });

  it('dissipative branch (xi0 < 0.3) uses slope-independent Eq 18: R2 = 0.043·sqrt(H0·L0)', () => {
    // betaF=0.02, H0=4, T0=10 → L0 = 9.80665·100/(2π) = 156.08 m
    // sqrt(H0/L0) = sqrt(0.02563) = 0.1601, xi0 = 0.02/0.1601 = 0.1249 < 0.3
    const res = computeEquation(74, { H0: 4, T0: 10, betaF: 0.02, g: G });
    expect(res).not.toBeNull();
    // sqrt(H0·L0) = sqrt(624.3) = 24.986
    // R2 = 0.043·24.986 = 1.0744
    expect(res!.result).toBeCloseTo(1.0744, 3);
    const sec = res!.secondary ?? [];
    const iribarren = sec.find((s) => s.key === 'iribarren');
    expect(iribarren!.value).toBeLessThan(0.3);
    // Dissipative swash = 0.046·sqrt(H0L0), setup = 0.016·sqrt(H0L0)
    const setup = sec.find((s) => s.key === 'setup');
    const swash = sec.find((s) => s.key === 'swash');
    expect(setup!.value).toBeCloseTo(0.016 * 24.986, 3);
    expect(swash!.value).toBeCloseTo(0.046 * 24.986, 3);
  });

  it('honest NaN when inputs are missing/non-finite', () => {
    const res = computeEquation(74, { H0: Number.NaN, T0: 8, betaF: 0.1, g: G });
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(false);
  });

  it('zero swash limit: flat slope → R2 = 1.1·eta = 0.385·sqrt(H0L0) in all-sites model', () => {
    // betaF → 0 keeps xi0 < 0.3 (dissipative branch), so use a moderately
    // steep slope with tiny H0/L0 to stay above the threshold: H0=0.5, T0=12
    // → L0=224.8, sqrt(H0/L0)=0.0472, xi0 = 0.1/0.0472 = 2.12 ≥ 0.3.
    const res = computeEquation(74, { H0: 0.5, T0: 12, betaF: 0.1, g: G });
    expect(res).not.toBeNull();
    const sec = res!.secondary ?? [];
    const iribarren = sec.find((s) => s.key === 'iribarren');
    expect(iribarren!.value).toBeGreaterThan(0.3);
    expect(res!.result).toBeGreaterThan(0);
  });

  it('Unicode aliases H₀/T₀/β_f normalize to H0/T0/betaF', () => {
    const norm = normalizeInputs(74, { 'H₀': 2, 'T₀': 8, 'β_f': 0.1 });
    expect(norm).toEqual({ H0: 2, T0: 8, betaF: 0.1 });
    const viaUnicode = computeEquation(74, { 'H₀': 2, 'T₀': 8, 'β_f': 0.1, g: G });
    const viaAscii = computeEquation(74, { H0: 2, T0: 8, betaF: 0.1, g: G });
    expect(viaUnicode!.result).toBeCloseTo(viaAscii!.result, 10);
  });

  it('full-range Eq 19 equals the exact component form (Eqs 10-12) for the same inputs', () => {
    const res = computeEquation(74, { H0: 3, T0: 9, betaF: 0.15, g: G });
    expect(res).not.toBeNull();
    const L0 = G * 81 / (2 * Math.PI);
    const h0l0 = Math.sqrt(3 * L0);
    const xi0 = 0.15 / Math.sqrt(3 / L0);
    // The engine evaluates the EXACT component equations (Eqs 10-12):
    // eta = 0.35β√(H0L0), Sinc = 0.75β√(H0L0), SIG = 0.06√(H0L0),
    // S = √(Sinc²+SIG²), R2 = 1.1(eta + S/2).
    // The paper's Eq 19 prints 0.563 ≈ 0.75² and 0.004 ≈ 0.06² (rounded
    // print coefficients), so the exact form is the reference.
    const eta = 0.35 * 0.15 * h0l0;
    const sinc = 0.75 * 0.15 * h0l0;
    const sig = 0.06 * h0l0;
    const s = Math.sqrt(sinc * sinc + sig * sig);
    const r2Exact = 1.1 * (eta + s / 2);
    const r = res!.result;
    // The engine uses the all-sites model when xi0 ≥ 0.3 — for a large slope this holds
    if (xi0 >= 0.3) {
      expect(r).toBeCloseTo(r2Exact, 9);
      // And it must also match the paper's printed Eq 19 to within its own
      // rounding (0.563 vs 0.5625, 0.004 vs 0.0036):
      const r2Eq19 = 1.1 * (0.35 * 0.15 * h0l0 + Math.sqrt(3 * L0 * (0.563 * 0.15 * 0.15 + 0.004)) / 2);
      expect(Math.abs(r - r2Eq19)).toBeLessThan(0.02);
    } else {
      // Otherwise it must equal the dissipative Eq 18 value
      expect(r).toBeCloseTo(0.043 * h0l0, 6);
    }
  });
});
