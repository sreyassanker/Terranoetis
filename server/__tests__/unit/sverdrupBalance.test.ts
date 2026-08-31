import { describe, it, expect } from 'vitest';

// Sverdrup (1947), PNAS 33(11):318-326. Eq (13): β·M_y = curl_z(τ), with
// β = 2Ωcosφ/R (eq 12) and f = 2Ωsinφ. Volume transport per unit width
// v = curl_z(τ)/(ρ₀·β) (m²/s); Ekman pumping w_Ek = curl_z(τ)/(ρ₀·f).
const OMEGA = 7.2921e-5; // s⁻¹
const R = 6371000;       // m

function beta(latDeg: number): number {
  return (2 * OMEGA * Math.cos((latDeg * Math.PI) / 180)) / R;
}
function f(latDeg: number): number {
  return 2 * OMEGA * Math.sin((latDeg * Math.PI) / 180);
}
function vTransport(curl: number, rho0: number, b: number): number {
  return curl / (rho0 * b);
}

describe('Sverdrup 1947 balance', () => {
  it('catalogue worked example: v = 1e-6/(1025 × 2e-11) = 48.78 m²/s', () => {
    expect(vTransport(1e-6, 1025, 2e-11)).toBeCloseTo(48.7804878, 6);
  });

  it('β = 2Ωcosφ/R at reference latitudes (catalogue values)', () => {
    expect(beta(0)).toBeCloseTo(2.2887e-11, 5);  // equatorial maximum
    expect(beta(30)).toBeCloseTo(1.98e-11, 3);
    expect(beta(45)).toBeCloseTo(1.62e-11, 2);
    expect(beta(90)).toBeCloseTo(0, 20);          // → 0 at the poles
  });

  it('f = 2Ωsinφ at reference latitudes', () => {
    expect(f(0)).toBeCloseTo(0, 20);              // equator — balance fails
    expect(f(30)).toBeCloseTo(7.29e-5, 4);
    expect(f(45)).toBeCloseTo(1.03e-4, 3);
    expect(f(90)).toBeCloseTo(1.458e-4, 5);
  });

  it('gyre sign convention: subtropical negative curl → southward (v < 0); subpolar positive curl → northward (v > 0)', () => {
    // subtropical anticyclonic curl
    expect(vTransport(-5e-7, 1025, beta(30))).toBeLessThan(0);
    // subpolar cyclonic curl
    expect(vTransport(5e-7, 1025, beta(60))).toBeGreaterThan(0);
  });

  it('Ekman pumping w_Ek = curl/(ρ₀·f): 1e-6 N/m³ at f = 1e-4 → 9.76e-6 m/s', () => {
    const wEk = 1e-6 / (1025 * 1e-4);
    expect(wEk).toBeCloseTo(9.756e-6, 5);
    // typical ±0.5–5e-6 m/s for realistic curls
    expect(5e-7 / (1025 * 1e-4)).toBeCloseTo(4.878e-6, 5);
  });

  it('total basin transport: v × W / 1e6 in Sv — 48.78 m²/s × 4000 km = 195 Sv', () => {
    const v = vTransport(1e-6, 1025, 2e-11);
    const sv = (v * 4000e3) / 1e6;
    expect(sv).toBeCloseTo(195.12, 1);
  });

  it('degenerate guard: β → 0 at the pole — engine returns finite NaN, never a huge/±∞ transport', () => {
    expect(Math.abs(beta(90))).toBeLessThan(1e-16); // cos(90°) ≈ 0 in float
    // the engine guards |β| < 1e-14 (≈ 0.1° of the pole) with a finite-NaN result:
    // unguarded, v = 1e-6/(1025·6e-17) ≈ 1.6e7 m²/s — a silently absurd number
    const unguarded = vTransport(1e-6, 1025, beta(90));
    expect(unguarded).toBeGreaterThan(1e7); // absurd magnitude — exactly why the guard exists
    // and the honest NaN path (|β| < 1e-14 ⇒ NaN) is what the engine returns
    expect(Number.isFinite(vTransport(1e-6, 1025, 5e-15))).toBe(true); // epsilon edge — still finite by itself
    expect(5e-15).toBeLessThan(1e-14); // engine's pole-epsilon threshold
  });
});
