import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 131 — Thiem Steady Radial Flow (1906) ──────────────────────
// Q = 2π·T·(h₂−h₁)/ln(r₂/r₁). Worked example: T=500 m²/day, h₁=20, h₂=25,
// r₁=100, r₂=1000 → Q = 2π·500·5/ln(10) = 6821.9 m³/day.

describe('Tool 131 — Thiem Steady Radial Flow', () => {
  it('worked example: T=500, h₁=20, h₂=25, r₁=100, r₂=1000 → Q ≈ 6821.9 m³/day', () => {
    const res = computeEquation(131, { T: 500, h1: 20, h2: 25, r1: 100, r2: 1000 });
    expect(res).not.toBeNull();
    const expected = (2 * Math.PI * 500 * 5) / Math.log(1000 / 100);
    expect(res!.result).toBeCloseTo(expected, 4);
    expect(res!.unit).toBe('m³/day');
  });

  it('exposes drawdown and transmissivity as secondary', () => {
    const res = computeEquation(131, { T: 500, h1: 20, h2: 25, r1: 100, r2: 1000 });
    const sec = res!.secondary ?? [];
    const dd = sec.find((s) => s.key === 'drawdown');
    const tr = sec.find((s) => s.key === 'transmissivity');
    expect(dd?.value).toBeCloseTo(5, 6);
    expect(tr?.value).toBeCloseTo(500, 6);
  });

  it('guards r₂ > r₁ > 0 — returns honest NaN when r₁ ≥ r₂', () => {
    const res = computeEquation(131, { T: 500, h1: 20, h2: 25, r1: 1000, r2: 100 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(131, { T: Number.NaN, h1: Number.NaN, h2: Number.NaN, r1: Number.NaN, r2: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(131, { T: '500', h1: '20', h2: '25', r1: '100', r2: '1000' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo((2 * Math.PI * 500 * 5) / Math.log(10), 4);
  });
});

// ── Tool 135 — UNISDR Disaster Risk (2004) ──────────────────────────
// Risk = Hazard × Vulnerability × Exposure. Worked example:
// H=0.5, V=0.4, E=0.6 → 0.12.

describe('Tool 135 — UNISDR Disaster Risk', () => {
  it('worked example: H=0.5, V=0.4, E=0.6 → Risk 0.12', () => {
    const res = computeEquation(135, { H: 0.5, V: 0.4, E: 0.6 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.12, 6);
    expect(res!.unit).toBe('—');
  });

  it('preserves zero (any zero component → zero risk)', () => {
    const res = computeEquation(135, { H: 0.5, V: 0, E: 0.6 });
    expect(res!.result).toBe(0);
  });

  it('exposes hazard, vulnerability, exposure, risk_class as secondary', () => {
    const res = computeEquation(135, { H: 0.5, V: 0.4, E: 0.6 });
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'hazard')?.value).toBeCloseTo(0.5, 6);
    expect(sec.find((s) => s.key === 'vulnerability')?.value).toBeCloseTo(0.4, 6);
    expect(sec.find((s) => s.key === 'exposure')?.value).toBeCloseTo(0.6, 6);
    // Risk 0.12 < 0.3 → class 1 (Moderate)
    expect(sec.find((s) => s.key === 'risk_class')?.value).toBe(1);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(135, { H: Number.NaN, V: Number.NaN, E: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(135, { H: '0.5', V: '0.4', E: '0.6' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.12, 6);
  });
});

// ── Tool 136 — Expected Annual Damage (USACE EM 1110-2-1619) ────────
// EAD = ∫ D(P)·dP over the exceedance-probability range with the code's
// power-law convention D(P) = D₁₀₀×(P/0.01)^(−α), α = 0.8.
// Analytic: EAD = D₁₀₀·P_ref^α·[P^(1−α)]/(1−α) evaluated over [pLo, pHi].

describe('Tool 136 — Expected Annual Damage', () => {
  it('worked example (power-law convention): D₁₀₀=1e6, P∈[0.001,0.5] → EAD ≈ 7.78e4 $/yr', () => {
    const res = computeEquation(136, { D_P: 1e6, P_low: 0.001, P_high: 0.5, num_intervals: 1000 });
    expect(res).not.toBeNull();
    const alpha = 0.8, P_ref = 0.01;
    const expected = 1e6 * Math.pow(P_ref, alpha) *
      (Math.pow(0.5, 1 - alpha) - Math.pow(0.001, 1 - alpha)) / (1 - alpha);
    // relative error < 0.2%
    expect(Math.abs(res!.result - expected) / expected).toBeLessThan(0.002);
    expect(res!.unit).toBe('$/yr');
  });

  it('exposes annual_loss, max_damage, return_period_damage as secondary', () => {
    const res = computeEquation(136, { D_P: 1e6, P_low: 0.001, P_high: 0.5 });
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'annual_loss')?.value).toBeCloseTo(res!.result, 6);
    expect(sec.find((s) => s.key === 'max_damage')?.value).toBeCloseTo(1e6, 6);
    expect(sec.find((s) => s.key === 'return_period_damage')?.value).toBeCloseTo(1e6 * Math.pow(0.1, -0.8), 6); // 1000-yr
  });

  it('preserves zero damage (D_P = 0 → EAD = 0)', () => {
    const res = computeEquation(136, { D_P: 0, P_low: 0.001, P_high: 0.5 });
    expect(res).not.toBeNull();
    expect(res!.result).toBe(0);
  });

  it('returns honest NaN when D_P is missing (no fabricated $1e6 default)', () => {
    const res = computeEquation(136, { D_P: Number.NaN, P_low: 0.001, P_high: 0.5 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('emits a damage-vs-exceedance series', () => {
    const res = computeEquation(136, { D_P: 1e6, P_low: 0.001, P_high: 0.5 });
    const series = res!.series ?? [];
    expect(series.length).toBeGreaterThan(0);
    expect(series[0].points.length).toBeGreaterThan(10);
    expect(series[0].points[0].x).toBeCloseTo(0.001, 3);
    expect(series[0].points[0].y).toBeGreaterThan(1e6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(136, { D_P: '1e6', P_low: '0.001', P_high: '0.5', num_intervals: '100' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});

// ── Tool 137 — EPA AQI Breakpoint Interpolation (40 CFR 50 App. G) ──
// AQI = (I_Hi−I_Lo)/(BP_Hi−BP_Lo)·(C−BP_Lo)+I_Lo.
// Worked example (PM2.5): C=55 in band [35.4,55.4]→[101,150] → AQI=149.02.

describe('Tool 137 — EPA AQI Breakpoint', () => {
  it('worked example: C=55 in [35.4,55.4]→[101,150] → AQI 149.02', () => {
    const res = computeEquation(137, { IHi: 150, ILo: 101, BPHi: 55.4, BPLo: 35.4, Cp: 55 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(149.02, 6);
    expect(res!.unit).toBe('—');
  });

  it('exposes breakpoint_band, pollutant_category, health_label as secondary', () => {
    const res = computeEquation(137, { IHi: 150, ILo: 101, BPHi: 55.4, BPLo: 35.4, Cp: 55 });
    const sec = res!.secondary ?? [];
    // AQI 149.02 → band index 2 (101–150), health class 2, PM2.5 band matched → 1
    expect(sec.find((s) => s.key === 'breakpoint_band')?.value).toBe(2);
    expect(sec.find((s) => s.key === 'pollutant_category')?.value).toBe(1);
    expect(sec.find((s) => s.key === 'health_label')?.value).toBe(2);
  });

  it('health_label numeric class tracks AQI category boundaries', () => {
    const res = computeEquation(137, { IHi: 50, ILo: 0, BPHi: 12.0, BPLo: 0, Cp: 6 });
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'health_label')?.value).toBe(0); // GOOD
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(137, { IHi: Number.NaN, ILo: Number.NaN, BPHi: Number.NaN, BPLo: Number.NaN, Cp: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('emits an AQI-vs-concentration series across the band', () => {
    const res = computeEquation(137, { IHi: 150, ILo: 101, BPHi: 55.4, BPLo: 35.4, Cp: 55 });
    const series = res!.series ?? [];
    expect(series.length).toBeGreaterThan(0);
    expect(series[0].points.length).toBeGreaterThan(10);
    expect(series[0].points[0].y).toBeCloseTo(101, 4); // at BPLo → ILo
    expect(series[0].points[series[0].points.length - 1].y).toBeCloseTo(150, 4); // at BPHi → IHi
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(137, { IHi: '150', ILo: '101', BPHi: '55.4', BPLo: '35.4', Cp: '55' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(149.02, 6);
  });
});

// ── Tool 138 — Probable Maximum Precipitation (Hershfield/Chow 1964) ─
// PMP = X̄ + K_p·σ_x. Worked example: X̄=50, K_p=10, σ_x=20 → 250 mm.

describe('Tool 138 — Probable Maximum Precipitation', () => {
  it('worked example: X̄=50, K_p=10, σ_x=20 → PMP 250 mm', () => {
    const res = computeEquation(138, { Xbar: 50, Kp: 10, sigmaX: 20 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(250, 6);
    expect(res!.unit).toBe('mm');
  });

  it('exposes standard_deviation and frequency_factor as secondary', () => {
    const res = computeEquation(138, { Xbar: 50, Kp: 10, sigmaX: 20 });
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'standard_deviation')?.value).toBeCloseTo(20, 6);
    expect(sec.find((s) => s.key === 'frequency_factor')?.value).toBeCloseTo(10, 6);
  });

  it('preserves zero (X̄=0, σ_x=0 → PMP 0)', () => {
    const res = computeEquation(138, { Xbar: 0, Kp: 10, sigmaX: 0 });
    expect(res).not.toBeNull();
    expect(res!.result).toBe(0);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(138, { Xbar: Number.NaN, Kp: Number.NaN, sigmaX: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(138, { Xbar: '50', Kp: '10', sigmaX: '20' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(250, 6);
  });
});

// ── Tool 139 — Palmer Drought Severity Index (1965) ─────────────────
// X_i = 0.897·X_{i-1} + Z_i/3. Worked example: X_{i-1}=2, Z_i=3 → 2.794.

describe('Tool 139 — Palmer Drought Severity Index', () => {
  it('worked example: X_{i-1}=2, Z_i=3 → X_i 2.794', () => {
    const res = computeEquation(139, { Xim1: 2, Zi: 3 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.897 * 2 + 3 / 3, 6);
    expect(res!.unit).toBe('—');
  });

  it('keeps drought_classification and persistence_factor secondary keys', () => {
    const res = computeEquation(139, { Xim1: 2, Zi: 3 });
    const sec = res!.secondary ?? [];
    const cls = sec.find((s) => s.key === 'drought_classification');
    const pers = sec.find((s) => s.key === 'persistence_factor');
    expect(cls?.value).toBeCloseTo(0.897 * 2 + 3 / 3, 6);
    expect(cls?.label).toMatch(/Slight Wet|Near Normal|Moderate Wet/);
    expect(pers?.value).toBeCloseTo(0.897, 6);
  });

  it('clamps to Palmer bounds [−10, +10]', () => {
    const res = computeEquation(139, { Xim1: 9.9, Zi: 30 });
    expect(res!.result).toBeLessThanOrEqual(10);
    const res2 = computeEquation(139, { Xim1: -9.9, Zi: -30 });
    expect(res2!.result).toBeGreaterThanOrEqual(-10);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(139, { Xim1: Number.NaN, Zi: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(139, { Xim1: '2', Zi: '3' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.897 * 2 + 3 / 3, 6);
  });
});

// ── Tool 140 — Froehlich Dam Breach (2008) ──────────────────────────
// B_avg = 0.1803·K₀·V_res^0.32·h_b^0.19. Worked example: K₀=1.3, V_res=1e7,
// h_b=20 → B_avg ≈ 72.0 m; Q_p = 3.1·B·h^1.5 ≈ 2.0e4 m³/s.

describe('Tool 140 — Froehlich Dam Breach', () => {
  it('worked example: K₀=1.3, V_res=1e7, h_b=20 → B_avg ≈ 72.0 m', () => {
    const res = computeEquation(140, { K0: 1.3, Vres: 1e7, hb: 20 });
    expect(res).not.toBeNull();
    const expected = 0.1803 * 1.3 * Math.pow(1e7, 0.32) * Math.pow(20, 0.19);
    expect(res!.result).toBeCloseTo(expected, 4);
    expect(res!.unit).toBe('m');
    // physically plausible width
    expect(res!.result).toBeGreaterThan(10);
    expect(res!.result).toBeLessThan(500);
  });

  it('keeps peak_outflow, breach_formation_time, breach_factor_k1 secondary keys', () => {
    const res = computeEquation(140, { K0: 1.3, Vres: 1e7, hb: 20 });
    const sec = res!.secondary ?? [];
    const B = res!.result;
    const qp = sec.find((s) => s.key === 'peak_outflow');
    const tf = sec.find((s) => s.key === 'breach_formation_time');
    const k1 = sec.find((s) => s.key === 'breach_factor_k1');
    expect(qp?.value).toBeCloseTo(3.1 * B * Math.pow(20, 1.5), 4);
    expect(tf?.value).toBeCloseTo(0.0179 * 1.0 * Math.pow(1e7, 0.34) * Math.pow(20, -0.14), 4); // K₀=1.3 → overtopping K₁=1
    expect(k1?.value).toBe(1);
  });

  it('selects piping K₁=1.5 when K₀ > 1.3', () => {
    const res = computeEquation(140, { K0: 2.0, Vres: 1e7, hb: 20 });
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'breach_factor_k1')?.value).toBe(1.5);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(140, { K0: Number.NaN, Vres: Number.NaN, hb: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(140, { K0: '1.3', Vres: '1e7', hb: '20' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});
