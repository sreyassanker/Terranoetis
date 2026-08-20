import { describe, it, expect } from 'vitest';

// Sellers et al. 1986, Table 1c:
//   H = (T_s − T_a)·ρ·c_p / r_a
//   LE = (e_s − e_a)·ρ·c_p / (γ·(r_a + r_s)),  γ = c_p·p/(0.622·L_v)  [hPa/K]
const LV = 2.45e6;
function psychrometric(cp: number, p: number): number {
  return cp * p / (0.622 * LV);
}
function sensible(rho: number, cp: number, Ts: number, Ta: number, ra: number): number {
  return rho * cp * (Ts - Ta) / ra;
}
function latent(rho: number, cp: number, es: number, ea: number, ra: number, rs: number, p: number): number {
  const gamma = psychrometric(cp, p);
  return (es - ea) * rho * cp / (gamma * (ra + rs));
}

describe('SiB big-leaf fluxes (Sellers et al. 1986, Table 1c)', () => {
  it('γ = c_p·p/(0.622·L_v) = 0.668 hPa/K at sea level (standard psychrometric constant)', () => {
    expect(psychrometric(1005, 1013.25)).toBeCloseTo(0.668, 3);
  });

  it('catalogue worked example: LE = 180.5 W/m² (NOT 294 — the ρ·L_v shortcut inflates by ~1630×)', () => {
    const le = latent(1.2, 1005, 30, 15, 50, 100, 1013.25);
    expect(le).toBeCloseTo(180.5, 1);
    // the old wrong form ρ·L_v·Δe/r gives 294000 W/m²
    const wrong = 1.2 * LV * (30 - 15) / (50 + 100);
    expect(wrong).toBeCloseTo(294000, 0);
    expect(le / wrong).toBeCloseTo(0.622 / 1013.25, 6);
  });

  it('H = ρ·c_p·(T_s−T_a)/r_a = 120.6 W/m² for the catalogue example', () => {
    expect(sensible(1.2, 1005, 30, 25, 50)).toBeCloseTo(120.6, 1);
  });

  it('LE in mm/day: 180.5 W/m² ≈ 6.4 mm/day', () => {
    const le = latent(1.2, 1005, 30, 15, 50, 100, 1013.25);
    expect(le * 86400 / LV).toBeCloseTo(6.36, 1);
  });

  it('saturated surface e_s = e_a → LE = 0; r_s = 0 (open water) → maximum LE', () => {
    expect(latent(1.2, 1005, 15, 15, 50, 100, 1013.25)).toBeCloseTo(0, 8);
    const maxLe = latent(1.2, 1005, 30, 15, 50, 0, 1013.25);
    expect(maxLe).toBeGreaterThan(latent(1.2, 1005, 30, 15, 50, 100, 1013.25));
  });

  it('Bowen ratio β = H/LE', () => {
    const h = sensible(1.2, 1005, 30, 25, 50);
    const le = latent(1.2, 1005, 30, 15, 50, 100, 1013.25);
    expect(h / le).toBeCloseTo(0.668, 2);
  });
});
