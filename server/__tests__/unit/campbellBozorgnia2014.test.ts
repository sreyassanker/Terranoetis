import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';
import { cb2014RuptureWidth, cb2014MeanLnPGA, vs30FromSlope } from '../../data/campbellBozorgnia2014';

describe('Tool 21 — Campbell-Bozorgnia NGA-West2 GMPE', () => {
  // Magnitude scaling is monotonic: bigger earthquake → higher PGA
  it('larger magnitude → higher PGA (same distance/site)', () => {
    const m6 = computeEquation(21, { mag: 6.0, rrup: 20, rjb: 15, rx: 5, vs30: 760, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    const m7 = computeEquation(21, { mag: 7.0, rrup: 20, rjb: 15, rx: 5, vs30: 760, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    expect(m7!.result).toBeGreaterThan(m6!.result);
  });

  // Distance attenuation: closer → higher PGA
  it('shorter distance → higher PGA (same magnitude/site)', () => {
    const near = computeEquation(21, { mag: 6.5, rrup: 10, rjb: 8, rx: 5, vs30: 760, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    const far = computeEquation(21, { mag: 6.5, rrup: 100, rjb: 95, rx: 5, vs30: 760, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    expect(near!.result).toBeGreaterThan(far!.result * 5);
  });

  // Soft site amplifies vs rock (nonlinear site term)
  it('soft soil (Vs30=360) amplifies PGA vs rock (Vs30=1100)', () => {
    const soft = computeEquation(21, { mag: 6.5, rrup: 20, rjb: 15, rx: 5, vs30: 360, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    const rock = computeEquation(21, { mag: 6.5, rrup: 20, rjb: 15, rx: 5, vs30: 1100, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    expect(soft!.result).toBeGreaterThan(rock!.result);
  });

  // Normal faulting (rake −90, c9 = −0.212) produces lower PGA than
  // strike-slip (rake 0) — the CB2014 PGA row has c8 = 0 (reverse has no
  // median effect) but c9 < 0 (normal faulting reduces median PGA).
  it('normal faulting (rake −90) → lower PGA than strike-slip (rake 0)', () => {
    const norm = computeEquation(21, { mag: 5.5, rrup: 20, rjb: 15, rx: 5, vs30: 760, rake: -90, dip: 90, ztor: 1, width: 10, hypoDepth: 8 });
    const ss = computeEquation(21, { mag: 5.5, rrup: 20, rjb: 15, rx: 5, vs30: 760, rake: 0, dip: 90, ztor: 1, width: 10, hypoDepth: 8 });
    expect(norm!.result).toBeLessThan(ss!.result);
  });

  // Physically-plausible range: M7 at 10 km rock ≈ 0.27 g
  it('M7 at 10 km on rock → PGA ≈ 0.27 g (physically plausible)', () => {
    const res = computeEquation(21, { mag: 7.0, rrup: 10, rjb: 10, rx: 5, vs30: 1100, rake: 90, dip: 60, ztor: 1, width: 12, hypoDepth: 8 });
    expect(res!.result).toBeGreaterThan(0.15);
    expect(res!.result).toBeLessThan(0.5);
    expect(res!.unit).toBe('g');
  });

  // Secondary outputs: MMI, PGA in cm/s², ln(PGA), reference-rock PGA
  it('exposes mmi, pga_cm, ln_pga and pga_rock as secondary', () => {
    const res = computeEquation(21, { mag: 6.5, rrup: 20, rjb: 15, rx: 5, vs30: 760, rake: 0, dip: 60, ztor: 1, width: 10, hypoDepth: 8 });
    const sec = res!.secondary ?? [];
    const mmi = sec.find((s) => s.key === 'mmi');
    const pgaCm = sec.find((s) => s.key === 'pga_cm');
    const lnPGA = sec.find((s) => s.key === 'ln_pga');
    expect(mmi?.value).toBeGreaterThan(0);
    expect(pgaCm?.value).toBeCloseTo(res!.result * 980.665, 6);
    expect(lnPGA?.value).toBeCloseTo(Math.log(res!.result), 6);
  });

  // String-input regression (numeric coercion)
  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(21, {
      mag: '6.5', rrup: '20', rjb: '15', rx: '5', vs30: '760',
      rake: '0', dip: '60', ztor: '1', width: '10', hypoDepth: '8',
    } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  // Honest NaN: missing rupture/site parameters → no fabricated PGA
  it('returns honest NaN when a genuine input is missing (no fabricated PGA)', () => {
    const res = computeEquation(21, { mag: Number.NaN, rrup: Number.NaN, rjb: Number.NaN, vs30: Number.NaN, rake: Number.NaN, dip: Number.NaN, ztor: Number.NaN, width: Number.NaN, hypoDepth: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  // Param aliases: M→mag, R_rup→rrup, V_s30→vs30, λ→rake, D_ip→dip, etc.
  it('param aliases wire frontend symbols correctly', () => {
    const normalized = normalizeInputs(21, { M: 6.5, R_rup: 20, R_jb: 15, R_x: 5, V_s30: 760, λ: 0, D_ip: 60, Z_tor: 1, W_id: 10, H_d: 8 } as unknown as Record<string, number>);
    expect(normalized['mag']).toBe(6.5);
    expect(normalized['rrup']).toBe(20);
    expect(normalized['vs30']).toBe(760);
    expect(normalized['rake']).toBe(0);
    expect(normalized['dip']).toBe(60);
    expect(normalized['ztor']).toBe(1);
    expect(normalized['hypoDepth']).toBe(8);
  });

  // Helper functions: Vs30 from slope (Wald & Allen 2007) and CB14 Eq. 39 width
  it('vs30FromSlope: flat ground → ~360 m/s (NEHRP C/D boundary)', () => {
    expect(vs30FromSlope(0)).toBeCloseTo(360, 6);
  });
  it('cb2014RuptureWidth (Eq. 39): larger M → larger width', () => {
    const w6 = cb2014RuptureWidth(6.0, 60, 1);
    const w7 = cb2014RuptureWidth(7.0, 60, 1);
    expect(w7).toBeGreaterThan(w6);
  });
  it('cb2014MeanLnPGA returns finite values for valid inputs', () => {
    const ln = cb2014MeanLnPGA({ mag: 5.0, rrup: 20, rjb: 20, rx: 10, vs30: 800, rake: 0, dip: 90, ztor: 0, width: 10, hypoDepth: 8 });
    expect(Number.isFinite(ln)).toBe(true);
  });
});
