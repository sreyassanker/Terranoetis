import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 69 — Stommel (1961) Two-Vessel Thermohaline Model ───────────
// dx/dt = δ(1−x) − |f|x, dy/dt = (1−y) − |f|y, λ·f = Rx − y.
// Paper fig 6/7 example: R=2, δ=1/6, λ=1/5 → three roots
// f ≈ −1.1 (stable node), −0.30 (saddle), +0.23 (stable spiral) — TWO
// stable regimes (the paper's title).

describe('Tool 69 — Stommel Thermohaline Model', () => {
  it('paper example: R=2, δ=1/6, λ=1/5 → TWO stable regimes', () => {
    const res = computeEquation(69, { lambda: 1 / 5, delta: 1 / 6, R: 2 });
    expect(res).not.toBeNull();
    expect(res!.result).toBe(2);
    expect(res!.unit).toBe('stable regimes');
  });

  it('roots match the paper: f ≈ −1.07 (stable node), −0.31 (saddle), +0.22 (stable spiral)', () => {
    const res = computeEquation(69, { lambda: 1 / 5, delta: 1 / 6, R: 2 });
    const roots = res!.secondary!.map((s) => s.value).sort((a, b) => a - b);
    expect(roots.length).toBe(3);
    expect(roots[0]).toBeCloseTo(-1.07, 1);
    expect(roots[1]).toBeCloseTo(-0.31, 1);
    expect(roots[2]).toBeCloseTo(0.22, 1);
    // stability labels
    const labels = res!.secondary!.map((s) => s.label);
    expect(labels[0]).toContain('stable node');
    expect(labels[1]).toContain('saddle');
    expect(labels[2]).toContain('stable spiral');
  });

  it('large λ collapses to a single stable regime', () => {
    const res = computeEquation(69, { lambda: 2, delta: 1 / 6, R: 2 });
    expect(res!.result).toBe(1);
  });

  it('non-positive parameters → honest NaN (degenerate)', () => {
    const res = computeEquation(69, { lambda: 0, delta: 1 / 6, R: 2 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(69, { lambda: '0.2', delta: '0.1667', R: '2' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});
