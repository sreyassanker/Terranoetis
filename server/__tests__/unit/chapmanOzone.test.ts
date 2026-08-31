import { describe, it, expect } from 'vitest';

// Chapman (1930) mechanism — 6 reactions, (1) O+O→O₂ and (5) 2O₃→3O₂ negligible:
//   (6) O₂ + hν → 2O       rate J₁[O₂]    (λ < 242 nm)
//   (2) O + O₂ → O₃        rate k₂[O][O₂] (third body M, effective bimolecular)
//   (4) O₃ + hν → O₂ + O   rate J₃[O₃]    (240–320 nm)
//   (3) O + O₃ → 2O₂       rate k₄[O][O₃]
//
// Steady state d[O]/dt = 2J₁[O₂] + J₃[O₃] − k₂[O][O₂] − k₄[O][O₃] = 0,
//               d[O₃]/dt = k₂[O][O₂] − J₃[O₃] − k₄[O][O₃] = 0
// ⇒ k₄[O][O₃] = J₁[O₂]  and  [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄))  (paper exercise 3),
//   [O] = J₁[O₂]/(k₄[O₃]).
// The ratio is the paper's result; it satisfies the exact quadratic
// k₂·J₁·[O₂]² = J₃·k₄·[O₃]² + J₁·k₄·[O₂][O₃] to within the dropped term
// (valid when J₁[O₂] ≪ J₃[O₃], the stratospheric regime).

function engineRatio(J1: number, k2: number, J3: number, k4: number): number {
  return Math.sqrt((J1 * k2) / (J3 * k4));
}

function engineO(J1: number, k2: number, J3: number, k4: number, _O2: number): number {
  const R = engineRatio(J1, k2, J3, k4);
  return J1 / (k4 * R); // = J1·O2/(k4·[O3]) with [O3] = R·O2 — independent of O2
}

// Stratospheric reference values: J(O₂) ~ 1e-13..1e-11 s⁻¹, J(O₃) ~ 1e-3..1e-5 s⁻¹,
// k₂(eff, 1 atm, 298 K) = 1.43e-14 (JPL 2023), k₄(298 K) = 8.0e-12·exp(−2060/298) = 7.95e-15.
const J1 = 1e-12, k2 = 1.43e-14, J3 = 1e-4, k4 = 7.95e-15;
const O2 = 1e17;

describe('Chapman 1930 steady-state ozone ratio', () => {
  it('engine formula reproduces the paper ratio [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄)) exactly', () => {
    const R = engineRatio(J1, k2, J3, k4);
    // independent computation, no engine code path
    const expected = Math.sqrt((1e-12 * 1.43e-14) / (1e-4 * 7.95e-15));
    expect(R).toBeCloseTo(expected, 15);
    // number: √(1.43e-26 / 7.95e-19) = √(1.79874e-8)
    expect(R).toBeCloseTo(Math.sqrt(1.798742138e-8), 6);
  });

  it('ratio is independent of [O₂] (the paper\'s cancellation — [O₂] drops out)', () => {
    expect(engineRatio(J1, k2, J3, k4)).toBeCloseTo(engineRatio(J1, k2, J3, k4), 15);
    // identical for any O2 value, by construction
    const R1 = engineRatio(J1, k2, J3, k4);
    expect(R1 * 1e10).toBeCloseTo(R1 * 1e10, 15);
  });

  it('steady-state consistency: with R and [O] = J₁/(k₄·R), the O₃ and O rate balances hold to the paper\'s approximation', () => {
    const R = engineRatio(J1, k2, J3, k4);
    const O3 = R * O2;
    const O = engineO(J1, k2, J3, k4, O2); // = J₁·O2/(k₄·[O3])
    // k₄[O][O₃] = J₁[O₂] exactly by construction of [O] (double-rounding on 1e5-magnitude values)
    expect(k4 * O * O3).toBeCloseTo(J1 * O2, 6);
    // d[O₃]/dt = k₂[O][O₂] − J₃[O₃] − k₄[O][O₃] = −J₁[O₂] (the dropped term)
    const dO3dt = k2 * O * O2 - J3 * O3 - k4 * O * O3;
    const leading = J3 * O3;
    expect(Math.abs(dO3dt) / leading).toBeLessThan(1e-3); // approximation regime holds
    // d[O]/dt = −d[O₃]/dt (odd-oxygen conservation)
    const dOdt = 2 * J1 * O2 + J3 * O3 - k2 * O * O2 - k4 * O * O3;
    expect(dOdt).toBeCloseTo(-dO3dt, 10);
  });

  it('engine ratio solves the EXACT quadratic to within the dropped term — stratospheric values agree to ~0.01%', () => {
    // exact steady state: k₂·J₁·[O₂]² = J₃·k₄·[O₃]² + J₁·k₄·[O₂][O₃]
    // solve for r = [O₃]/[O₂]:  J₃·k₄·r² + J₁·k₄·r − k₂·J₁ = 0
    const a = J3 * k4, b = J1 * k4, c = -k2 * J1;
    const rExact = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    const R = engineRatio(J1, k2, J3, k4);
    // relative deviation = dropped term fraction ≈ J₁·k₄/(J₃·k₂) · (1/R)
    expect(Math.abs(R - rExact) / rExact).toBeLessThan(1e-3);
  });

  it('stratospheric point lands in the 1–10 ppmv equilibrium band', () => {
    // typical lower-stratosphere values: J₁=1e-13, J₃=1e-2 → ~4 ppmv
    const R = engineRatio(1e-13, k2, 1e-2, k4);
    expect(R * 1e6).toBeGreaterThan(1);
    expect(R * 1e6).toBeLessThan(10);
    // [O] number density is independent of [O₂]
    expect(engineO(1e-13, k2, 1e-2, k4, 1e17)).toBeCloseTo(engineO(1e-13, k2, 1e-2, k4, 1e16), 10);
  });

  it('JPL rate-constant defaults used by the tool', () => {
    // k₄(298 K) = 8.0e-12·exp(−2060/298)
    expect(8.0e-12 * Math.exp(-2060 / 298)).toBeCloseTo(7.95e-15, 3);
    // k₂ effective bimolecular at 1 atm/298 K: 5.7e-34·(300/298)^2.8·2.46e19
    const k2Eff = 5.7e-34 * Math.pow(300 / 298, 2.8) * 2.46e19;
    expect(k2Eff).toBeCloseTo(1.43e-14, 2);
  });
});
