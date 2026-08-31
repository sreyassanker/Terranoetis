import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 52 — Beer-Lambert Canopy Light Extinction (Monsi & Saeki 1953) ──
// I(z) = I₀·exp(−k·LAI); fPAR = 1 − exp(−k·LAI). Worked example: I₀=2000,
// k=0.5, LAI=3 → 2000·exp(−1.5) = 446 µmol/m²/s.

describe('Tool 52 — Beer-Lambert Canopy Extinction', () => {
  it('worked example: I₀=2000, k=0.5, LAI=3 → 446 µmol/m²s', () => {
    const res = computeEquation(52, { I0: 2000, k: 0.5, LAI: 3 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(2000 * Math.exp(-0.5 * 3), 6);
    expect(res!.result).toBeCloseTo(446.3, 0);
    expect(res!.unit).toBe('µmol/m²s');
  });

  it('exposes absorbed_fraction, transmitted_fraction and compensation_lai as secondary', () => {
    const sec = computeEquation(52, { I0: 2000, k: 0.5, LAI: 3 })!.secondary ?? [];
    const abs = sec.find((s) => s.key === 'absorbed_fraction');
    const tr = sec.find((s) => s.key === 'transmitted_fraction');
    const comp = sec.find((s) => s.key === 'compensation_lai');
    expect(abs?.value).toBeCloseTo(1 - Math.exp(-1.5), 6);
    expect(tr?.value).toBeCloseTo(Math.exp(-1.5), 6);
    expect((abs!.value as number) + (tr!.value as number)).toBeCloseTo(1, 6);
    expect(comp?.value).toBeCloseTo(-(1 / 0.5) * Math.log(50 / 2000), 6);
    expect(comp?.unit).toBe('m²/m²');
  });

  it('emits a profile series I(z) vs LAI (vizType profile, LAI 0→6, 25 points)', () => {
    const res = computeEquation(52, { I0: 2000, k: 0.5, LAI: 3 })!;
    expect(res.series).toBeDefined();
    const pts = res.series![0].points;
    expect(pts.length).toBe(25);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[0].y).toBeCloseTo(2000, 6);
    expect(pts[pts.length - 1].x).toBeCloseTo(6, 6);
    expect(pts[pts.length - 1].y).toBeCloseTo(2000 * Math.exp(-0.5 * 6), 6);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(52, { I0: '2000', k: '0.5', LAI: '3' } as any);
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('zero preservation: I₀=0 → 0 PAR, compensation depth honest NaN', () => {
    const res = computeEquation(52, { I0: 0, k: 0.5, LAI: 3 })!;
    expect(res.result).toBe(0);
    expect(Number.isNaN(res.secondary!.find((s) => s.key === 'compensation_lai')!.value)).toBe(true);
  });

  it('honest NaN when inputs missing', () => {
    expect(Number.isNaN(computeEquation(52, { I0: NaN, k: NaN, LAI: NaN })!.result)).toBe(true);
  });
});

// ── Tool 54 — FvCB C3 Photosynthesis, Rubisco-limited (Farquhar et al. 1980) ──
// A_c = Vcmax·(ci − Γ*)/(ci + Kc·(1 + O/Ko)). Worked example: Vcmax=80, ci=250,
// Γ*=40, Kc=300, Ko=25000, O=210000 → Kc(1+O/Ko)=2820, A_c=80·210/3070=5.47.

describe('Tool 54 — FvCB Photosynthesis', () => {
  const KCO = 300 * (1 + 210000 / 25000); // 2820

  it('worked example: Vcmax=80, ci=250, Γ*=40, Kc=300, Ko=25000, O=210000 → A_c ≈ 5.47 µmol/m²s', () => {
    const res = computeEquation(54, { Vcmax: 80, ci: 250, GammaStar: 40, Kc: 300, Ko: 25000, O: 210000 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo((80 * (250 - 40)) / (250 + KCO), 6);
    expect(res!.result).toBeCloseTo(5.47, 1);
    expect(res!.unit).toBe('µmol/m²s');
  });

  it('exposes Wj, Rd, net assimilation, v_c, v_o and cᵢ/cₐ as secondary when J/Rd/ca supplied', () => {
    const res = computeEquation(54, { Vcmax: 80, ci: 250, GammaStar: 40, Kc: 300, Ko: 25000, O: 210000, ca: 400, J: 120, Rd: 1.5 });
    const sec = res!.secondary ?? [];
    const wj = sec.find((s) => s.key === 'electron_transport_limit')!;
    expect(wj.value).toBeCloseTo((120 * (250 - 40)) / (4 * (250 + 2 * 40)), 6);
    expect(sec.find((s) => s.key === 'dark_respiration')!.value).toBeCloseTo(1.5, 6);
    expect(sec.find((s) => s.key === 'net_assimilation')!.value).toBeCloseTo(Math.min(res!.result, wj.value) - 1.5, 6);
    expect(sec.find((s) => s.key === 'ci_ca_ratio')!.value).toBeCloseTo(250 / 400, 6);
    expect(sec.find((s) => s.key === 'gross_carboxylation')!.value).toBeCloseTo((80 * 250) / (250 + KCO), 6);
  });

  it('Wj / Rd / net assimilation are honest NaN when J / Rd not supplied', () => {
    const sec = computeEquation(54, { Vcmax: 80, ci: 250, GammaStar: 40, Kc: 300, Ko: 25000, O: 210000 })!.secondary ?? [];
    expect(Number.isNaN(sec.find((s) => s.key === 'electron_transport_limit')!.value)).toBe(true);
    expect(Number.isNaN(sec.find((s) => s.key === 'dark_respiration')!.value)).toBe(true);
    expect(Number.isNaN(sec.find((s) => s.key === 'net_assimilation')!.value)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(54, { Vcmax: '80', ci: '250', GammaStar: '40', Kc: '300', Ko: '25000', O: '210000' } as any);
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('honest NaN when core inputs missing', () => {
    expect(Number.isNaN(computeEquation(54, { Vcmax: NaN, ci: NaN, GammaStar: NaN, Kc: NaN, Ko: NaN, O: NaN })!.result)).toBe(true);
  });
});

// ── Tool 57 — Redfield Stoichiometry (Redfield 1934) ──
// C:N:P = 106:16:1 canonical (1958). Worked example: C=106, N=16, P=1 →
// C/N = 106/16 = 6.625, N:P = 16, C:P = 106.

describe('Tool 57 — Redfield Stoichiometry', () => {
  it('worked example: C=106, N=16, P=1 → C:N = 6.625, N:P = 16, C:P = 106', () => {
    const res = computeEquation(57, { C: 106, N: 16, P: 1 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(16, 6); // primary = N:P
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'cn_ratio')!.value).toBeCloseTo(6.625, 6);
    expect(sec.find((s) => s.key === 'cp_ratio')!.value).toBeCloseTo(106, 6);
    expect(sec.find((s) => s.key === 'np_ratio')!.value).toBeCloseTo(16, 6);
  });

  it('NO3-based carbon export: NO3s=10, NO3d=2 → C_export = 7·ΔNO₃ = 56 µmol C/L', () => {
    const sec = computeEquation(57, { C: 106, N: 16, P: 1, NO3s: 10, NO3d: 2 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'carbon_export')!.value).toBeCloseTo(7 * 8, 6);
    expect(sec.find((s) => s.key === 'carbon_export')!.unit).toBe('µmol C/L');
  });

  it('phosphate vs nitrate limitation flag: N:P < 16 → −1, N:P > 16 → +1', () => {
    const lim = (C: number, N: number, P: number) =>
      computeEquation(57, { C, N, P })!.secondary!.find((s) => s.key === 'limitation')!.value;
    expect(lim(100, 8, 1)).toBe(-1);   // nitrate-limited
    expect(lim(100, 32, 1)).toBe(1);   // phosphate-limited
  });

  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(57, { C: '106', N: '16', P: '1' } as any)!.result)).toBe(true);
  });

  it('zero preservation: P=0 → N:P is honest NaN (no ±Infinity), C:N still computable', () => {
    const res = computeEquation(57, { C: 106, N: 16, P: 0 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(res.secondary!.find((s) => s.key === 'cn_ratio')!.value).toBeCloseTo(6.625, 6);
  });

  it('honest NaN when C/N/P missing', () => {
    expect(Number.isNaN(computeEquation(57, { C: NaN, N: NaN, P: NaN })!.result)).toBe(true);
  });
});

// ── Tool 61 — FAO Yield Response to Water (Doorenbos & Kassam 1979, Eq. 1) ──
// (1 − Yₐ/Yₘ) = K_y·(1 − ETₐ/ETₘ). Worked example: K_y=1.1, ETₐ/ETₘ=0.7 →
// predicted reduction = 1.1·0.3 = 0.33.

describe('Tool 61 — FAO Yield Response to Water', () => {
  it('worked example: K_y=1.1, ETₐ/ETₘ=0.7 → predicted (1−Yₐ/Yₘ) = 0.33', () => {
    const res = computeEquation(61, { Ya: NaN, Ym: 10, Ky: 1.1, ETa: 7, ETm: 10 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1.1 * (1 - 0.7), 6);
    expect(res!.result).toBeCloseTo(0.33, 6);
  });

  it('standard-form algebra: observed Yₐ/Yₘ=0.8 is inconsistent with the 0.33 prediction — residual exposes it', () => {
    const res = computeEquation(61, { Ya: 8, Ym: 10, Ky: 1.1, ETa: 7, ETm: 10 });
    expect(res!.result).toBeCloseTo(0.33, 6); // predicted from Ky·(1−ETa/ETm)
    const residual = res!.secondary!.find((s) => s.key === 'residual')!.value;
    expect(residual).toBeCloseTo(0.2 - 0.33, 6); // observed loss 0.2 − predicted 0.33
  });

  it('exposes et_deficit, yield_reduction_pct and predicted_ya as secondary', () => {
    const sec = computeEquation(61, { Ya: NaN, Ym: 10, Ky: 1.1, ETa: 7, ETm: 10 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'et_deficit')!.value).toBeCloseTo(0.3, 6);
    expect(sec.find((s) => s.key === 'yield_reduction_pct')!.value).toBeCloseTo(33, 6);
    expect(sec.find((s) => s.key === 'predicted_ya')!.value).toBeCloseTo(6.7, 6);
  });

  it('zero preservation: full water supply (ETₐ=ETₘ) → zero reduction', () => {
    const res = computeEquation(61, { Ya: NaN, Ym: 10, Ky: 1.1, ETa: 10, ETm: 10 })!;
    expect(res.result).toBeCloseTo(0, 10);
  });

  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(61, { Ya: '8', Ym: '10', Ky: '1.1', ETa: '7', ETm: '10' } as any)!.result)).toBe(true);
  });

  it('honest NaN when core inputs missing', () => {
    expect(Number.isNaN(computeEquation(61, { Ya: NaN, Ym: NaN, Ky: NaN, ETa: NaN, ETm: NaN })!.result)).toBe(true);
  });
});

// ── Tool 62 — Eppley (1972) Temperature-Growth Envelope ──
// μmax = 0.59·e^(0.0633·T), Q₁₀ = e^(0.633) = 1.88. Worked example: T=20 →
// 0.59·e^(0.0633×20) = 0.59·e^1.266 = 2.09 /day.

describe('Tool 62 — Eppley Temperature-Growth Envelope', () => {
  it('worked example: T=20 → μ = 0.59·e^(0.0633·20) = 2.09 /day', () => {
    const res = computeEquation(62, { T: 20 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.59 * Math.exp(0.0633 * 20), 6);
    expect(res!.result).toBeCloseTo(2.09, 2);
    expect(res!.unit).toBe('/day');
  });

  it('species scaling through 20 °C: μ₂₀=0.8 → μ=0.8 at T=20, Q₁₀≈1.88 by T=30', () => {
    const at20 = computeEquation(62, { umax: 0.8, T: 20 })!;
    const at30 = computeEquation(62, { umax: 0.8, T: 30 })!;
    expect(at20.result).toBeCloseTo(0.8, 10);
    expect(at30.result).toBeCloseTo(0.8 * Math.exp(0.0633 * 10), 4);
    expect(at30.result / at20.result).toBeCloseTo(Math.exp(0.0633 * 10), 4);
  });

  it('exposes doubling_time, q10 and envelope_mu as secondary', () => {
    const sec = computeEquation(62, { T: 20 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'doubling_time')!.value).toBeCloseTo(Math.LN2 / (0.59 * Math.exp(0.0633 * 20)), 6);
    expect(sec.find((s) => s.key === 'q10')!.value).toBeCloseTo(Math.exp(0.0633 * 10), 6);
    expect(sec.find((s) => s.key === 'q10')!.value).toBeCloseTo(1.88, 2);
    expect(sec.find((s) => s.key === 'envelope_mu')!.value).toBeCloseTo(2.09, 2);
  });

  it('emits a timeseries μ vs T (vizType timeseries)', () => {
    const res = computeEquation(62, { T: 20 })!;
    expect(res.series).toBeDefined();
    expect(res.series![0].points.length).toBeGreaterThan(10);
    expect(res.series![0].points[20].x).toBe(20);
    expect(res.series![0].points[20].y).toBeCloseTo(res.result, 6);
  });

  it('zero preservation: T=0 → μ = 0.59 (envelope)', () => {
    expect(computeEquation(62, { T: 0 })!.result).toBeCloseTo(0.59, 6);
  });

  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(62, { T: '20' } as any)!.result)).toBe(true);
  });

  it('honest NaN when T missing', () => {
    expect(Number.isNaN(computeEquation(62, { T: NaN })!.result)).toBe(true);
  });
});

