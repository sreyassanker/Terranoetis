import { describe, it, expect } from 'vitest';

// Stommel (1948), Trans. AGU 29(2):202-206.
// Model eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b) with α = D·β/R, γ = F·π/(R·b).
// Closed-form solution (19): ψ = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1)
//   A = −α/2 + √(α²/4 + (π/b)²), B = −α/2 − √(α²/4 + (π/b)²)
//   p = (1 − e^{BL})/(e^{AL} − e^{BL}), q = 1 − p   (ψ = 0 at x = 0 and x = L)
// Velocities (21)-(22): u = ∂ψ/∂y, v = −∂ψ/∂x.

function stommel(D: number, beta: number, b: number, L: number, R: number, F: number, x: number, y: number) {
  const alpha = (D * beta) / R;
  const gamma = (F * Math.PI) / (R * b);
  const root = Math.sqrt(alpha * alpha / 4 + (Math.PI / b) ** 2);
  const A = -alpha / 2 + root;
  const B = -alpha / 2 - root;
  const p = (1 - Math.exp(B * L)) / (Math.exp(A * L) - Math.exp(B * L));
  const q = 1 - p;
  const ex = Math.exp(A * x), eBx = Math.exp(B * x);
  const g = p * ex + q * eBx - 1;
  const psi = gamma * b * b / (Math.PI * Math.PI) * Math.sin(Math.PI * y / b) * g;
  const u = gamma * (b / Math.PI) * Math.cos(Math.PI * y / b) * g;
  const v = -gamma * b * b / (Math.PI * Math.PI) * Math.sin(Math.PI * y / b) * (p * A * ex + q * B * eBx);
  return { psi, u, v, alpha, gamma, A, B, p, q, g };
}

// Paper's numerical example (cgs): D = 2×10⁴ cm, b = 2π×10⁸ cm, L = 10⁹ cm,
// R = 0.02 s⁻¹, F = 1 dyne/cm², β = 10⁻¹³ s⁻¹cm⁻¹.
const D = 2e4, b = 2 * Math.PI * 1e8, L = 1e9, R = 0.02, F = 1, BETA = 1e-13;
const yMid = b / 2;
// solution magnitude scale (cm²/s)
const PSI_SCALE = (F * Math.PI / (R * b)) * b * b / (Math.PI * Math.PI); // = γ(b/π)² = 1e10

describe('Stommel 1948 westward intensification (paper cgs example)', () => {
  it('model parameters reproduce the paper: α = 1e-7 cm⁻¹ (δ = 100 km), γ = 2.5e-7 s⁻¹', () => {
    const s = stommel(D, BETA, b, L, R, F, 0, yMid);
    expect(s.alpha).toBeCloseTo(1e-7, 10);
    expect(1 / s.alpha).toBeCloseTo(1e7, 6); // cm
    expect(1 / s.alpha / 1e5).toBeCloseTo(100, 3); // km
    expect(s.gamma).toBeCloseTo(2.5e-7, 8);
  });

  it('separation constants: A ≈ 2.5e-10, B ≈ −1.0e-7 cm⁻¹ (|A| ≪ |B| — the asymmetry)', () => {
    const s = stommel(D, BETA, b, L, R, F, 0, yMid);
    expect(s.A).toBeCloseTo(2.49e-10, 5);
    expect(s.B).toBeCloseTo(-1.0025e-7, 5);
    expect(Math.abs(s.B) / Math.abs(s.A)).toBeGreaterThan(100);
  });

  it('boundary conditions: ψ(0,y) = 0 and ψ(L,y) = 0 (paper eq 10) — to the solution scale', () => {
    expect(Math.abs(stommel(D, BETA, b, L, R, F, 0, yMid).psi) / PSI_SCALE).toBeLessThan(1e-12);
    expect(Math.abs(stommel(D, BETA, b, L, R, F, L, yMid).psi) / PSI_SCALE).toBeLessThan(1e-12);
    expect(Math.abs(stommel(D, BETA, b, L, R, F, 0.5 * L, 0).psi) / PSI_SCALE).toBeLessThan(1e-12);
    expect(Math.abs(stommel(D, BETA, b, L, R, F, 0.5 * L, b).psi) / PSI_SCALE).toBeLessThan(1e-12);
  });

  it('the northward jet is strong at the western boundary (~220 cm/s) and decays > 50% within 100 km (paper: up to 240 cm/s, WBC < 100 km)', () => {
    const vWest = stommel(D, BETA, b, L, R, F, 0, yMid).v;
    const v100km = stommel(D, BETA, b, L, R, F, 1e7, yMid).v;
    expect(vWest).toBeGreaterThan(180);
    expect(vWest).toBeLessThan(300);
    expect(v100km).toBeGreaterThan(0);
    expect(v100km).toBeLessThan(vWest / 2); // rapid decay away from the boundary
    // interior flow is weak and (at mid-basin) southward
    expect(Math.abs(stommel(D, BETA, b, L, R, F, 0.5 * L, yMid).v)).toBeLessThan(10);
  });

  it('westward intensification: the transport maximum sits in the west; the east mirror point is ~11× weaker', () => {
    // |ψ| maximum is at x* where g'(x*) = 0
    const s = stommel(D, BETA, b, L, R, F, 0, yMid);
    const xStar = Math.log(-s.q * s.B / (s.p * s.A)) / (s.A - s.B); // ≈ 471 km from the west
    expect(xStar).toBeGreaterThan(0);
    expect(xStar).toBeLessThan(L / 10);
    const psiWest = Math.abs(stommel(D, BETA, b, L, R, F, xStar, yMid).psi);
    const psiEast = Math.abs(stommel(D, BETA, b, L, R, F, L - xStar, yMid).psi);
    expect(psiWest / psiEast).toBeGreaterThan(5); // measured ≈ 11
  });

  it('β = 0 (non-rotating case, paper Fig 2): symmetric — A = −B and east-west symmetry', () => {
    const s = stommel(D, 0, b, L, R, F, 0, yMid);
    expect(s.A).toBeCloseTo(-s.B, 12); // A = π/b, B = −π/b
    const west = Math.abs(stommel(D, 0, b, L, R, F, 5e6, yMid).psi);
    const east = Math.abs(stommel(D, 0, b, L, R, F, L - 5e6, yMid).psi);
    expect(west / east).toBeCloseTo(1, 2);
  });
});
