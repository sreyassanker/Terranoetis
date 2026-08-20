import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// Stommel (1961) "Thermohaline convection with two stable regimes of flow",
// Tellus 13(2):224–230. Verified anchors:
//  - Equilibrium: y = 1/(1+|f|), x = δ/(δ+|f|), λ·f = Rx − y
//  - Paper fig 6/7 example R=2, δ=1/6, λ=1/5 → three roots f ≈ −1.1, −0.30, +0.23
//    (a = stable node, b = saddle, c = stable spiral) — TWO stable regimes
//  - Necessary condition for three equilibria: R·δ < 1 for R > 1
//  - R = 2, δ = 1 → single stable regime (paper fig 8)

describe('Tool 69 — Stommel two-vessel thermohaline model (Stommel 1961)', () => {
  it('paper fig-6/7 example: R=2, δ=1/6, λ=1/5 → roots ≈ −1.1, −0.30, +0.23', () => {
    const res = computeEquation(69, { lambda: 0.2, delta: 1 / 6, R: 2 });
    expect(res).not.toBeNull();
    const sec = res!.secondary ?? [];
    const flows = sec.map((s) => s.value as number).sort((a, b) => a - b);
    expect(flows.length).toBe(3);
    expect(flows[0]).toBeCloseTo(-1.1, 1);
    expect(flows[1]).toBeCloseTo(-0.3, 1);
    expect(flows[2]).toBeCloseTo(0.23, 1);
  });

  it('paper fig-7 stability: a = stable node (f<0), b = saddle, c = stable spiral (f>0) → TWO stable regimes', () => {
    const res = computeEquation(69, { lambda: 0.2, delta: 1 / 6, R: 2 });
    const sec = res!.secondary ?? [];
    const labels = sec.map((s) => s.label as string).join(' | ');
    expect(res!.result).toBe(2); // number of stable regimes
    expect(labels).toMatch(/stable node/);
    expect(labels).toMatch(/saddle/);
    expect(labels).toMatch(/stable spiral/);
    // paper: f = −1.1 stable node (temperature-dominated, f < 0)
    const negNode = sec.find((s) => (s.value as number) < -0.5);
    expect(negNode!.label).toMatch(/stable node/);
    // paper: f = +0.23 stable spiral (salinity-dominated, f > 0)
    const posSpiral = sec.find((s) => (s.value as number) > 0);
    expect(posSpiral!.label).toMatch(/stable spiral/);
  });

  it('paper fig-8 case: R=2, δ=1, λ=1/5 → single stable regime', () => {
    const res = computeEquation(69, { lambda: 0.2, delta: 1, R: 2 });
    expect(res).not.toBeNull();
    expect(res!.result).toBe(1);
  });

  it('three-equilibria condition: R·δ < 1 for R > 1 (paper §5)', () => {
    // R=2, δ=1/6 → R·δ = 1/3 < 1 → three roots possible (with small λ)
    const three = computeEquation(69, { lambda: 0.2, delta: 1 / 6, R: 2 });
    expect((three!.secondary ?? []).length).toBe(3);
    // R=2, δ=1 → R·δ = 2 > 1 → single root
    const one = computeEquation(69, { lambda: 0.2, delta: 1, R: 2 });
    expect((one!.secondary ?? []).length).toBe(1);
  });

  it('equilibrium algebra: y = 1/(1+|f|), x = δ/(δ+|f|), λ·f = Rx − y holds at each root', () => {
    const res = computeEquation(69, { lambda: 0.2, delta: 1 / 6, R: 2 });
    const sec = res!.secondary ?? [];
    for (const s of sec) {
      const f = s.value as number;
      const y = 1 / (1 + Math.abs(f));
      const x = (1 / 6) / (1 / 6 + Math.abs(f));
      expect(0.2 * f).toBeCloseTo(2 * x - y, 4);
    }
  });

  it('honest NaN for degenerate parameters (λ ≤ 0)', () => {
    const res = computeEquation(69, { lambda: 0, delta: 1 / 6, R: 2 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('paper §6 hysteresis narrative present: λ increase annihilates the temperature-dominated branch', () => {
    const res = computeEquation(69, { lambda: 0.2, delta: 1 / 6, R: 2 });
    const steps = res!.steps.join(' ');
    expect(steps).toMatch(/hysteresis/i);
    expect(steps).toMatch(/−1\.1/); // paper roots quoted in steps
    expect(steps).toMatch(/stable spiral/);
  });
});