// ── Batch invariant: every secondary value is a number (finite or NaN), never null ──

describe('ecoCarbon batch — secondary invariant', () => {
  const cases = [
    [52, { I0: 2000, k: 0.5, LAI: 3 }],
    [54, { Vcmax: 80, ci: 250, GammaStar: 40, Kc: 300, Ko: 25000, O: 210000, J: 120, Rd: 1.5 }],
    [57, { C: 106, N: 16, P: 1, NO3s: 10, NO3d: 2 }],
    [61, { Ya: 8, Ym: 10, Ky: 1.1, ETa: 7, ETm: 10 }],
    [62, { T: 20 }],
  ] as const;

  it('all secondary values are numbers (Number.isFinite guard or NaN), never null', () => {
    for (const [id, inputs] of cases) {
      const res = computeEquation(id, inputs as any)!;
      for (const s of res.secondary ?? []) {
        expect(typeof s.value).toBe('number');
        expect(s.value).not.toBeNull();
      }
    }
  });

  it('NaN paths also expose numeric (NaN) secondary values, never null', () => {
    const nanCases = [
      [52, { I0: NaN, k: NaN, LAI: NaN }],
      [54, { Vcmax: NaN, ci: NaN, GammaStar: NaN, Kc: NaN, Ko: NaN, O: NaN }],
      [57, { C: NaN, N: NaN, P: NaN }],
      [61, { Ya: NaN, Ym: NaN, Ky: NaN, ETa: NaN, ETm: NaN }],
      [62, { T: NaN }],
    ] as const;
    for (const [id, inputs] of nanCases) {
      const res = computeEquation(id, inputs as any)!;
      expect(Number.isNaN(res.result)).toBe(true);
      for (const s of res.secondary ?? []) {
        expect(typeof s.value).toBe('number');
        expect(s.value).not.toBeNull();
      }
    }
  });
});
