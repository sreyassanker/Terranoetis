/**
 * Tool 71 — Osborn-Cox Fine-Structure Diffusivity (Osborn & Cox 1972)
 *
 * Cross-validated against the paper's Table 1 (San Diego Trough, 275–300 m):
 *   <(∂θ′/∂z)²> = 3.6×10⁻⁷ °C²/cm², ∂θ̄/∂z = 9×10⁻⁵ °C/cm, κ = 1.4×10⁻³ cm²/s
 *   → A = κ·<(∇θ′)²>/(∂θ̄/∂z)² = 0.062 cm²/s = 6.2×10⁻⁶ m²/s
 *   (paper Table 1: (2±1)×(0.06±0.01) cm²/s) ✓
 * Second row: <(∂θ′/∂z)²> = 1.9×10⁻⁷ → A = 0.033 cm²/s (paper: 0.03±0.007) ✓
 */
import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const run71 = (inputs: Record<string, number>) =>
  computeEquation(71, inputs)!;

describe('Tool 71 — Osborn-Cox Fine-Structure Diffusivity', () => {
  it('reproduces the paper Table 1 first row (San Diego Trough)', () => {
    // κ in m²/s: 1.4e-3 cm²/s = 1.4e-7 m²/s; <(∇θ′)²> = 3.6e-7 K²/cm² = 3.6e-3 K²/m²
    // ∂θ̄/∂z = 9e-5 K/cm = 9e-3 K/m
    const r = run71({ kappa: 1.4e-7, gradVar: 3.6e-3, dTdz: 9e-3 });
    // A = 1.4e-7 × 3.6e-3 / (9e-3)² = 6.222e-6 m²/s = 0.062 cm²/s
    expect(r.result).toBeCloseTo(6.222e-6, 9);
    expect(r.result * 1e4).toBeCloseTo(0.0622, 2);
  });

  it('reproduces the paper Table 1 second row', () => {
    const r = run71({ kappa: 1.4e-7, gradVar: 1.9e-3, dTdz: 9e-3 });
    expect(r.result * 1e4).toBeCloseTo(0.0328, 2); // 0.033 cm²/s vs paper 0.03±0.007
  });

  it('computes the companion Osborn (1980) K_ρ = γ·ε/N² as a secondary', () => {
    const r = run71({ kappa: 1.4e-7, gradVar: 3.6e-3, dTdz: 9e-3, gamma: 0.2, eps: 1e-8, N2: 1e-5 });
    const k = r.secondary?.find((s) => s.key === 'k_rho_osborn1980')?.value;
    expect(k).toBeCloseTo(2e-4, 10); // 0.2 × 1e-8 / 1e-5
  });

  it('returns honest NaN for missing microstructure variance (no fabricated default)', () => {
    const r = run71({ kappa: 1.4e-7, gradVar: Number.NaN, dTdz: 9e-3 });
    expect(Number.isNaN(r.result)).toBe(true);
  });

  it('returns honest NaN for missing ε in the companion method', () => {
    const r = run71({ kappa: 1.4e-7, gradVar: 3.6e-3, dTdz: 9e-3, gamma: 0.2, eps: Number.NaN, N2: 1e-5 });
    const k = r.secondary?.find((s) => s.key === 'k_rho_osborn1980')?.value;
    expect(Number.isNaN(k)).toBe(true);
    expect(Number.isFinite(r.result)).toBe(true); // primary fine-structure still computes
  });

  it('returns honest NaN for degenerate gradient (∂θ̄/∂z = 0, never Infinity)', () => {
    const r = run71({ kappa: 1.4e-7, gradVar: 3.6e-3, dTdz: 0 });
    expect(Number.isNaN(r.result)).toBe(true);
  });

  it('narrates the paper method (eq 25 + eq 5) in the steps', () => {
    const r = run71({ kappa: 1.4e-7, gradVar: 3.6e-3, dTdz: 9e-3 });
    expect(r.steps.join('\n')).toContain('Osborn & Cox, 1972');
    expect(r.steps.join('\n')).toContain('0.06 cm²/s');
    expect(r.steps.join('\n')).toContain('eq 25');
  });
});
