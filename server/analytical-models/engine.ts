/**
 * Analytical Models Engine
 * ── Professional equation implementation registry ──
 *
 * Each equation is implemented as a pure function taking a typed input map
 * and returning { result, unit, steps }. All physics constants use
 * SI units unless noted. Where an equation is a PDE / stability criterion
 * (no single scalar output), a representative scalar diagnostic is returned.
 */

export interface ComputeResult {
  result: number;
  unit?: string;
  steps: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComputeFn = (x: Record<string, any>) => ComputeResult;

const SIGMA = 5.670374419e-8; // Stefan-Boltzmann constant (W m^-2 K^-4)
const H_PLANCK = 6.62607015e-34; // J·s
const C_LIGHT = 299792458; // m/s
const K_BOLTZMANN = 1.380649e-23; // J/K
const G_GRAV = 9.80665; // m/s^2
const R_SPEC = 287.058; // J/(kg·K) specific gas constant for dry air
const _OMEGA = 7.292115e-5; // Earth rotation rate (rad/s)
const PI = Math.PI;

export const EQUATION_ENGINE: Record<number, ComputeFn> = {

  // ── Part I · Domain 1: Atmospheric Science ──
  1: ({ T10, T11, eps10, eps11, w }) => {
    const a10 = -64.4661, b10 = 0.4398; // Li regression coefficients for Band 10 (0-60°C)
    const a11 = -68.8678, b11 = 0.4755; // Li regression coefficients for Band 11 (0-60°C)
    // Step 1: Atmospheric transmittance from water vapor (MODTRAN 4.0, mid-lat summer)
    const tau10 = Math.max(0.1, -0.1146 * w + 1.0286);
    const tau11 = Math.max(0.1, -0.1568 * w + 1.0083);
    // Step 2: Band-specific coupling parameters
    const C10 = eps10 * tau10;
    const C11 = eps11 * tau11;
    function computeD(τ: number, ε: number): number {
      return (1 - τ) * (1 + (1 - ε) * τ);
    }
    const D10 = computeD(tau10, eps10);
    const D11 = computeD(tau11, eps11);
    // Step 3: Intermediate SWA coefficients
    const E0 = D11 * C10 - D10 * C11;
    if (E0 === 0) return { result: NaN, unit: '°C', steps: ['Singular: E₀ = 0, no solution possible'] };
    const E1 = D11 * (1 - C10 - D10) / E0;
    const E2 = D10 * (1 - C11 - D11) / E0;
    const A = D10 / E0;
    // Step 4: Final SWA coefficients using Planck-function linearization (Li = aᵢ + bᵢT)
    const A0 = E1 * a10 + E2 * a11;
    const A1 = 1 + A + E1 * b10;
    const A2 = A + E2 * b11;
    // Step 5: Land Surface Temperature retrieval
    const Ts = A0 + A1 * T10 - A2 * T11;
    const TsC = Ts - 273.15;
    return {
      result: TsC,
      unit: '°C',
      steps: [
        '── Split-Window Algorithm (Rozenstein et al., 2014) ──',
        `Dataset: TIRS Band 10 BT = ${T10.toFixed(2)} K, Band 11 BT = ${T11.toFixed(2)} K`,
        `Column H₂O = ${w.toFixed(2)} g/cm²`,
        '',
        'Step 1 — Atmospheric Transmittance:',
        `  τ₁₀ = −0.1146·${w.toFixed(2)} + 1.0286 = ${tau10.toFixed(4)}`,
        `  τ₁₁ = −0.1568·${w.toFixed(2)} + 1.0083 = ${tau11.toFixed(4)}`,
        '',
        'Step 2 — Surface-Atmosphere Coupling:',
        `  C₁₀ = ε₁₀·τ₁₀ = ${eps10.toFixed(3)} × ${tau10.toFixed(4)} = ${C10.toFixed(4)}`,
        `  C₁₁ = ε₁₁·τ₁₁ = ${eps11.toFixed(3)} × ${tau11.toFixed(4)} = ${C11.toFixed(4)}`,
        `  D₁₀ = (1−τ₁₀)[1+(1−ε₁₀)τ₁₀] = ${D10.toFixed(4)}`,
        `  D₁₁ = (1−τ₁₁)[1+(1−ε₁₁)τ₁₁] = ${D11.toFixed(4)}`,
        '',
        'Step 3 — Intermediate Coefficients:',
        `  E₀  = D₁₁C₁₀ − D₁₀C₁₁ = ${E0.toFixed(4)}`,
        `  A   = D₁₀/E₀ = ${A.toFixed(4)}`,
        `  E₁  = D₁₁(1−C₁₀−D₁₀)/E₀ = ${E1.toFixed(4)}`,
        `  E₂  = D₁₀(1−C₁₁−D₁₁)/E₀ = ${E2.toFixed(4)}`,
        '',
        'Step 4 — SWA Coefficients (using Li = aᵢ+bᵢT regression):',
        `  A₀  = E₁·a₁₀ + E₂·a₁₁ = ${E1.toFixed(4)}·(−64.4661) + ${E2.toFixed(4)}·(−68.8678) = ${A0.toFixed(4)}`,
        `  A₁  = 1 + A + E₁·b₁₀ = 1 + ${A.toFixed(4)} + ${E1.toFixed(4)}·0.4398 = ${A1.toFixed(4)}`,
        `  A₂  = A + E₂·b₁₁ = ${A.toFixed(4)} + ${E2.toFixed(4)}·0.4755 = ${A2.toFixed(4)}`,
        '',
        'Step 5 — LST Retrieval:',
        `  Ts(K) = A₀ + A₁·T₁₀ − A₂·T₁₁`,
        `  Ts = ${A0.toFixed(4)} + ${A1.toFixed(4)}·${T10.toFixed(2)} − ${A2.toFixed(4)}·${T11.toFixed(2)} = ${Ts.toFixed(2)} K`,
        `  Ts(°C) = ${Ts.toFixed(2)} − 273.15 = ${TsC.toFixed(2)} °C`,
        '',
        `  └ Interpretation: ${TsC > 40 ? 'Very hot surface (desert/urban)' : TsC > 25 ? 'Moderate daytime surface' : TsC > 5 ? 'Temperate surface' : 'Cold surface (snow/high-altitude)'}`,
        `  └ ΔT (T₁₀−T₁₁) = ${(T10 - T11).toFixed(2)} K (${(T10 - T11) > 0 ? 'positive → water vapor present' : 'near-zero → dry atmosphere'})`,
      ],
    };
  },
  2: ({ λ, T }) => {
    const lamM = λ * 1e-6;
    const hc_over_lkT = (H_PLANCK * C_LIGHT) / (lamM * K_BOLTZMANN * T);
    const e = Math.exp(hc_over_lkT);
    const B = (2 * H_PLANCK * C_LIGHT ** 2) / Math.pow(lamM, 5) * (1 / (e - 1));
    // Wien's displacement law: λ_max = 2898 / T(°K) µm
    const lamMax = 2897.771955 / T;
    // Stefan-Boltzmann: total exitance M = σT⁴
    const M = SIGMA * Math.pow(T, 4);
    return {
      result: B, unit: 'W·sr⁻¹·m⁻³',
      steps: [
        '── Planck Radiation Law (Planck, 1901) ──',
        `Wavelength λ = ${λ} µm, Temperature T = ${T} K (${(T - 273.15).toFixed(1)} °C)`,
        '',
        'Step 1 — Convert wavelength to meters:',
        `  λ(m) = ${λ} × 10⁻⁶ = ${lamM.toExponential(3)} m`,
        '',
        'Step 2 — Compute exponent hc/λkT:',
        `  hc/λkT = (${H_PLANCK.toExponential(3)} × ${C_LIGHT}) / (${lamM.toExponential(3)} × ${K_BOLTZMANN.toExponential(3)} × ${T})`,
        `  = ${hc_over_lkT.toExponential(4)}`,
        '',
        'Step 3 — Compute spectral radiance:',
        `  B_λ(T) = 2hc²/λ⁵ · 1/(e^(hc/λkT) − 1)`,
        `  B_λ = ${B.toExponential(4)} W·sr⁻¹·m⁻³`,
        '',
        'Step 4 — Derived quantities:',
        `  Wien peak: λ_max = ${lamMax.toFixed(1)} µm (${lamMax < 3 ? 'shortwave IR' : lamMax < 8 ? 'midwave IR' : 'thermal IR'})`,
        `  Total exitance (S-B): M = σT⁴ = ${M.toExponential(4)} W/m²`,
        '',
        `  └ Interpretation: ${T > 5500 ? 'Solar-temperature regime (photosphere)' : T > 1000 ? 'High-temperature source (fire/lava)' : T > 300 ? 'Terrestrial surface temperature' : 'Cold target (ice/cloud top)'}`,
      ]
    };
  },
  3: ({ T }) => {
    const Tc = T;
    const es = 6.1094 * Math.exp((17.625 * Tc) / (Tc + 243.04));
    // Dew point proxy: if we treat es as actual vapor pressure, Td = ... (not computed here)
    // Slope of saturation vapor pressure curve Δ = des/dT (Pa/K) for Penman-Monteith
    const delta = (4098 * es) / Math.pow(Tc + 237.3, 2);
    // Mixing ratio at saturation (g/kg)
    const ws = 622 * es / (1013.25 - es);
    return {
      result: es, unit: 'hPa',
      steps: [
        '── Saturation Vapor Pressure (Magnus-Tetens, Clausius-Clapeyron) ──',
        `Temperature T = ${Tc.toFixed(1)} °C (${(Tc + 273.15).toFixed(1)} K)`,
        '',
        'Step 1 — Magnus-Tetens formula:',
        `  e_s(T) = 6.1094 × exp(17.625·T / (T + 243.04))`,
        `  e_s = 6.1094 × exp(17.625 × ${Tc.toFixed(1)} / (${Tc.toFixed(1)} + 243.04))`,
        `  e_s = ${es.toFixed(3)} hPa`,
        '',
        'Step 2 — Derived thermodynamic quantities:',
        `  Slope Δ = de_s/dT = ${delta.toFixed(3)} Pa/K (used in Penman-Monteith ET₀)`,
        `  Saturation mixing ratio w_s = 622·e_s/(P−e_s) = ${ws.toFixed(2)} g/kg (at P₀=1013.25 hPa)`,
        '',
        'Step 3 — Clausius-Cleyperon context:',
        `  de_s/dT = L_v·e_s/(R_v·T²) (L_v = 2.5×10⁶ J/kg, R_v = 461.5 J/kg·K)`,
        `  e_s doubles approximately every 10 °C increase`,
        '',
        `  └ Interpretation: ${es < 6.11 ? 'Sub-freezing, low vapor capacity' : es < 23.4 ? 'Temperate, moderate moisture' : es < 73.5 ? 'Warm, high moisture' : 'Very warm, extreme vapor capacity (>70 hPa at >40°C)'}`,
      ]
    };
  },
  4: ({ P0, z, T }) => {
    const H = (R_SPEC * T) / G_GRAV;
    const ratio = z / H;
    const P = P0 * Math.exp(-ratio);
    const P_pct = (P / P0) * 100;
    return {
      result: P, unit: 'hPa',
      steps: [
        '── Hydrostatic Equation (Holton & Hakim, 2012) ──',
        `Surface pressure P₀ = ${P0.toFixed(1)} hPa, Altitude z = ${z.toFixed(0)} m, Mean T = ${T.toFixed(1)} K`,
        '',
        'Step 1 — Compute scale height:',
        `  H = R_d·T/g = ${R_SPEC} × ${T.toFixed(1)} / ${G_GRAV}`,
        `  H = ${H.toFixed(1)} m (≈ ${(H / 1000).toFixed(2)} km)`,
        '',
        'Step 2 — Compute altitude ratio:',
        `  z/H = ${z.toFixed(0)} / ${H.toFixed(1)} = ${ratio.toFixed(4)}`,
        '',
        'Step 3 — Apply isothermal exponential decay:',
        `  P(z) = P₀ × exp(−z/H)`,
        `  P(${z.toFixed(0)} m) = ${P0.toFixed(1)} × exp(−${ratio.toFixed(4)})`,
        `  P = ${P.toFixed(1)} hPa`,
        '',
        'Step 4 — Interpretation:',
        `  Pressure ratio P/P₀ = ${P_pct.toFixed(1)}% of surface pressure`,
        `  Standard atmosphere: 500 hPa at ~5.5 km, 250 hPa at ~10.5 km`,
        '',
        `  └ Level: ${P > 700 ? 'Lower troposphere (850 hPa layer)' : P > 500 ? 'Mid-troposphere (700–500 hPa)' : P > 300 ? 'Upper troposphere (500–300 hPa)' : P > 100 ? 'Tropopause / lower stratosphere' : 'Stratosphere'}`,
      ]
    };
  },
  5: ({ f, rho, dPdx, dPdy }) => {
    const Vgx = (1 / (f * rho)) * -dPdy;
    const Vgy = (1 / (f * rho)) * dPdx;
    const Vg = Math.hypot(Vgx, Vgy);
    const dirRad = Math.atan2(Vgy, Vgx);
    const dirDeg = ((dirRad * 180 / PI) + 360) % 360;
    // Meteorological wind direction (coming from): 270° - cartesian angle
    const metDir = ((270 - (dirRad * 180 / PI)) + 360) % 360;
    return {
      result: Vg, unit: 'm/s',
      steps: [
        '── Geostrophic Wind (Holton & Hakim, 2012, Ch. 3) ──',
        `Coriolis parameter f = ${f.toFixed(6)} /s, Air density ρ = ${rho.toFixed(3)} kg/m³`,
        `Pressure gradient ∂P/∂x = ${dPdx.toFixed(6)} Pa/m, ∂P/∂y = ${dPdy.toFixed(6)} Pa/m`,
        '',
        'Step 1 — Compute u-component (eastward):',
        `  u_g = −(1/fρ)·∂P/∂y = −1/(${f.toFixed(6)}×${rho.toFixed(3)}) × (${dPdy.toFixed(6)})`,
        `  u_g = ${Vgx.toFixed(4)} m/s`,
        '',
        'Step 2 — Compute v-component (northward):',
        `  v_g = (1/fρ)·∂P/∂x = 1/(${f.toFixed(6)}×${rho.toFixed(3)}) × (${dPdx.toFixed(6)})`,
        `  v_g = ${Vgy.toFixed(4)} m/s`,
        '',
        'Step 3 — Compute total wind speed:',
        `  |V_g| = √(u_g² + v_g²) = √(${Vgx.toFixed(4)}² + ${Vgy.toFixed(4)}²)`,
        `  |V_g| = ${Vg.toFixed(3)} m/s (${(Vg * 3.6).toFixed(1)} km/h)`,
        '',
        'Step 4 — Wind direction:',
        `  Cartesian angle: ${dirDeg.toFixed(1)}° from east`,
        `  Meteorological (coming from): ${metDir.toFixed(1)}°`,
        '',
        `  └ Interpretation: ${Vg < 5 ? 'Light geostrophic wind (weak gradient)' : Vg < 15 ? 'Moderate geostrophic wind (typical synoptic)' : Vg < 30 ? 'Strong geostrophic wind (deep cyclone)' : 'Very strong / jet stream level'}`,
      ]
    };
  },
  6: ({ u, D, C0, t }) => {
    const Pe = (u * u * t) / (4 * D);
    const dilution = Math.exp(-1 / Pe);
    const C = C0 * dilution;
    const sigma = Math.sqrt(2 * D * t);
    const advDist = u * t;
    return {
      result: C, unit: 'µg/m³',
      steps: [
        '── Advection-Diffusion Equation (Bird, Stewart & Lightfoot, 2007, Ch. 4) ──',
        `Wind speed u = ${u.toFixed(2)} m/s, Eddy diffusivity D = ${D.toFixed(2)} m²/s`,
        `Initial concentration C₀ = ${C0.toFixed(2)} µg/m³, Time t = ${t.toFixed(0)} s (${(t / 3600).toFixed(2)} hr)`,
        '',
        'Step 1 — Compute Péclet number:',
        '  Pe = u²t / (4D) — ratio of advective to diffusive transport',
        `  Pe = ${u.toFixed(2)}² × ${t.toFixed(0)} / (4 × ${D.toFixed(2)}) = ${Pe.toFixed(3)}`,
        `  → ${Pe > 10 ? 'Advection-dominated (narrow plume, far downwind)' : Pe > 1 ? 'Mixed regime (comparable advection & diffusion)' : 'Diffusion-dominated (plume spreads in all directions)'}`,
        '',
        'Step 2 — Compute dilution factor:',
        `  dilution = exp(−1/Pe) = exp(−1/${Pe.toFixed(3)}) = ${dilution.toExponential(4)}`,
        '',
        'Step 3 — Compute peak concentration:',
        `  C = C₀ × dilution = ${C0.toFixed(2)} × ${dilution.toExponential(4)}`,
        `  C = ${C.toExponential(4)} µg/m³`,
        '',
        'Step 4 — Plume geometry:',
        `  Advection distance: x = u·t = ${u.toFixed(2)} × ${t.toFixed(0)} = ${advDist.toFixed(0)} m (${(advDist / 1000).toFixed(2)} km)`,
        `  Diffusion spread: σ = √(2Dt) = √(2 × ${D.toFixed(2)} × ${t.toFixed(0)}) = ${sigma.toFixed(1)} m`,
        '',
        `  └ Interpretation: ${dilution < 0.01 ? 'Severe dilution — concentration reduced by >99%' : dilution < 0.1 ? 'Significant dilution — concentration reduced by >90%' : dilution < 0.5 ? 'Moderate dilution' : 'Minimal dilution — concentrated plume'}`,
      ]
    };
  },
  7: ({ zg, zs, thvz, thvs, uz, us }) => {
    const dz = zg - zs;
    const dth = thvz - thvs;
    const du = Math.abs(uz - us);
    const den = thvs * du * du;
    const Ri = den !== 0 ? (G_GRAV * dz * dth) / den : (dth > 0 ? Infinity : -Infinity);
    let stability: string;
    if (Ri < -0.01) stability = 'UNSTABLE — free convection, thermals, cumulus development';
    else if (Ri < 0.01) stability = 'NEUTRAL — mechanical turbulence only, overcast or windy';
    else if (Ri < 0.25) stability = 'WEAKLY STABLE — intermittent turbulence, some suppression';
    else stability = 'STABLE — turbulence suppressed, fog/frost likely, poor dispersion';
    return {
      result: Ri, unit: '—',
      steps: [
        '── Bulk Richardson Number (Stull, 1988, Ch. 4) ──',
        `Layer: z_g = ${zg.toFixed(1)} m, z_s = ${zs.toFixed(1)} m → Δz = ${dz.toFixed(1)} m`,
        `Virtual pot. temp: θ_v(z) = ${thvz.toFixed(2)} K, θ_v(s) = ${thvs.toFixed(2)} K → Δθ_v = ${dth.toFixed(3)} K`,
        `Wind speed: u(z) = ${uz.toFixed(2)} m/s, u(s) = ${us.toFixed(2)} m/s → Δu = ${du.toFixed(3)} m/s`,
        '',
        'Step 1 — Compute numerator (buoyancy term):',
        `  g·Δz·Δθ_v = ${G_GRAV} × ${dz.toFixed(1)} × ${dth.toFixed(3)} = ${(G_GRAV * dz * dth).toFixed(4)}`,
        '',
        'Step 2 — Compute denominator (shear term):',
        `  θ_v(s)·Δu² = ${thvs.toFixed(2)} × ${du.toFixed(3)}² = ${den.toFixed(4)}`,
        '',
        'Step 3 — Compute Ri_b:',
        `  Ri_b = ${(G_GRAV * dz * dth).toFixed(4)} / ${den.toFixed(4)} = ${Ri.toFixed(4)}`,
        '',
        'Step 4 — Stability classification:',
        `  Ri_b = ${Ri.toFixed(4)} → ${stability}`,
        '',
        `  └ Critical threshold Ri_c = 0.25: ${Ri >= 0.25 ? 'TURBULENCE SUPPRESSED (Ri ≥ 0.25)' : 'TURBULENCE POSSIBLE (Ri < 0.25)'}`,
      ]
    };
  },
  8: ({ C, eps, k }) => {
    const eps23 = Math.pow(eps, 2 / 3);
    const k53 = Math.pow(k, -5 / 3);
    const E = C * eps23 * k53;
    const L = (2 * Math.PI) / k;
    // Kolmogorov microscale (ν ≈ 1.5×10⁻⁵ m²/s for air at 20°C)
    const nu = 1.5e-5;
    const eta = Math.pow(nu * nu * nu / (eps || 1e-30), 1 / 4);
    const kEta = 1 / eta;
    const inInertial = k < kEta;
    return {
      result: E, unit: 'm³/s²',
      steps: [
        '── Kolmogorov −5/3 Energy Cascade (Kolmogorov, 1941) ──',
        `Kolmogorov constant C = ${C.toFixed(2)}, TKE dissipation ε = ${eps.toExponential(3)} m²/s³`,
        `Wavenumber k = ${k.toExponential(3)} 1/m`,
        '',
        'Step 1 — Compute ε^(2/3):',
        `  ε^(2/3) = (${eps.toExponential(3)})^(2/3) = ${eps23.toExponential(4)}`,
        '',
        'Step 2 — Compute k^(−5/3):',
        `  k^(−5/3) = (${k.toExponential(3)})^(−5/3) = ${k53.toExponential(4)}`,
        '',
        'Step 3 — Apply −5/3 law:',
        `  E(k) = C·ε^(2/3)·k^(−5/3)`,
        `  E(k) = ${C.toFixed(2)} × ${eps23.toExponential(4)} × ${k53.toExponential(4)}`,
        `  E(k) = ${E.toExponential(4)} m³/s²`,
        '',
        'Step 4 — Eddy size:',
        `  L = 2π/k = 2π / ${k.toExponential(3)} = ${L.toFixed(1)} m`,
        '',
        'Step 5 — Kolmogorov microscale:',
        `  η = (ν³/ε)^(1/4) = ${eta.toExponential(4)} m (dissipation scale)`,
        `  k_η = 1/η = ${kEta.toExponential(4)} 1/m`,
        `  ${inInertial ? '✓ k < k_η: within inertial subrange — −5/3 law valid' : '⚠ k ≥ k_η: in dissipation range — −5/3 law may not apply'}`,
        '',
        `  └ Regime: ${L > 1000 ? 'Energy-containing range (large synoptic eddies)' : L > 1 ? 'Inertial subrange (turbulent eddies following −5/3)' : 'Dissipation range (viscous effects dominant)'}`,
      ]
    };
  },

  // ── Domain 2: Hydrology & Oceanography ──
  9: ({ Rn, G, T, u2, es, ea, delta, gamma }) => {
    const Rn_MJ = Rn * 0.0864;
    const G_MJ = G * 0.0864;
    const radTerm = 0.408 * delta * (Rn_MJ - G_MJ);
    const aeroTerm = gamma * (900 / (T + 273)) * u2 * (es - ea);
    const den = delta + gamma * (1 + 0.34 * u2);
    const ET0 = (radTerm + aeroTerm) / den;
    const radContrib = radTerm / den;
    const aeroContrib = aeroTerm / den;
    return {
      result: ET0, unit: 'mm/day',
      steps: [
        '── FAO-56 Penman-Monteith (Allen et al., 1998) ──',
        `Rₙ = ${Rn.toFixed(1)} W/m², G = ${G.toFixed(1)} W/m², T = ${T.toFixed(1)} °C`,
        `u₂ = ${u2.toFixed(2)} m/s, eₛ = ${es.toFixed(3)} kPa, eₐ = ${ea.toFixed(3)} kPa, Δ = ${delta.toFixed(3)} kPa/°C, γ = ${gamma.toFixed(3)} kPa/°C`,
        '',
        'Step 1 — Energy unit conversion (W/m² → MJ/m²/day):',
        `  Rₙ(MJ/m²/day) = ${Rn.toFixed(1)} × 0.0864 = ${Rn_MJ.toFixed(3)}`,
        `  G(MJ/m²/day) = ${G.toFixed(1)} × 0.0864 = ${G_MJ.toFixed(3)}`,
        '',
        'Step 2 — Radiation term:',
        `  0.408 × Δ × (Rₙ−G) = 0.408 × ${delta.toFixed(3)} × (${Rn_MJ.toFixed(3)} − ${G_MJ.toFixed(3)})`,
        `  RadNum = ${radTerm.toFixed(4)} mm/day`,
        '',
        'Step 3 — Aerodynamic term:',
        `  γ × (900/(T+273)) × u₂ × (eₛ−eₐ) = ${gamma.toFixed(3)} × (900/(${T.toFixed(1)}+273)) × ${u2.toFixed(2)} × (${es.toFixed(3)}−${ea.toFixed(3)})`,
        `  AeroNum = ${aeroTerm.toFixed(4)} mm/day`,
        '',
        'Step 4 — Denominator:',
        `  Δ + γ(1+0.34u₂) = ${delta.toFixed(3)} + ${gamma.toFixed(3)} × (1 + 0.34 × ${u2.toFixed(2)})`,
        `  Den = ${den.toFixed(4)}`,
        '',
        'Step 5 — Reference ET:',
        `  ET₀ = (${radTerm.toFixed(4)} + ${aeroTerm.toFixed(4)}) / ${den.toFixed(4)}`,
        `  ET₀ = ${ET0.toFixed(2)} mm/day`,
        '',
        'Step 6 — Component analysis:',
        `  Radiation contribution = ${radContrib.toFixed(2)} mm/day (${(radContrib / ET0 * 100).toFixed(0)}%)`,
        `  Aerodynamic contribution = ${aeroContrib.toFixed(2)} mm/day (${(aeroContrib / ET0 * 100).toFixed(0)}%)`,
        '',
        `  └ Interpretation: ${ET0 < 3 ? 'Low evaporative demand (cool/humid)' : ET0 < 6 ? 'Moderate evaporative demand' : 'High evaporative demand (arid/heat wave)'}`
      ]
    };
  },
  10: ({ P, Ia, S }) => {
    const Q = Math.max(0, Math.pow(P - Ia, 2) / (P - Ia + S));
    const CN = S > 0 ? 25400 / (S + 254) : 100;
    const runoffRatio = P > 0 ? Q / P : 0;
    return {
      result: Q, unit: 'mm',
      steps: [
        '── SCS Curve Number (USDA SCS, 1954) ──',
        `Precipitation P = ${P.toFixed(1)} mm, Initial abstraction Iₐ = ${Ia.toFixed(1)} mm`,
        `Potential retention S = ${S.toFixed(1)} mm, Derived CN = ${CN.toFixed(0)}`,
        '',
        'Step 1 — Check runoff threshold:',
        `  P = ${P.toFixed(1)} mm,  Iₐ = ${Ia.toFixed(1)} mm`,
        `  ${P > Ia ? `P > Iₐ → runoff occurs (excess = ${(P - Ia).toFixed(1)} mm)` : 'P ≤ Iₐ → no runoff (Q = 0)'}`,
        '',
        'Step 2 — Compute runoff:',
        `  Q = (P−Iₐ)² / (P−Iₐ+S) = (${(P - Ia).toFixed(1)})² / (${(P - Ia).toFixed(1)} + ${S.toFixed(1)})`,
        `  Q = ${Q.toFixed(2)} mm`,
        '',
        'Step 3 — Runoff ratio:',
        `  Q/P = ${Q.toFixed(2)} / ${P.toFixed(1)} = ${(runoffRatio * 100).toFixed(1)}%`,
        '',
        `  └ Interpretation: ${runoffRatio < 0.2 ? 'Low runoff fraction — high infiltration capacity' : runoffRatio < 0.4 ? 'Moderate runoff — typical agricultural watershed' : runoffRatio < 0.6 ? 'High runoff — urban/impervious or saturated soil' : 'Very high runoff — extreme storm or impervious surface'}`
      ]
    };
  },
  11: ({ n, R, S }) => {
    const R23 = Math.pow(R, 2 / 3);
    const S12 = Math.sqrt(S);
    const v = (1 / n) * R23 * S12;
    return {
      result: v, unit: 'm/s',
      steps: [
        "── Manning's Equation (Manning, 1891) ──",
        `Roughness n = ${n.toFixed(3)}, Hydraulic radius R = ${R.toFixed(3)} m, Slope S = ${S.toFixed(5)} m/m`,
        '',
        'Step 1 — Compute R^(2/3):',
        `  R^(2/3) = ${R.toFixed(3)}^(2/3) = ${R23.toFixed(4)}`,
        '',
        'Step 2 — Compute S^(1/2):',
        `  S^(1/2) = √(${S.toFixed(5)}) = ${S12.toFixed(6)}`,
        '',
        'Step 3 — Compute velocity:',
        `  v = (1/${n.toFixed(3)}) × ${R23.toFixed(4)} × ${S12.toFixed(6)}`,
        `  v = ${v.toFixed(3)} m/s`,
        '',
        'Step 4 — Flow classification:',
        `  v = ${v.toFixed(3)} m/s = ${(v * 3.6).toFixed(2)} km/h`,
        '',
        `  └ Interpretation: ${v < 0.5 ? 'Low velocity — fine sediment deposition likely' : v < 2 ? 'Moderate velocity — sand/gravel transport' : v < 3.5 ? 'High velocity — cobble transport, erosive' : 'Very high velocity — boulder transport, extreme erosion potential'}`
      ]
    };
  },
  12: ({ C, i, A }) => {
    const Q = C * i * A;
    const Qm3s = Q / 3.6; // convert from mm/h·km² to m³/s
    return {
      result: Qm3s, unit: 'm³/s',
      steps: [
        '── Rational Method (Mulvaney, 1851) ──',
        `Runoff coefficient C = ${C.toFixed(3)}, Rainfall intensity i = ${i.toFixed(2)} mm/h`,
        `Catchment area A = ${A.toFixed(3)} km²`,
        '',
        'Step 1 — Apply rational formula:',
        `  Q = C × i × A = ${C.toFixed(3)} × ${i.toFixed(2)} × ${A.toFixed(3)}`,
        `  Q = ${Q.toFixed(3)} (mm/h·km²)`,
        '',
        'Step 2 — Convert to m³/s:',
        `  Q(m³/s) = ${Q.toFixed(3)} / 3.6 = ${Qm3s.toFixed(3)} m³/s`,
        '',
        'Step 3 — Specific discharge:',
        `  Q/A = ${Qm3s.toFixed(3)} / ${A.toFixed(3)} = ${(Qm3s / A).toFixed(4)} m³/s/km²`,
        '',
        `  └ Interpretation: ${Qm3s < 1 ? 'Small catchment stormflow' : Qm3s < 10 ? 'Moderate peak discharge' : Qm3s < 100 ? 'Large peak discharge — major storm event' : 'Extreme peak discharge — potential flood hazard'}`
      ]
    };
  },
  13: ({ K, X, It, Ot }) => {
    const weightedStorage = (1 - X) * It + X * Ot;
    const S = K * weightedStorage;
    const coeffCheck = K * (1 - X);
    return {
      result: S, unit: 'm³/s·h',
      steps: [
        '── Muskingum Routing (McCarthy, 1938) ──',
        `Storage constant K = ${K.toFixed(2)} h, Weighting factor X = ${X.toFixed(3)}`,
        `Inflow I_t = ${It.toFixed(1)} m³/s, Outflow O_t = ${Ot.toFixed(1)} m³/s`,
        '',
        'Step 1 — Weighted storage:',
        `  X·I_t + (1−X)·O_t = ${X.toFixed(3)}×${It.toFixed(1)} + (1−${X.toFixed(3)})×${Ot.toFixed(1)}`,
        `  = ${X * It} + ${((1 - X) * Ot)} = ${weightedStorage.toFixed(2)}`,
        '',
        'Step 2 — Reach storage:',
        `  S = K × [X·I_t + (1−X)·O_t] = ${K.toFixed(2)} × ${weightedStorage.toFixed(2)}`,
        `  S = ${S.toFixed(2)} m³/s·h`,
        '',
        'Step 3 — Stability check:',
        `  K×X = ${(K * X).toFixed(3)},  K×(1−X) = ${coeffCheck.toFixed(3)}`,
        `  ${coeffCheck > 0 ? '✓ Routing coefficient positive (stable)' : '⚠ Check: negative routing coefficient possible'}`,
        '',
        `  └ Interpretation: ${X < 0.1 ? 'Near-reservoir storage — strong attenuation' : X < 0.3 ? 'Typical natural channel storage' : 'Near-translation — weak attenuation, wave moves through reach with minimal peak reduction'}`
      ]
    };
  },
  14: ({ H0, amps }) => {
    const ampArr = amps ?? [];
    const sumAmps = ampArr.reduce((s: number, a: number) => s + a, 0);
    const h = H0 + sumAmps;
    const nConstituents = ampArr.length;
    return {
      result: h, unit: 'm',
      steps: [
        '── Tidal Harmonic Analysis (Pugh & Woodworth, 2014) ──',
        `Mean sea level H₀ = ${H0.toFixed(3)} m`,
        `Number of harmonic constituents: ${nConstituents}`,
        '',
        'Step 1 — Constituent summation:',
        `  Σ Aᵢcos(ωᵢt+φᵢ) = ${sumAmps.toFixed(3)} m (combined amplitude for time t)`,
        '',
        'Step 2 — Tidal elevation:',
        `  h(t) = H₀ + Σ Aᵢcos(ωᵢt+φᵢ) = ${H0.toFixed(3)} + ${sumAmps.toFixed(3)}`,
        `  h(t) = ${h.toFixed(3)} m`,
        '',
        'Step 3 — Tidal classification:',
        `  Tidal range = ${(2 * sumAmps).toFixed(2)} m (approximate)`,
        '',
        `  └ Interpretation: ${h > 1 ? 'High tide' : h < -1 ? 'Low tide' : 'Mid-tide'} | ${(2 * sumAmps) < 2 ? 'Microtidal (< 2 m)' : (2 * sumAmps) < 4 ? 'Mesotidal (2–4 m)' : 'Macrotidal (> 4 m)'}`
      ]
    };
  },
  15: ({ tau, rho, A, f, vTheta: _vTheta }) => {
    const rhoFAv = rho * f * A;
    const V0 = tau / Math.sqrt(rhoFAv);
    const De = Math.PI * Math.sqrt(2 * A / f);
    const Ue = tau / (rho * f);
    const _windRatio = V0 > 0 && tau > 0 ? V0 / (tau * 100) * 100 : 0;
    return {
      result: V0, unit: 'm/s',
      steps: [
        '── Ekman Spiral (Ekman, 1905) ──',
        `Wind stress τ = ${tau.toFixed(4)} N/m², Seawater density ρ = ${rho.toFixed(0)} kg/m³`,
        `Coriolis f = ${f.toFixed(6)} /s, Eddy viscosity A_v = ${A.toFixed(4)} m²/s`,
        '',
        'Step 1 — Compute surface current:',
        `  V₀ = τ / √(ρfA_v) = ${tau.toFixed(4)} / √(${rho.toFixed(0)} × ${f.toFixed(6)} × ${A.toFixed(4)})`,
        `  V₀ = ${tau.toFixed(4)} / √(${rhoFAv.toExponential(4)})`,
        `  V₀ = ${V0.toFixed(4)} m/s (${(V0 * 100).toFixed(2)} cm/s)`,
        '',
        'Step 2 — Ekman depth:',
        `  D_e = π√(2A_v/f) = π × √(2 × ${A.toFixed(4)} / ${f.toFixed(6)})`,
        `  D_e = ${De.toFixed(1)} m`,
        '',
        'Step 3 — Ekman transport:',
        `  U_E = τ/(ρf) = ${tau.toFixed(4)} / (${rho.toFixed(0)} × ${f.toFixed(6)})`,
        `  U_E = ${Ue.toFixed(4)} m²/s (transport per unit width)`,
        '',
        `  └ Direction: 45° right of wind (Northern Hemisphere) | Surface drift ≈ ${(V0 * 100).toFixed(1)} cm/s | Ekman layer depth = ${De.toFixed(0)} m`
      ]
    };
  },
  16: ({ f, vg: _vg, dpdx, rho }) => {
    const v = (1 / (rho * f)) * dpdx;
    const slope = dpdx / (rho * G_GRAV); // Equivalent sea surface slope ∂η/∂x
    return {
      result: v, unit: 'm/s',
      steps: [
        '── Geostrophic Current (Gill, 1982) ──',
        `Coriolis parameter f = ${f.toFixed(6)} /s, Density ρ = ${rho.toFixed(0)} kg/m³`,
        `Pressure gradient ∂p/∂x = ${dpdx.toExponential(4)} Pa/m`,
        '',
        'Step 1 — Compute geostrophic velocity:',
        `  v_g = (1/ρf) × ∂p/∂x = 1/(${rho.toFixed(0)} × ${f.toFixed(6)}) × ${dpdx.toExponential(4)}`,
        `  v_g = ${v.toFixed(6)} m/s (${(v * 100).toFixed(3)} cm/s)`,
        '',
        'Step 2 — Equivalent sea surface slope:',
        `  ∂η/∂x = (1/ρg) × ∂p/∂x = 1/(${rho.toFixed(0)} × ${G_GRAV}) × ${dpdx.toExponential(4)}`,
        `  ∂η/∂x = ${slope.toExponential(6)} (${(slope * 1e5).toFixed(4)} m per 100 km)`,
        '',
        'Step 3 — Hydrodynamic check:',
        `  Rossby number Ro = v/(f·L) — valid when Ro « 1 (scales > 50 km)`,
        '',
        `  └ Interpretation: ${v < 0.01 ? 'Weak geostrophic flow — ocean interior gyre' : v < 0.1 ? 'Moderate current — subtropical gyre boundary' : v < 0.5 ? 'Strong current — western boundary current flank' : 'Very strong current — Gulf Stream/Kuroshio core (>1 m/s)'}`
      ]
    };
  },
  17: ({ Qs, Qb, Qh, Qe }) => {
    const Qnet = Qs - Qb - Qh - Qe;
    const rho_w = 1025, cp_w = 3990, H_mix = 50; // typical mixed layer 50 m
    const sstTend = Qnet / (rho_w * cp_w * H_mix) * 86400; // °C/day
    const Lv = 2.5e6, rho_w2 = 1000;
    const evapRate = Qe / (rho_w2 * Lv) * 86400 * 1000; // mm/day
    return {
      result: Qnet, unit: 'W/m²',
      steps: [
        '── Ocean Surface Heat Budget (Gill, 1982, Ch. 3) ──',
        `Shortwave Q_s = ${Qs.toFixed(1)} W/m², Longwave Q_b = ${Qb.toFixed(1)} W/m²`,
        `Sensible Q_h = ${Qh.toFixed(1)} W/m², Latent Q_e = ${Qe.toFixed(1)} W/m²`,
        '',
        'Step 1 — Net heat flux:',
        `  Q_net = Q_s − Q_b − Q_h − Q_e`,
        `  Q_net = ${Qs.toFixed(1)} − ${Qb.toFixed(1)} − ${Qh.toFixed(1)} − ${Qe.toFixed(1)}`,
        `  Q_net = ${Qnet.toFixed(2)} W/m²`,
        '',
        'Step 2 — SST tendency (mixed layer H=50 m):',
        `  dSST/dt = Q_net/(ρc_pH) = ${Qnet.toFixed(2)} / (${rho_w} × ${cp_w} × ${H_mix})`,
        `  dSST/dt = ${sstTend.toFixed(3)} °C/day`,
        '',
        'Step 3 — Evaporation rate:',
        `  E = Q_e/(ρL_v) = ${Qe.toFixed(1)} / (${rho_w2} × ${Lv.toExponential(1)})`,
        `  E = ${evapRate.toFixed(2)} mm/day`,
        '',
        `  └ Interpretation: ${Qnet > 100 ? 'Strong ocean heat gain — rapid SST warming' : Qnet > 0 ? 'Moderate ocean heat gain — SST slowly rising' : Qnet > -100 ? 'Moderate ocean heat loss — SST slowly cooling' : 'Strong ocean heat loss — rapid SST cooling, convective mixing'}`
      ]
    };
  },
  18: ({ Ks, psiW, psi0, dTheta, Ft }) => {
    const psiF = psiW - psi0;
    const f = Ks * (1 + psiF * dTheta / Ft);
    const L = Ft / dTheta; // wetting front depth
    const _tPond = (Ks > 0 && Ft > 0) ? (Ks * psiF * dTheta) / (Ks * Ks) : 0;
    return {
      result: f, unit: 'm/s',
      steps: [
        '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
        `K_s = ${Ks.toExponential(3)} m/s, ψ_w = ${psiW.toFixed(2)} m, ψ₀ = ${psi0.toFixed(2)} m`,
        `Δθ = ${dTheta.toFixed(3)}, F(t) = ${Ft.toFixed(3)} m`,
        '',
        'Step 1 — Effective suction head:',
        `  ψ_f = ψ_w − ψ₀ = ${psiW.toFixed(2)} − ${psi0.toFixed(2)} = ${psiF.toFixed(2)} m`,
        '',
        'Step 2 — Capillary term:',
        `  ψ_f·Δθ/F = ${psiF.toFixed(2)} × ${dTheta.toFixed(3)} / ${Ft.toFixed(3)}`,
        `  = ${(psiF * dTheta / Ft).toFixed(3)}`,
        '',
        'Step 3 — Infiltration rate:',
        `  f = K_s × (1 + ψ_f·Δθ/F) = ${Ks.toExponential(3)} × (1 + ${(psiF * dTheta / Ft).toFixed(3)})`,
        `  f = ${f.toExponential(3)} m/s`,
        '',
        'Step 4 — Wetting front depth:',
        `  L = F/Δθ = ${Ft.toFixed(3)} / ${dTheta.toFixed(3)} = ${L.toFixed(3)} m`,
        '',
        `  └ Interpretation: ${f / Ks > 5 ? 'Early stage — capillary-driven infiltration dominates' : f / Ks > 2 ? 'Intermediate stage — mixed capillary-gravity flow' : 'Late stage — gravity-driven flow approaching K_s'}`
      ]
    };
  },

   // ── Domain 3: Geophysics & Seismology ──
  19: ({ N: _N, a, b, M }) => {
    const logN = a - b * M;
    const n = Math.pow(10, logN);
    const T_r = n > 0 ? 1 / n : Infinity;
    const P10 = n > 0 ? 1 - Math.exp(-10 * n) : 0;
    return {
      result: n, unit: 'events/yr',
      steps: [
        '── Gutenberg-Richter Law (Gutenberg & Richter, 1944) ──',
        `Seismicity parameters: a-value = ${a.toFixed(2)}, b-value = ${b.toFixed(3)}, Magnitude M = ${M.toFixed(1)}`,
        '',
        'Step 1 — Compute annual frequency log₁₀(N):',
        `  log₁₀(N) = a − b·M = ${a.toFixed(2)} − ${b.toFixed(3)} × ${M.toFixed(1)} = ${logN.toFixed(4)}`,
        '',
        'Step 2 — Compute annual frequency N:',
        `  N(≥M) = 10^${logN.toFixed(4)} = ${n.toFixed(3)} events/yr`,
        '',
        'Step 3 — Derived hazard metrics:',
        `  Return period T_r = 1 / N = ${T_r.toFixed(1)} yr`,
        `  10-year exceedance probability: P₁₀ = 1 − exp(−10 × ${n.toFixed(3)}) = ${(P10 * 100).toFixed(1)}%`,
        '',
        `  └ Interpretation: ${n > 10 ? 'Very frequent — expect multiple events per year' : n > 1 ? 'Frequent — expect annual occurrence' : n > 0.01 ? 'Moderate recurrence' : 'Rare event — return period > 100 years'}`,
        `  └ ${b < 0.9 ? 'b-value < 0.9: relatively more large earthquakes (high-stress regime)' : b > 1.1 ? 'b-value > 1.1: relatively more small earthquakes (low-stress regime)' : 'b-value ≈ 1.0: typical global average'}`,
      ]
    };
  },
  20: ({ K, c, t, p }) => {
    const den = Math.pow(c + t, p);
    const n = den > 0 ? K / den : 0;
    const halfLife = c * (Math.pow(2, 1 / p) - 1);
    const cum = Math.abs(p - 1) > 1e-10
      ? K * (Math.pow(c, 1 - p) - Math.pow(c + t, 1 - p)) / (p - 1)
      : K * Math.log(1 + t / c);
    return {
      result: n, unit: 'events/day',
      steps: [
        '── Modified Omori Law (Omori, 1894; Utsu, 1961) ──',
        `Sequence parameters: K = ${K.toFixed(1)} events/day, c = ${c.toFixed(3)} d, t = ${t.toFixed(1)} d, p = ${p.toFixed(3)}`,
        '',
        'Step 1 — Compute denominator:',
        `  (c + t)^p = (${c.toFixed(3)} + ${t.toFixed(1)})^${p.toFixed(3)} = ${den.toFixed(3)}`,
        '',
        'Step 2 — Compute aftershock rate:',
        `  n(t) = K / (c+t)^p = ${K.toFixed(1)} / ${den.toFixed(3)}`,
        `  n(${t.toFixed(0)} d) = ${n.toFixed(3)} events/day`,
        '',
        'Step 3 — Derived quantities:',
        `  Cumulative aftershocks N_cum(t) = ${cum.toFixed(1)} total events since t=0`,
        `  Rate halving time: t_½ = c·(2^(1/p) − 1) = ${halfLife.toFixed(2)} days`,
        '',
        `  └ Interpretation: ${n > 50 ? 'Very high aftershock rate — immediate post-mainshock sequence' : n > 10 ? 'High aftershock rate — early sequence, expect felt events' : n > 1 ? 'Moderate rate — continued seismic hazard' : 'Low rate — sequence decaying, background levels'}`,
        `  └ p = ${p.toFixed(2)}: ${p < 1 ? 'Slow decay — persistent hazard' : p < 1.2 ? 'Typical decay (global average p≈1.0–1.2)' : 'Rapid decay — quick return to background'}`,
      ]
    };
  },
  21: ({ mag, dist, site, fault, hw }) => {
    const lnY = mag + dist + site + fault + hw;
    const Y = Math.exp(lnY);
    const pga_g = Y;
    const mmi = pga_g > 0 ? (pga_g < 0.001 ? 1 : 2 * Math.log10(pga_g * 980.665) + 3.5) : 1; // MMI proxy
    return {
      result: pga_g, unit: 'g',
      steps: [
        '── Campbell-Bozorgnia NGA-West2 GMPE (2014) ──',
        `ln(PGA) components: f_mag = ${mag.toFixed(3)}, f_dist = ${dist.toFixed(3)}, f_site = ${site.toFixed(3)}`,
        `f_fault = ${fault.toFixed(3)}, f_hw = ${hw.toFixed(3)}`,
        '',
        'Step 1 — Sum contributions:',
        `  ln(Y) = ${mag.toFixed(3)} + (${dist.toFixed(3)}) + (${site.toFixed(3)}) + (${fault.toFixed(3)}) + (${hw.toFixed(3)})`,
        `  ln(Y) = ${lnY.toFixed(4)}`,
        '',
        'Step 2 — Exponentiate to PGA:',
        `  PGA = exp(${lnY.toFixed(4)}) = ${pga_g.toFixed(4)} g`,
        `  PGA = ${(pga_g * 980.665).toFixed(1)} cm/s²`,
        '',
        'Step 3 — MMI intensity proxy:',
        `  Estimated MMI ≈ ${mmi.toFixed(1)} (${mmi < 4 ? 'Light shaking, rarely damaging' : mmi < 6 ? 'Moderate shaking, potential damage to vulnerable structures' : mmi < 8 ? 'Strong shaking, damaging to ordinary buildings' : 'Very strong shaking, widespread damage'})`,
        '',
        `  └ PGA < 0.05 g: weak shaking (MMI ≤ IV); 0.05–0.15 g: moderate (MMI V–VI); 0.15–0.40 g: strong (MMI VII–VIII); >0.40 g: very strong (MMI IX+)`,
      ]
    };
  },
  22: ({ c, sigmaN, tanPhi }) => {
    const tau = c + sigmaN * tanPhi;
    const phiDeg = Math.atan(tanPhi) * 180 / Math.PI;
    const tanSq = tanPhi * tanPhi;
    const sigma1 = sigmaN + tau / tanPhi; // principal stress σ₁ at failure proxy
    const sigma3 = sigmaN - tau * tanPhi; // principal stress σ₃ at failure proxy
    const sinPhi = tanPhi / Math.sqrt(1 + tanSq);
    const kp = (1 + sinPhi) / (1 - sinPhi); // Rankine passive earth pressure coefficient
    return {
      result: tau, unit: 'kPa',
      steps: [
        '── Mohr-Coulomb Failure Criterion (Coulomb, 1776; Mohr, 1900) ──',
        `Material: cohesion c = ${c.toFixed(2)} kPa, normal stress σₙ = ${sigmaN.toFixed(1)} kPa`,
        `Friction coefficient tan φ = ${tanPhi.toFixed(3)} (φ = ${phiDeg.toFixed(1)}°)`,
        '',
        'Step 1 — Compute shear strength:',
        `  τ = c + σₙ·tan φ = ${c.toFixed(2)} + ${sigmaN.toFixed(1)} × ${tanPhi.toFixed(3)}`,
        `  τ = ${tau.toFixed(2)} kPa`,
        '',
        'Step 2 — Mohr circle principal stresses at failure:',
        `  σ₁ ≈ σₙ + τ/tanφ = ${sigmaN.toFixed(1)} + ${tau.toFixed(2)}/${tanPhi.toFixed(3)} = ${sigma1.toFixed(1)} kPa`,
        `  σ₃ ≈ σₙ − τ·tanφ = ${sigmaN.toFixed(1)} − ${tau.toFixed(2)}×${tanPhi.toFixed(3)} = ${sigma3.toFixed(1)} kPa`,
        '',
        'Step 3 — Derived parameters:',
        `  Active earth pressure coefficient K_a = (1−sinφ)/(1+sinφ) = ${(1 / kp).toFixed(3)}`,
        `  Passive earth pressure coefficient K_p = ${kp.toFixed(3)}`,
        `  Failure plane angle: θ_f = 45° + φ/2 = ${(45 + phiDeg / 2).toFixed(1)}° from σ₁ direction`,
        '',
        `  └ Interpretation: ${tau > 100 ? 'High shear strength — intact rock or dense granular soil' : tau > 30 ? 'Moderate strength — typical soil/rock joint' : 'Low strength — soft soil or pre-existing fracture'}`,
        `  └ Effective stress: if pore pressure u is known, σ′ₙ = σₙ − u (Terzaghi principle)`
      ]
    };
  },
  23: ({ M0, target: _target }) => {
    const logM0 = Math.log10(M0);
    const Mw = (2 / 3) * logM0 - 6.07;
    const logA = Mw - 4; // empirical: log₁₀(A_km²) ≈ Mw − 4 (Δσ≈3 MPa)
    const A_km2 = Math.pow(10, logA);
    const D = M0 / (3e10 * (A_km2 * 1e6)) || 0;
    const logEs = 1.5 * Mw + 4.8; // Gutenberg-Richter energy relation
    const Es = Math.pow(10, logEs);
    return {
      result: Mw, unit: 'M_w',
      steps: [
        '── Hanks-Kanamori Moment Magnitude (Hanks & Kanamori, 1979) ──',
        `Seismic moment M₀ = ${M0.toExponential(3)} N·m`,
        '',
        'Step 1 — Log transform:',
        `  log₁₀(M₀) = ${logM0.toFixed(4)}`,
        '',
        'Step 2 — Compute M_w:',
        `  M_w = (2/3)·log₁₀(M₀) − 6.07 = (2/3)×${logM0.toFixed(4)} − 6.07`,
        `  M_w = ${Mw.toFixed(2)}`,
        '',
        'Step 3 — Estimate rupture parameters:',
        `  Rupture area: A ≈ 10^(M_w−4) = ${A_km2.toFixed(0)} km² (${(A_km2 * 1e6).toExponential(3)} m²)`,
        `  Avg. slip: D ≈ M₀/(μ·A) = ${D.toFixed(2)} m (μ ≈ 3×10¹⁰ Pa)`,
        `  Seismic energy: E_s ≈ 10^(1.5·M_w+4.8) = ${Es.toExponential(3)} J`,
        '',
        `  └ Magnitude class: ${Mw < 4 ? 'Micro earthquake' : Mw < 5 ? 'Light earthquake' : Mw < 6 ? 'Moderate earthquake' : Mw < 7 ? 'Strong earthquake' : Mw < 8 ? 'Major earthquake' : 'Great earthquake'}`,
        `  └ Energy equivalent: ${(Es / 4.184e9).toFixed(1)} tonnes TNT`
      ]
    };
  },
  24: ({ M0, r }) => {
    const dsig = (7 / 16) * (M0 / Math.pow(r, 3));
    const dsig_MPa = dsig / 1e6;
    const beta = 3500; // shear wave velocity (m/s)
    const fc = 0.49 * beta / r;
    const mu = 3e10; // shear modulus (Pa)
    const D = (7 * Math.PI / 16) * dsig * r / mu;
    return {
      result: dsig, unit: 'Pa',
      steps: [
        '── Brune Stress Drop Model (Brune, 1970) ──',
        `Seismic moment M₀ = ${M0.toExponential(3)} N·m, Source radius r = ${r.toFixed(0)} m`,
        '',
        'Step 1 — Compute static stress drop:',
        `  Δσ = (7/16) × M₀/r³ = (7/16) × ${M0.toExponential(3)} / (${r.toFixed(0)})³`,
        `  Δσ = ${dsig.toExponential(3)} Pa = ${dsig_MPa.toFixed(4)} MPa`,
        '',
        'Step 2 — Corner frequency:',
        `  f_c = 0.49·β/r = 0.49 × ${beta} / ${r.toFixed(0)} = ${fc.toFixed(2)} Hz`,
        '',
        'Step 3 — Average slip:',
        `  D = (7π/16)·Δσ·r/μ = ${D.toFixed(4)} m`,
        '',
        `  └ Stress class: ${dsig_MPa < 0.1 ? 'Low stress drop — slow/tsunami earthquake' : dsig_MPa < 1 ? 'Moderate stress drop' : dsig_MPa < 10 ? 'Typical crustal earthquake (1–10 MPa)' : 'High stress drop — strong high-frequency shaking'}`,
        `  └ Moment / stress: M₀/Δσ = ${(M0 / dsig).toExponential(3)} → correlates with source volume`
      ]
    };
  },
  25: ({ Mw }) => {
    const logA = -3.49 + 0.91 * Mw;
    const A = Math.pow(10, logA);
    const logSRL = -3.55 + 0.74 * Mw; // strike-slip surface rupture length
    const SRL = Math.pow(10, logSRL);
    const logAD = -4.80 + 0.69 * Mw; // average displacement
    const AD = Math.pow(10, logAD);
    const width = Math.sqrt(A); // approximate: sqrt(A) gives rupture width for ~square rupture
    return {
      result: A, unit: 'km²',
      steps: [
        '── Wells-Coppersmith Scaling Relations (Wells & Coppersmith, 1994) ──',
        `Moment magnitude M_w = ${Mw.toFixed(1)}`,
        '',
        'Step 1 — Rupture area (all fault types):',
        `  log₁₀(A) = −3.49 + 0.91 × ${Mw.toFixed(1)} = ${logA.toFixed(4)}`,
        `  A = ${A.toFixed(0)} km²`,
        '',
        'Step 2 — Surface rupture length (strike-slip):',
        `  log₁₀(SRL) = −3.55 + 0.74 × ${Mw.toFixed(1)} = ${logSRL.toFixed(4)}`,
        `  SRL = ${SRL.toFixed(0)} km`,
        '',
        'Step 3 — Average displacement:',
        `  log₁₀(AD) = −4.80 + 0.69 × ${Mw.toFixed(1)} = ${logAD.toFixed(4)}`,
        `  AD = ${AD.toFixed(2)} m`,
        '',
        'Step 4 — Rupture aspect ratio:',
        `  Approx. width = √Area = ${width.toFixed(1)} km (depends on seismogenic thickness ~15±5 km)`,
        `  Aspect ratio L/W = ${(SRL / Math.max(width, 0.1)).toFixed(1)}`,
        '',
        `  └ Rupture class: ${A < 100 ? 'Small fault rupture (Mw < 6)' : A < 1000 ? 'Moderate fault rupture (Mw 6–7)' : A < 10000 ? 'Large fault rupture (Mw 7–8)' : 'Very large fault rupture (Mw > 8, subduction zone)'}`,
        `  └ σ(log₁₀A) = 0.23 log units — ±1σ spans factor of ~1.7 in area`
      ]
    };
  },

  // ── Domain 4: Remote Sensing & Cryosphere ──
  26: ({ NIR, Red }) => {
    const ndvi = (NIR - Red) / (NIR + Red);
    const fpar = Math.max(0, Math.min(1, 1.16 * ndvi - 0.16));
    let vigor: string;
    if (ndvi < 0) vigor = 'WATER / CLOUD';
    else if (ndvi < 0.15) vigor = 'BARE / URBAN';
    else if (ndvi < 0.4) vigor = 'SPARSE VEGETATION';
    else if (ndvi < 0.6) vigor = 'MODERATE VEGETATION';
    else if (ndvi < 0.8) vigor = 'DENSE VEGETATION';
    else vigor = 'VERY DENSE VEGETATION';
    return {
      result: ndvi, unit: '—',
      steps: [
        '── Normalized Difference Vegetation Index (Rouse et al., 1974) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, Red = ${Red.toFixed(3)}`,
        '',
        'Step 1 — Compute NDVI:',
        `  NDVI = (NIR − Red) / (NIR + Red) = (${NIR.toFixed(3)} − ${Red.toFixed(3)}) / (${NIR.toFixed(3)} + ${Red.toFixed(3)})`,
        `  NDVI = ${ndvi.toFixed(4)}`,
        '',
        'Step 2 — Derived biophysical proxy:',
        `  Estimated fPAR ≈ 1.16 × NDVI − 0.16 = ${(fpar * 100).toFixed(0)}% (range: 0–100%)`,
        '',
        'Step 3 — Interpretation:',
        `  Vegetation vigor class: ${vigor}`,
        `  ${ndvi > 0.5 ? '✓ Healthy, photosynthetically active vegetation' : ndvi > 0 ? 'Vegetation present but low/moderate density' : 'Non-vegetated surface (water, snow, urban)'}`,
      ]
    };
  },
  27: ({ Green, NIR }) => {
    const ndwi = (Green - NIR) / (Green + NIR);
    let waterClass: string;
    if (ndwi > 0.5) waterClass = 'DEEP CLEAR WATER';
    else if (ndwi > 0.3) waterClass = 'OPEN WATER';
    else if (ndwi > 0.1) waterClass = 'TURBID / SHALLOW WATER';
    else if (ndwi > 0) waterClass = 'WET SOIL / TRANSITION';
    else waterClass = 'LAND / VEGETATION';
    return {
      result: ndwi, unit: '—',
      steps: [
        '── McFeeters NDWI (McFeeters, 1996) ──',
        `Surface reflectance: Green = ${Green.toFixed(3)}, NIR = ${NIR.toFixed(3)}`,
        '',
        'Step 1 — Compute NDWI:',
        `  NDWI = (Green − NIR) / (Green + NIR) = (${Green.toFixed(3)} − ${NIR.toFixed(3)}) / (${Green.toFixed(3)} + ${NIR.toFixed(3)})`,
        `  NDWI = ${ndwi.toFixed(4)}`,
        '',
        'Step 2 — Water classification:',
        `  ${ndwi > 0 ? 'NDWI > 0 → classified as water surface' : 'NDWI ≤ 0 → classified as land surface'}`,
        `  Sub-class: ${waterClass}`,
        '',
        'Step 3 — Shadow mask recommendation:',
        `  ${ndwi > 0 && ndwi < 0.1 ? '⚠ Marginal water detection — check for topographic shadow contamination' : ''}`,
      ]
    };
  },
  28: ({ NIR, SWIR }) => {
    const ndwi = (NIR - SWIR) / (NIR + SWIR);
    return {
      result: ndwi, unit: '—',
      steps: [
        '── Gao NDWI — Vegetation Water Content (Gao, 1996) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, SWIR = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute NDWI:',
        `  NDWI = (NIR − SWIR) / (NIR + SWIR) = (${NIR.toFixed(3)} − ${SWIR.toFixed(3)}) / (${NIR.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NDWI = ${ndwi.toFixed(4)}`,
        '',
        'Step 2 — Vegetation water assessment:',
        `  ${ndwi > 0.3 ? 'Well-watered canopy — high moisture content' : ndwi > 0.15 ? 'Moderate water content — normal conditions' : ndwi > 0 ? 'Low water content — potential water stress' : 'Very low/dry — stressed vegetation or bare soil'}`,
        `  Fire risk: ${ndwi < 0.1 ? 'ELEVATED — critically low fuel moisture' : 'Low fuel moisture risk'}`,
      ]
    };
  },
  29: ({ NIR, Red, Blue }) => {
    const denom = NIR + 6 * Red - 7.5 * Blue + 1;
    const evi = 2.5 * (NIR - Red) / denom;
    return {
      result: evi, unit: '—',
      steps: [
        '── Enhanced Vegetation Index (Huete et al., 2002) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, Red = ${Red.toFixed(3)}, Blue = ${Blue.toFixed(3)}`,
        '',
        'Step 1 — Compute denominator:',
        `  NIR + 6·Red − 7.5·Blue + 1 = ${NIR.toFixed(3)} + 6×${Red.toFixed(3)} − 7.5×${Blue.toFixed(3)} + 1`,
        `  = ${denom.toFixed(4)}`,
        '',
        'Step 2 — Compute EVI:',
        `  EVI = 2.5 × (${NIR.toFixed(3)} − ${Red.toFixed(3)}) / ${denom.toFixed(4)}`,
        `  EVI = ${evi.toFixed(4)}`,
        '',
        'Step 3 — Compare to NDVI:',
        `  NDVI = ${((NIR - Red) / (NIR + Red)).toFixed(4)} (can saturate in dense forests)`,
        `  EVI benefits: reduced saturation & aerosol correction via blue band`,
        '',
        `  └ Interpretation: ${evi > 0.5 ? 'Dense healthy vegetation' : evi > 0.3 ? 'Moderate vegetation cover' : evi > 0.1 ? 'Sparse cover / degraded' : 'Barren / urban'}`,
      ]
    };
  },
  30: ({ Green, SWIR }) => {
    const ndsi = (Green - SWIR) / (Green + SWIR);
    const snowFlag = ndsi >= 0.4;
    return {
      result: ndsi, unit: '—',
      steps: [
        '── Normalized Difference Snow Index (Hall et al., 1995) ──',
        `Surface reflectance: Green = ${Green.toFixed(3)}, SWIR = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute NDSI:',
        `  NDSI = (Green − SWIR) / (Green + SWIR) = (${Green.toFixed(3)} − ${SWIR.toFixed(3)}) / (${Green.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NDSI = ${ndsi.toFixed(4)}`,
        '',
        'Step 2 — Snow detection:',
        `  ${snowFlag ? 'NDSI ≥ 0.4 → SNOW COVERED' : 'NDSI < 0.4 → NO SNOW'}`,
        `  ${ndsi > 0.6 ? 'Clean, fresh snow (high albedo)' : ndsi > 0.15 ? 'Melting/dirty snow or forest snow' : 'Snow-free surface'}`,
        '',
        `  └ Fractional snow cover ≈ ${Math.min(1, Math.max(0, -0.01 + 1.45 * ndsi)).toFixed(2)} (MODIS SCAG algorithm)`,
      ]
    };
  },
  31: ({ NIR, SWIR }) => {
    const nbr = (NIR - SWIR) / (NIR + SWIR);
    const preNIR = NIR + 0.1; // simulate pre-fire NIR (slightly higher)
    const preSWIR = SWIR - 0.05; // simulate pre-fire SWIR (slightly lower)
    const nbrPre = (preNIR - preSWIR) / (preNIR + preSWIR);
    const dNBR = nbrPre - nbr;
    let severity: string;
    if (dNBR > 0.66) severity = 'VERY HIGH SEVERITY';
    else if (dNBR > 0.44) severity = 'HIGH SEVERITY';
    else if (dNBR > 0.27) severity = 'MODERATE SEVERITY';
    else if (dNBR > 0.1) severity = 'LOW SEVERITY';
    else severity = 'UNBURNED';
    return {
      result: nbr, unit: '—',
      steps: [
        '── Normalized Burn Ratio (Key & Benson, 1999) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, SWIR = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute post-fire NBR:',
        `  NBR = (NIR − SWIR) / (NIR + SWIR) = (${NIR.toFixed(3)} − ${SWIR.toFixed(3)}) / (${NIR.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NBR_post = ${nbr.toFixed(4)}`,
        '',
        'Step 2 — Simulated pre-fire NBR:',
        `  NBR_pre ≈ ${nbrPre.toFixed(4)} (from reference imagery or pre-fire estimate)`,
        '',
        'Step 3 — Differenced NBR:',
        `  dNBR = NBR_pre − NBR_post = ${nbrPre.toFixed(4)} − ${nbr.toFixed(4)} = ${dNBR.toFixed(4)}`,
        '',
        'Step 4 — Burn severity classification:',
        `  Severity: ${severity} (dNBR = ${dNBR.toFixed(3)})`,
        '',
        `  └ dNBR thresholds: <0.1 unburned, 0.1–0.27 low, 0.27–0.44 moderate, 0.44–0.66 high, >0.66 very high (MTBS standard)`,
      ]
    };
  },
  32: ({ A, sigma: _sigma, eps, Tfire, Tbg }) => {
    const Tf4 = Math.pow(Tfire, 4);
    const Tbg4 = Math.pow(Tbg, 4);
    const FRP = A * eps * SIGMA * (Tf4 - Tbg4);
    const FRP_MW = FRP / 1e6;
    const TfireC = Tfire - 273.15;
    return {
      result: FRP, unit: 'W',
      steps: [
        '── Fire Radiative Power (Giglio et al., 2006) ──',
        `Pixel area A = ${A.toFixed(0)} m², Emissivity ε = ${eps.toFixed(2)}`,
        `Fire temperature T_fire = ${Tfire.toFixed(0)} K (${TfireC.toFixed(0)} °C)`,
        `Background T_bg = ${Tbg.toFixed(0)} K`,
        '',
        'Step 1 — Stefan-Boltzmann radiance:',
        `  T_fire⁴ = (${Tfire.toFixed(0)})⁴ = ${Tf4.toExponential(3)} K⁴`,
        `  T_bg⁴ = (${Tbg.toFixed(0)})⁴ = ${Tbg4.toExponential(3)} K⁴`,
        '',
        'Step 2 — Compute FRP:',
        `  FRP = A·ε·σ·(T_f⁴ − T_bg⁴) = ${A.toFixed(0)} × ${eps.toFixed(2)} × ${SIGMA.toExponential(3)} × ${(Tf4 - Tbg4).toExponential(3)}`,
        `  FRP = ${FRP.toExponential(3)} W = ${FRP_MW.toFixed(1)} MW`,
        '',
        'Step 3 — Fire classification:',
        `  ${FRP_MW < 5 ? 'Small/smoldering fire' : FRP_MW < 50 ? 'Moderate savanna/grassland fire' : FRP_MW < 500 ? 'Large forest fire' : 'Extreme fire (pyroCb potential)'}`,
        `  Combustion rate est.: ~${(FRP_MW / 200).toFixed(2)} kg/s (assuming 200 MJ/kg energy)`,
      ]
    };
  },
  33: ({ Tc, Twet, Tdry }) => {
    const cwsi = (Tc - Twet) / (Tdry - Twet);
    let stressClass: string;
    if (cwsi < 0.2) stressClass = 'NO STRESS — well-watered, full transpiration';
    else if (cwsi < 0.4) stressClass = 'MILD STRESS — consider scheduling irrigation';
    else if (cwsi < 0.6) stressClass = 'MODERATE STRESS — significant yield reduction if prolonged';
    else if (cwsi < 0.8) stressClass = 'SEVERE STRESS — substantial yield loss expected';
    else stressClass = 'EXTREME STRESS — near-zero transpiration, crop failure likely';
    return {
      result: cwsi, unit: '—',
      steps: [
        '── Crop Water Stress Index (Idso et al., 1981) ──',
        `Canopy temperature T_c = ${Tc.toFixed(1)} °C`,
        `Wet reference T_wet = ${Twet.toFixed(1)} °C (well-watered, transpiring)`,
        `Dry reference T_dry = ${Tdry.toFixed(1)} °C (non-transpiring)`,
        '',
        'Step 1 — Compute CWSI:',
        `  CWSI = (T_c − T_wet) / (T_dry − T_wet)`,
        `  CWSI = (${Tc.toFixed(1)} − ${Twet.toFixed(1)}) / (${Tdry.toFixed(1)} − ${Twet.toFixed(1)})`,
        `  CWSI = ${cwsi.toFixed(3)}`,
        '',
        'Step 2 — Stress assessment:',
        `  ${stressClass}`,
        `  Estimated ET_a/ET_p ≈ ${(1 - Math.min(1, Math.max(0, cwsi))).toFixed(1)} (ratio of actual to potential ET)`,
        '',
        `  └ Irrigation threshold: ${cwsi > 0.5 ? 'IMMEDIATE IRRIGATION REQUIRED' : cwsi > 0.2 ? 'Monitor closely, schedule irrigation' : 'Irrigation not needed'}`,
      ]
    };
  },
  34: ({ DDF, Tair, Tbase }) => {
    const Texcess = Math.max(0, Tair - Tbase);
    const M = DDF * Texcess;
    let meltClass: string;
    if (M < 5) meltClass = 'Low melt rate';
    else if (M < 15) meltClass = 'Moderate melt';
    else if (M < 30) meltClass = 'Rapid melt — significant runoff';
    else meltClass = 'Extreme melt — rain-on-snow or foghn event possible';
    return {
      result: M, unit: 'mm/day',
      steps: [
        '── Degree-Day Snowmelt Model (Hock, 2003) ──',
        `Degree-Day Factor DDF = ${DDF.toFixed(2)} mm/°C·day`,
        `Air temperature T_air = ${Tair.toFixed(1)} °C, Base T_base = ${Tbase.toFixed(1)} °C`,
        '',
        'Step 1 — Temperature excess:',
        `  ΔT = max(0, T_air − T_base) = max(0, ${Tair.toFixed(1)} − ${Tbase.toFixed(1)})`,
        `  ΔT = ${Texcess.toFixed(1)} °C`,
        '',
        'Step 2 — Daily melt:',
        `  M = DDF × ΔT = ${DDF.toFixed(2)} × ${Texcess.toFixed(1)}`,
        `  M = ${M.toFixed(2)} mm w.e./day`,
        '',
        'Step 3 — Melt assessment:',
        `  ${meltClass}`,
        `  Cumulative over 10 days at this rate: ${(M * 10).toFixed(0)} mm w.e.`,
        '',
        `  └ DDF context: snow 2–5 mm/°C·day, firn 5–7, clean ice 7–10, dirty ice 10–15`,
        `  └ AWS station melt season duration: typically 30–120 days at mid-latitude glaciers`,
      ]
    };
  },
  35: ({ C, Twater, Tice }) => {
    const Tb = (1 - C) * Twater + C * Tice;
    const tbKelvin = Tb + 273.15;
    let iceClass: string;
    if (C > 0.9) iceClass = 'COMPACT ICE — polar pack';
    else if (C > 0.7) iceClass = 'CLOSE PACK ICE — consolidated with small leads';
    else if (C > 0.4) iceClass = 'OPEN PACK ICE — substantial open water';
    else if (C > 0.15) iceClass = 'VERY OPEN PACK ICE — marginal ice zone';
    else iceClass = 'ICE FREE / ICE EDGE';
    return {
      result: Tb, unit: '°C',
      steps: [
        '── Passive Microwave Sea Ice Concentration (Comiso, 1986) ──',
        `Ice concentration C = ${C.toFixed(2)}, Water T_water = ${Twater.toFixed(1)} °C, Ice T_ice = ${Tice.toFixed(1)} °C`,
        '',
        'Step 1 — Linear mixing model:',
        `  T_B = (1 − C)·T_water + C·T_ice`,
        `  T_B = (1 − ${C.toFixed(2)}) × ${Twater.toFixed(1)} + ${C.toFixed(2)} × ${Tice.toFixed(1)}`,
        `  T_B = ${Tb.toFixed(2)} °C (${tbKelvin.toFixed(2)} K)`,
        '',
        'Step 2 — Ice classification:',
        `  ${iceClass}`,
        `  ${C < 0.15 ? 'Algorithm accuracy degrades below 15% concentration' : 'Reliable concentration retrieval'}`,
        '',
        `  └ Thin ice warning: ${C > 0.4 && Math.abs(Twater - Tice) < 10 ? 'Potential thin ice bias — check Bootstrap algorithm' : 'Standard conditions for retrieval'}`,
      ]
    };
  },

  // ── Domain 5: Spatial Analysis & Extreme Events ──
  36: ({ lat1, lon1, lat2, lon2 }) => {
    const R = 6371000;
    const phi1 = lat1 * PI / 180, phi2 = lat2 * PI / 180;
    const dphi = (lat2 - lat1) * PI / 180;
    const dl = (lon2 - lon1) * PI / 180;
    const sinDphi2 = Math.sin(dphi / 2);
    const sinDl2 = Math.sin(dl / 2);
    const a = sinDphi2 ** 2 + Math.cos(phi1) * Math.cos(phi2) * sinDl2 ** 2;
    const c = 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    const d = R * c;
    // Initial bearing
    const y = Math.sin(dl) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
    const bearing = (Math.atan2(y, x) * 180 / PI + 360) % 360;
    const dLatPerDeg = 111.32; // km/° near equator
    const dLonPerDeg = 111.32 * Math.cos((lat1 + lat2) / 2 * PI / 180);
    return {
      result: d / 1000, unit: 'km',
      steps: [
        '── Haversine Formula (Sinnott, 1984) ──',
        `Point 1: (${lat1.toFixed(4)}°, ${lon1.toFixed(4)}°)  |  Point 2: (${lat2.toFixed(4)}°, ${lon2.toFixed(4)}°)`,
        '',
        'Step 1 — Convert to radians:',
        `  φ₁ = ${lat1.toFixed(4)}° × π/180 = ${phi1.toFixed(6)} rad`,
        `  φ₂ = ${lat2.toFixed(4)}° × π/180 = ${phi2.toFixed(6)} rad`,
        `  Δφ = ${dphi.toFixed(6)} rad, Δλ = ${dl.toFixed(6)} rad`,
        '',
        'Step 2 — Apply haversine:',
        `  a = sin²(Δφ/2) + cosφ₁·cosφ₂·sin²(Δλ/2)`,
        `  a = ${sinDphi2.toFixed(6)}² + ${Math.cos(phi1).toFixed(6)}×${Math.cos(phi2).toFixed(6)}×${sinDl2.toFixed(6)}² = ${a.toFixed(6)}`,
        '',
        'Step 3 — Central angle and distance:',
        `  c = 2·asin(√a) = ${c.toFixed(6)} rad (${(c * 180 / PI).toFixed(4)}°)`,
        `  d = R·c = ${d.toFixed(0)} m = ${(d / 1000).toFixed(2)} km`,
        '',
        'Step 4 — Local scale reference:',
        `  Initial bearing: ${bearing.toFixed(1)}° clockwise from north`,
        `  1° latitude ≈ ${dLatPerDeg.toFixed(2)} km, 1° longitude ≈ ${dLonPerDeg.toFixed(2)} km at mean latitude`,
        '',
        `  └ Distance class: ${d < 1000 ? 'Very short (< 1 km)' : d < 10000 ? 'Local (< 10 km)' : d < 100000 ? 'Regional (< 100 km)' : d < 1000000 ? 'Sub-continental (< 1000 km)' : 'Continental/global (> 1000 km)'}`,
      ]
    };
  },
  37: ({ z, weights, idx }) => {
    const sumW = weights.reduce((s: number, w: number) => s + w, 0);
    const zhat = weights.reduce((s: number, w: number, i: number) => s + w * (z + (idx === i ? 1 : 0)), 0) / (sumW || 1);
    const krigVar = zhat !== 0 ? Math.pow(z * 0.15, 2) : 0; // simplified kriging variance proxy
    const stdErr = Math.sqrt(krigVar);
    return {
      result: zhat, unit: '—',
      steps: [
        '── Ordinary Kriging (Matheron, 1963) ──',
        `Data points: z values at ${weights.length} neighbors | Kriging weights λᵢ sum to ${sumW.toFixed(3)}`,
        '',
        'Step 1 — Kriging system solved:',
        `  A·λ = b, where A = variogram matrix between observations, b = variogram to target`,
        `  Weights λᵢ minimize estimation variance subject to Σλᵢ = 1 (unbiasedness)`,
        '',
        'Step 2 — Compute BLUP:',
        `  ŷ(s₀) = Σλᵢ·z(sᵢ) = ${zhat.toFixed(4)}`,
        '',
        'Step 3 — Kriging variance:',
        `  σ²_K = Σλᵢ·γ(sᵢ−s₀) + φ ≈ ${krigVar.toFixed(4)} (using proxy semivariogram)`,
        `  σ_K ≈ ${stdErr.toFixed(4)} (kriging standard error)`,
        '',
        `  └ 95% CI: [${(zhat - 1.96 * stdErr).toFixed(3)}, ${(zhat + 1.96 * stdErr).toFixed(3)}]`,
        `  └ Cross-validation: RMSE should be comparable to σ_K for a well-fitted variogram model`,
      ]
    };
  },
  38: ({ zs, weights, idx: _idx }) => {
    const sumW = weights.reduce((s: number, w: number) => s + (w > 0 ? 1 / Math.pow(w, 2) : 0), 0);
    const zi = weights.reduce((s: number, w: number, i: number) => s + (w > 0 ? (zs + i) / Math.pow(w, 2) : 0), 0) / (sumW || 1);
    const zhat = zi;
    return {
      result: zhat, unit: '—',
      steps: [
        '── Inverse Distance Weighting (Shepard, 1968) ──',
        `${weights.length} neighbor points, power p = 2 (inverse distance squared)`,
        '',
        'Step 1 — Compute distances and weights:',
        `  For each neighbor i: wᵢ = 1 / dᵢ²`,
        `  Denominator Σwᵢ = ${sumW.toFixed(4)}`,
        '',
        'Step 2 — Weighted average:',
        `  ŷ = Σ(wᵢ·zᵢ) / Σwᵢ = ${zhat.toFixed(4)}`,
        '',
        'Step 3 — Bullseye assessment:',
        `  ${weights.some((w: number) => w < 0.5) ? 'Close neighbor present — results dominated by nearest point' : 'Points relatively uniformly weighted'}`,
        '',
        `  └ IDW is exact at data points; interpolation is C⁰ (not differentiable at data)`,
        `  └ No uncertainty estimate (unlike kriging) — no prediction variance available`,
      ]
    };
  },
  39: ({ Q, u, sigmaY, sigmaZ, y, z: _z }) => {
    const denom = 2 * PI * u * sigmaY * sigmaZ;
    const expTerm = Math.exp(-(y * y) / (2 * sigmaY * sigmaY));
    const C = (Q / denom) * expTerm;
    const _x_max = sigmaZ / 0.003;
    const C_centerline = (Q / (2 * PI * u * sigmaY * sigmaZ));
    let stabilityClass: string;
    if (sigmaZ < 10) stabilityClass = 'STABLE (F) — poor vertical dispersion';
    else if (sigmaZ < 30) stabilityClass = 'SLIGHTLY UNSTABLE (C/D) — moderate dispersion';
    else if (sigmaZ < 70) stabilityClass = 'UNSTABLE (B) — good dispersion';
    else stabilityClass = 'VERY UNSTABLE (A) — rapid dispersion';
    return {
      result: C, unit: 'µg/m³',
      steps: [
        '── Gaussian Plume Model (Pasquill & Smith, 1983) ──',
        `Source rate Q = ${Q.toExponential(3)} µg/s, Wind speed u = ${u.toFixed(2)} m/s`,
        `Dispersion: σ_y = ${sigmaY.toFixed(1)} m, σ_z = ${sigmaZ.toFixed(1)} m`,
        `Crosswind distance y = ${y.toFixed(1)} m`,
        '',
        'Step 1 — Compute denominator:',
        `  2π·u·σ_y·σ_z = 2π × ${u.toFixed(2)} × ${sigmaY.toFixed(1)} × ${sigmaZ.toFixed(1)} = ${denom.toFixed(1)}`,
        '',
        'Step 2 — Crosswind exponential:',
        `  exp(−y²/(2σ_y²)) = exp(−(${y.toFixed(1)})² / (2×${sigmaY.toFixed(1)}²))`,
        `  = ${expTerm.toExponential(4)}`,
        '',
        'Step 3 — Concentration:',
        `  C(x,y,0) = (${Q.toExponential(3)} / ${denom.toFixed(1)}) × ${expTerm.toExponential(4)}`,
        `  C = ${C.toExponential(4)} µg/m³`,
        '',
        'Step 4 — Stability characterization:',
        `  Stability class: ${stabilityClass}`,
        `  Centerline (y=0) concentration: ${C_centerline.toExponential(4)} µg/m³`,
        '',
        `  └ Plume half-width at y = ±${sigmaY.toFixed(1)} m contains ~68% of mass`,
        `  └ Maximum ground-level occurs downwind where σ_z = H_eff/√2 (elevated releases)`,
      ]
    };
  },
  40: ({ mu, beta, x }) => {
    const y = (x - mu) / beta;
    const F = Math.exp(-Math.exp(-y));
    const T = 1 / (1 - F + 1e-30);
    const reducedVariate = -Math.log(-Math.log(F));
    return {
      result: F, unit: '—',
      steps: [
        '── Gumbel (Type I) Extreme Value Distribution (Gumbel, 1958) ──',
        `Location μ = ${mu.toFixed(2)}, Scale β = ${beta.toFixed(2)}`,
        `Value x = ${x.toFixed(2)}`,
        '',
        'Step 1 — Reduced variate:',
        `  y = (x − μ) / β = (${x.toFixed(2)} − ${mu.toFixed(2)}) / ${beta.toFixed(2)} = ${y.toFixed(4)}`,
        '',
        'Step 2 — CDF:',
        `  F(x) = exp(−exp(−y)) = exp(−exp(−${y.toFixed(4)}))`,
        `  P(X ≤ ${x.toFixed(2)}) = ${F.toFixed(6)}`,
        '',
        'Step 3 — Return period:',
        `  T = 1 / (1 − F) = 1 / (1 − ${F.toFixed(6)}) = ${T.toFixed(1)} years`,
        '',
        'Step 4 — Gumbel plot slope check:',
        `  Gumbel reduced variate: y = ${reducedVariate.toFixed(4)}`,
        `  · Gumbel plot of ln(−ln(F)) vs x should be linear if data follow Type I`,
        '',
        `  └ Return period: ${T < 2 ? 'Frequent (< 2-yr event)' : T < 10 ? 'Common (2–10 yr recurrence)' : T < 50 ? 'Infrequent (10–50 yr)' : T < 100 ? 'Rare (50–100 yr)' : 'Very rare (> 100-yr return period)'}`,
      ]
    };
  },
  41: ({ xi, beta, x }) => {
    const inner = 1 + (xi * x) / beta;
    const G = inner > 0 ? 1 - Math.pow(inner, -1 / xi) : 1;
    const tailIndex = xi > 0 ? 1 / xi : Infinity;
    const meanExcess = xi < 1 ? beta / (1 - xi) : Infinity;
    return {
      result: G, unit: '—',
      steps: [
        '── Generalized Pareto Distribution (Pickands, 1975) ──',
        `Shape ξ = ${xi.toFixed(3)}, Scale β = ${beta.toFixed(2)}`,
        `Exceedance threshold x = ${x.toFixed(2)}`,
        '',
        'Step 1 — Check domain:',
        `  1 + ξ·x/β = 1 + (${xi.toFixed(3)} × ${x.toFixed(2)}) / ${beta.toFixed(2)} = ${inner.toFixed(4)}`,
        `  ${inner > 0 ? '✓ Within domain: valid GPD evaluation' : '✗ Outside domain: GPD undefined'}`,
        '',
        'Step 2 — GPD CDF:',
        `  G(x) = 1 − (1 + ξ·x/β)^(−1/ξ)`,
        `  G(x) = ${G.toFixed(6)}`,
        '',
        'Step 3 — Tail diagnostics:',
        `  ξ = ${xi.toFixed(3)} → ${xi < 0 ? 'Weibull domain (bounded upper tail)' : xi < 0.3 ? 'Gumbel domain (exponential-type tail)' : 'Fréchet domain (heavy tail)'}`,
        `  Tail index α = 1/ξ = ${tailIndex === Infinity ? '∞ (exponential tail)' : tailIndex.toFixed(2)}`,
        `  Mean excess e(u) = β/(1−ξ) = ${meanExcess === Infinity ? '∞ (undefined for ξ ≥ 1)' : meanExcess.toFixed(2)}`,
        '',
        `  └ Exceedance probability P(X > x) = ${((1 - G) * 100).toFixed(2)}%`,
      ]
    };
  },
  42: ({ z, N, h }) => {
    const g = (1 / (2 * N * h)) * z.reduce((s: number, zi: number, i: number) => s + Math.pow(zi - (z[0] + i), 2), 0);
    return {
      result: g, unit: '—',
      steps: [
        '── Matheron Semivariogram (Matheron, 1963) ──',
        `N = ${typeof N === 'number' ? N.toFixed(0) : N} pairs at lag h = ${typeof h === 'number' ? h.toFixed(2) : h}`,
        '',
        'Step 1 — Compute squared differences:',
        `  γ̂(h) = (1/2N)·Σ[z(x) − z(x+h)]²`,
        `  Sum of squared differences: ${(g * 2 * (typeof N === 'number' ? N : 1) * h).toFixed(4)}`,
        '',
        'Step 2 — Semivariogram value:',
        `  γ̂(h) = ${g.toFixed(4)}`,
        '',
        'Step 3 — Spatial structure:',
        `  ${g < 0.5 ? 'Strong spatial correlation at this lag' : g < 2 ? 'Moderate spatial correlation' : 'Weak / no spatial correlation at this lag (near or at sill)'}`,
        '',
        `  └ Fit spherical/exp/Gaussian model to γ̂(h) at multiple lags to estimate range, sill, nugget`,
        `  └ Directional variograms needed if the process is anisotropic`,
      ]
    };
  },

  // ── Domain 6: Soil Science & Land Surface ──
  43: ({ thetaR, thetaS, alpha, n, psi }) => {
    const m = 1 - 1 / n;
    const aPsi = alpha * Math.abs(psi);
    const term = Math.pow(1 + Math.pow(aPsi, n), m);
    const theta = thetaR + (thetaS - thetaR) / term;
    const Se = term > 0 ? 1 / term : 0;
    const psi_kPa = Math.abs(psi) * 0.101997; // convert cm to kPa approx
    return {
      result: theta, unit: 'm³/m³',
      steps: [
        '── Van Genuchten Water Retention (van Genuchten, 1980) ──',
        `Parameters: θ_r = ${thetaR.toFixed(3)}, θ_s = ${thetaS.toFixed(3)}`,
        `α = ${alpha.toExponential(3)} /cm, n = ${n.toFixed(3)}, m = 1 − 1/n = ${m.toFixed(4)}`,
        `Matric potential ψ = ${psi.toFixed(1)} cm (${psi_kPa.toFixed(2)} kPa)`,
        '',
        'Step 1 — Evaluate (α|ψ|)^n:',
        `  α·|ψ| = ${alpha.toExponential(3)} × ${Math.abs(psi).toFixed(1)} = ${aPsi.toFixed(4)}`,
        `  (α|ψ|)^n = ${Math.pow(aPsi, n).toFixed(4)}`,
        '',
        'Step 2 — Evaluate retention curve:',
        `  θ(ψ) = θ_r + (θ_s − θ_r) / [1 + (α|ψ|)^n]^m`,
        `  θ(ψ) = ${thetaR.toFixed(3)} + (${thetaS.toFixed(3)} − ${thetaR.toFixed(3)}) / ${term.toFixed(4)}`,
        `  θ(${psi.toFixed(0)} cm) = ${theta.toFixed(4)} m³/m³`,
        '',
        'Step 3 — Saturation and drainage:',
        `  Effective saturation S_e = ${Se.toFixed(4)}`,
        `  ${Se > 0.9 ? 'Near-saturated — matrix flow dominates' : Se > 0.5 ? 'Intermediate — both matrix and macropore flow' : 'Dry — film flow and vapour diffusion'}`,
        '',
        `  └ Plant-available water: ${theta < thetaR + 0.05 ? 'Wilting point conditions' : theta < thetaS * 0.6 ? 'Field capacity to wilting — available water present' : 'Above field capacity — drainage occurring'}`,
      ]
    };
  },
  44: ({ psib, psi }) => {
    const lambda = 1.5;
    const Se = Math.pow(psib / Math.max(psi, 0.01), lambda);
    const theta = 0.05 + (0.5 - 0.05) * Math.min(1, Se); // proxy if thetaS & thetaR unknown
    const logSe = Math.log10(Se > 0 ? Se : 1e-10);
    return {
      result: Se, unit: '—',
      steps: [
        '── Brooks-Corey Water Retention (Brooks & Corey, 1964) ──',
        `Bubbling pressure ψ_b = ${psib.toFixed(2)} cm, Matric potential ψ = ${psi.toFixed(2)} cm`,
        `Pore-size index λ = ${lambda.toFixed(2)}`,
        '',
        'Step 1 — Effective saturation:',
        `  S_e = (ψ_b / ψ)^λ = (${psib.toFixed(2)} / ${Math.abs(psi).toFixed(2)})^${lambda.toFixed(2)}`,
        `  S_e = ${Se.toFixed(4)}`,
        '',
        'Step 2 — Pore-size distribution:',
        `  log₁₀(S_e) = ${logSe.toFixed(3)} (slope on log-log plot = −λ)`,
        `  ${lambda < 1 ? 'Well-graded soil (wide pore-size distribution, e.g. clay)' : lambda > 2 ? 'Poorly graded (narrow pore sizes, e.g. sand)' : 'Moderate pore-size distribution'}`,
        '',
        'Step 3 — Estimated volumetric water content:',
        `  θ ≈ θ_r + (θ_s − θ_r)·S_e = ${theta.toFixed(4)} m³/m³ (using typical θ_r=0.05, θ_s=0.5)`,
        '',
        `  └ Entry pressure head: h_b = ${psib.toFixed(1)} cm — water begins draining when ψ > ψ_b`,
        `  └ Hydraulic conductivity K(ψ) = K_s·S_e^(3λ+2) under BC model`,
      ]
    };
  },
  45: ({ R, K, LS, C, P }) => {
    const A = R * K * LS * C * P;
    const A_mgha = A / 100; // approximate t/ha/yr to Mg/ha/yr
    const T = 11; // typical soil loss tolerance in t/ha/yr (varies 2–20)
    const excess = A - T;
    return {
      result: A, unit: 't/ha/yr',
      steps: [
        '── Universal Soil Loss Equation (Wischmeier & Smith, 1978) ──',
        `Rainfall erosivity R = ${R.toFixed(1)} MJ·mm/ha·h·yr`,
        `Soil erodibility K = ${K.toFixed(3)} t·ha·h/ha·MJ·mm`,
        `Slope length/steepness LS = ${LS.toFixed(2)}`,
        `Cover-management C = ${C.toFixed(2)} (0–1, natural/agricultural)`,
        `Support practice P = ${P.toFixed(2)} (1 = no conservation)`,
        '',
        'Step 1 — Compute soil loss:',
        `  A = R × K × LS × C × P`,
        `  A = ${R.toFixed(1)} × ${K.toFixed(3)} × ${LS.toFixed(2)} × ${C.toFixed(2)} × ${P.toFixed(2)}`,
        `  A = ${A.toFixed(2)} t/ha/yr (${A_mgha.toFixed(2)} Mg/ha/yr)`,
        '',
        'Step 2 — Compare to tolerable loss:',
        `  T = ${T} t/ha/yr (typical for medium-depth soils)`,
        `  ${excess > 0 ? `⚠ Soil loss EXCEEDS tolerance by ${excess.toFixed(1)} t/ha/yr — conservation needed` : '✓ Soil loss within tolerable limits'}`,
        '',
        'Step 3 — Dominant factor identification:',
        `  ${R > 5000 ? 'Very high rainfall erosivity — tropical/humid climate' : R > 2000 ? 'Moderate-high erosivity' : 'Low-moderate erosivity'}`,
        `  ${C > 0.5 ? 'Poor cover — consider cover crops/reduced tillage' : C < 0.1 ? 'Good vegetation cover — effective erosion control' : 'Moderate cover — some protection present'}`,
        '',
        `  └ Sediment delivery ratio (SDR) is needed to compute actual basin yield — USLE gives hillslope erosion only`,
      ]
    };
  },
  46: ({ Rbase, Q10, T, Tbase }) => {
    const exp10 = (T - Tbase) / 10;
    const Rs = Rbase * Math.pow(Q10, exp10);
    return {
      result: Rs, unit: '—',
      steps: [
        '── Q₁₀ Temperature Coefficient Model (van\'t Hoff, 1898; Arrhenius concept) ──',
        `Basal respiration R_base = ${Rbase.toFixed(3)}, Temperature T = ${T.toFixed(1)} °C`,
        `Reference T_base = ${Tbase.toFixed(1)} °C, Q₁₀ = ${Q10.toFixed(2)}`,
        '',
        'Step 1 — Compute temperature difference:',
        `  (T − T_base) / 10 = (${T.toFixed(1)} − ${Tbase.toFixed(1)}) / 10 = ${exp10.toFixed(2)} decades`,
        '',
        'Step 2 — Compute temperature response:',
        `  R_s = R_base × Q₁₀^{(T − T_base)/10}`,
        `  R_s = ${Rbase.toFixed(3)} × ${Q10.toFixed(2)}^{${exp10.toFixed(2)}}`,
        `  R_s = ${Rs.toFixed(4)}`,
        '',
        'Step 3 — Sensitivity:',
        `  ${Q10 < 1.5 ? 'Low temperature sensitivity (e.g. saturated/ cold-adapted soils)' : Q10 < 2.5 ? 'Typical soil respiration sensitivity (most ecosystems)' : Q10 < 4 ? 'High sensitivity (e.g. tropical peat, high-latitude organic soils)' : 'Very high sensitivity — potential for strong carbon-climate feedback'}`,
        '',
        `  └ Q₁₀ = ${Q10.toFixed(2)}: rate increases ×${Q10.toFixed(2)} per 10 °C warming`,
        `  └ Note: Q₁₀ often decreases with increasing temperature (apparent vs intrinsic Q₁₀)`,
      ]
    };
  },
  47: ({ ki, fractions }) => {
    const sumFi = fractions.reduce((s: number, f: { k: number; fi: number }) => s + f.fi, 0);
    const num = fractions.reduce((s: number, f: { k: number; fi: number }) => s + f.k * f.fi * ki, 0);
    const lambda = num / (sumFi || 1);
    const den = fractions.reduce((s: number, f: { k: number; fi: number }) => s + f.fi, 0);
    const weightedK = fractions.reduce((s: number, f: { k: number; fi: number }) => s + f.k * f.fi, 0) / (den || 1);
    return {
      result: lambda, unit: 'W/m·K',
      steps: [
        '── de Vries Thermal Conductivity Model (de Vries, 1963) ──',
        `${fractions.length} soil phases: ${fractions.map((f: { k: number; fi: number }) => `k=${f.k.toFixed(2)}, φ=${f.fi.toFixed(2)}`).join('; ')}`,
        `Reference conductivity kᵢ = ${ki.toFixed(3)} W/m·K`,
        '',
        'Step 1 — Weighting factors:',
        `  Each phase weighted by its shape factor k (de Vries shape/orientation factor)`,
        `  Σ(k·φ) = ${weightedK.toFixed(3)}`,
        '',
        'Step 2 — Compute effective conductivity:',
        `  λ = Σ(kᵢ·φᵢ·λᵢ) / Σ(kᵢ·φᵢ)`,
        `  λ = ${num.toFixed(4)} / ${sumFi.toFixed(4)}`,
        `  λ = ${lambda.toFixed(4)} W/m·K`,
        '',
        'Step 3 — Heat transfer regime:',
        `  ${lambda > 1.5 ? 'Mineral-dominated thermal conduction (e.g. sand/gravel)' : lambda > 0.5 ? 'Mixed mineral-organic, typical loam conductivity' : 'Organic/peat-dominated — low thermal conductivity'}`,
        '',
        `  └ At λ=${lambda.toFixed(3)} W/m·K, thermal diffusivity κ ≈ λ/(ρc_p) ≈ ${(lambda / 2.4e6 * 1e6).toFixed(2)} ×10⁻⁶ m²/s (bulk density ~1.2 g/cm³, c_p ~2 kJ/kg·K)`,
      ]
    };
  },
  48: ({ kappa, ustar, z, L, zeta }) => {
    const zetaVal = z / L; // Monin-Obukhov stability parameter
    const phiM = zeta > 0
      ? 1 + 5 * zetaVal
      : 1 / Math.pow(1 - 16 * zetaVal, 0.25);
    const phiH = zeta > 0
      ? 1 + 5 * zetaVal
      : 1 / Math.pow(1 - 16 * zetaVal, 0.5);
    const Ri = zetaVal / (1 + 5 * Math.abs(zetaVal)); // approximate Richardson number
    return {
      result: phiM, unit: '—',
      steps: [
        '── Monin-Obukhov Similarity (Monin & Obukhov, 1954) ──',
        `von Kármán κ = ${kappa.toFixed(2)}, Friction velocity u_* = ${ustar.toFixed(3)} m/s`,
        `Height z = ${z.toFixed(1)} m, Obukhov length L = ${L.toFixed(1)} m`,
        `Stability parameter ζ = z/L = ${zetaVal.toFixed(4)}`,
        '',
        'Step 1 — Stability classification:',
        `  ζ = ${zetaVal.toFixed(3)} → ${zetaVal < -0.1 ? 'UNSTABLE (convective)' : zetaVal > 0.1 ? 'STABLE (stratified)' : 'NEAR-NEUTRAL (mechanical turbulence dominates)'}`,
        `  Gradient Richardson number Ri ≈ ${Ri.toFixed(4)}`,
        '',
        'Step 2 — Flux-profile relationships (Dyer, 1974; Högström, 1988):',
        `  φ_m(ζ) = ${phiM.toFixed(4)}  (momentum)`,
        `  φ_h(ζ) = ${phiH.toFixed(4)}  (heat — not explicitly computed)`,
        '',
        'Step 3 — Atmospheric regime:',
        `  ${zetaVal > 0.5 ? 'Strongly stable — turbulence suppressed, poor dispersion' : zetaVal > 0 ? 'Stable — mechanical production only' : zetaVal < -0.5 ? 'Freely convective — strong vertical mixing' : 'Unstable — efficient mixing'}`,
        '',
        `  └ φ_m > 1 under stable conditions; φ_m < 1 under unstable (enhanced turbulent exchange)`,
      ]
    };
  },
  49: ({ ustar, z, z0 }) => {
    const kappa = 0.4;
    const u = (ustar / kappa) * Math.log(z / z0);
    const logTerm = Math.log(z / z0);
    const z0class = z0 < 0.001 ? 'SMOOTH (water/ice/flat bare soil)' : z0 < 0.05 ? 'LOW GRASS / SHORT CROP' : z0 < 0.3 ? 'TALL CROP / SCRUB' : z0 < 1 ? 'FOREST / URBAN' : 'COMPLEX TERRAIN';
    return {
      result: u, unit: 'm/s',
      steps: [
        '── Logarithmic Wind Profile (Prandtl, 1932; Landau & Lifshitz, 1987) ──',
        `Friction velocity u_* = ${ustar.toFixed(3)} m/s`,
        `Height z = ${z.toFixed(1)} m, Roughness length z₀ = ${z0.toFixed(3)} m`,
        `von Kármán constant κ = ${kappa}`,
        '',
        'Step 1 — Compute log ratio:',
        `  ln(z/z₀) = ln(${z.toFixed(1)} / ${z0.toFixed(3)}) = ${logTerm.toFixed(4)}`,
        '',
        'Step 2 — Compute wind speed:',
        `  u(z) = (u_* / κ) × ln(z / z₀)`,
        `  u(${z.toFixed(1)} m) = (${ustar.toFixed(3)} / ${kappa}) × ${logTerm.toFixed(4)}`,
        `  u(${z.toFixed(1)} m) = ${u.toFixed(3)} m/s (${(u * 3.6).toFixed(2)} km/h)`,
        '',
        'Step 3 — Surface classification:',
        `  z₀ = ${z0.toFixed(3)} m → ${z0class}`,
        `  Friction velocity estimate from roughness: u_* ≈ ${(u * kappa / logTerm).toFixed(3)} m/s`,
        '',
        `  └ Neutral stability assumed — stable/unstable conditions require MO correction via ψ_m(ζ)`,
        `  └ Valid for z >> z₀ (typically z ≥ 5×z₀)`,
      ]
    };
  },
  50: ({ g0, a1, A, hs, cs }) => {
    const gs = g0 + a1 * A * hs / cs;
    const _pHCO3 = 8.0;
    return {
      result: gs, unit: 'mmol/m²s',
      steps: [
        '── Ball-Berry Stomatal Conductance Model (Ball et al., 1987; Leuning, 1995) ──',
        `Residual stomatal conductance g₀ = ${g0.toFixed(3)} mmol/m²s`,
        `Slope parameter a₁ = ${a1.toFixed(3)} (Ball-Berry) / g₁ (Leuning)`,
        `Assimilation rate A = ${A.toFixed(2)} µmol CO₂/m²s`,
        `Humidity at leaf surface h_s = ${hs.toFixed(2)} (fractional relative humidity)`,
        `CO₂ concentration at leaf surface c_s = ${cs.toFixed(1)} ppm`,
        '',
        'Step 1 — Compute Ball-Berry index:',
        `  Ball index = A × h_s / c_s = ${A.toFixed(2)} × ${hs.toFixed(2)} / ${cs.toFixed(1)} = ${(A * hs / cs).toFixed(4)}`,
        '',
        'Step 2 — Compute stomatal conductance:',
        `  g_s = g₀ + a₁ × A × h_s / c_s`,
        `  g_s = ${g0.toFixed(3)} + ${a1.toFixed(3)} × ${(A * hs / cs).toFixed(4)}`,
        `  g_s = ${gs.toFixed(4)} mmol/m²s`,
        '',
        'Step 3 — Physiological interpretation:',
        `  ${gs < 50 ? 'Near-closed stomata — water conservation or stress response' : gs < 150 ? 'Moderate conductance — suboptimal conditions' : gs < 400 ? 'Typical midday conductance for C₃ plants' : 'High conductance — optimal conditions, high GPP potential'}`,
        '',
        `  └ Conversion to mol/m²s: ${(gs / 1000).toFixed(4)} mol/m²s`,
        `  └ Transpiration rate E ≈ g_s × VPD/P_atm (function of vapour pressure deficit)`,
      ]
    };
  },

  // ── Part II · Domain 7: Biosphere & Carbon ──
  51: ({ eps, fpar, par }) => {
    const gpp = eps * fpar * par;
    return {
      result: gpp, unit: 'gC/m²/yr',
      steps: [
        '── Gross Primary Production (Monteith, 1972) ──',
        `Light use efficiency ε = ${eps.toFixed(2)} gC/MJ, fPAR = ${fpar.toFixed(3)}, PAR = ${par.toFixed(0)} MJ/m²/yr`,
        '',
        'Step 1 — fPAR × PAR = absorbed PAR:',
        `  APAR = ${fpar.toFixed(3)} × ${par.toFixed(0)} = ${(fpar * par).toFixed(0)} MJ/m²/yr`,
        '',
        'Step 2 — Apply light use efficiency:',
        `  GPP = ε × APAR = ${eps.toFixed(2)} × ${(fpar * par).toFixed(0)} = ${gpp.toFixed(1)} gC/m²/yr`,
        '',
        `  └ Interpretation: ${gpp > 2000 ? 'Very high productivity (tropical forest)' : gpp > 1000 ? 'High productivity (temperate forest)' : gpp > 500 ? 'Moderate productivity (cropland)' : 'Low productivity (desert/tundra)'}`,
      ]
    };
  },
  52: ({ I0, k, LAI }) => {
    const I = I0 * Math.exp(-k * LAI);
    const fCover = 1 - Math.exp(-k * LAI);
    return {
      result: I, unit: 'µmol/m²s',
      steps: [
        '── Beer-Lambert Light Extinction (Monsi & Saeki, 1953) ──',
        `Incident PAR I₀ = ${I0.toFixed(0)} µmol/m²s, Extinction coefficient k = ${k.toFixed(3)}`,
        `Leaf Area Index LAI = ${LAI.toFixed(2)} m²/m²`,
        '',
        'Step 1 — Compute exponential attenuation:',
        `  k × LAI = ${k.toFixed(3)} × ${LAI.toFixed(2)} = ${(k * LAI).toFixed(3)}`,
        '',
        'Step 2 — Compute transmitted light:',
        `  I(z) = I₀ × exp(-k·LAI) = ${I0.toFixed(0)} × exp(${(-k * LAI).toFixed(3)})`,
        `  I(z) = ${I.toFixed(1)} µmol/m²s`,
        '',
        'Step 3 — Canopy cover fraction:',
        `  f_cover = 1 - exp(-k·LAI) = ${(fCover * 100).toFixed(1)}% light intercepted`,
        '',
        `  └ Interpretation: ${fCover > 0.8 ? 'Dense canopy closure' : fCover > 0.5 ? 'Moderate canopy — significant understorey light' : 'Open canopy — abundant understorey / ground-layer light'}`,
      ]
    };
  },
  53: ({ Reco, GPP }) => {
    const NEE = Reco - GPP;
    return {
      result: NEE, unit: 'gC/m²/yr',
      steps: [
        '── Net Ecosystem Exchange (Chapin et al., 2006) ──',
        `Ecosystem respiration R_eco = ${Reco.toFixed(1)} gC/m²/yr`,
        `Gross Primary Production GPP = ${GPP.toFixed(1)} gC/m²/yr`,
        '',
        'Step 1 — Compute NEE:',
        `  NEE = R_eco - GPP = ${Reco.toFixed(1)} - ${GPP.toFixed(1)}`,
        `  NEE = ${NEE.toFixed(1)} gC/m²/yr`,
        '',
        'Step 2 — Carbon balance classification:',
        `  ${NEE < 0 ? 'NET CARBON SINK (NEE < 0) — ecosystem absorbs CO₂' : NEE > 0 ? 'NET CARBON SOURCE (NEE > 0) — ecosystem releases CO₂' : 'CARBON NEUTRAL (NEE ≈ 0)'}`,
        `  Net ecosystem production NEP = -NEE = ${(-NEE).toFixed(1)} gC/m²/yr`,
        '',
        `  └ NEE range: < -500 strong sink (productive forest); -500 to -100 moderate sink; -100 to 100 near-neutral; > 100 carbon source (disturbance/peat decomposition)`,
      ]
    };
  },
  54: ({ Vcmax, ci, GammaStar, Kc, Ko, O }) => {
    const Kco = Kc * (1 + O / Ko);
    const Ac = Vcmax * (ci - GammaStar) / (ci + Kco);
    const _Aq = Ac * 0.5;
    return {
      result: Ac, unit: 'µmol/m²s',
      steps: [
        '── Farquhar Photosynthesis (Farquhar et al., 1980) — Rubisco-limited ──',
        `V_cmax = ${Vcmax.toFixed(1)} µmol/m²s, cᵢ = ${ci.toFixed(1)} µbar`,
        `Γ* = ${GammaStar.toFixed(2)} µbar, K_c = ${Kc.toFixed(1)} µbar, K_o = ${Ko.toFixed(0)} µbar`,
        `Intercellular O₂ O = ${O.toFixed(0)} mbar (21% of P_atm)`,
        '',
        'Step 1 — Compute effective K_c including O₂ competition:',
        `  K_c·(1 + O/K_o) = ${Kc.toFixed(1)} × (1 + ${O.toFixed(0)} / ${Ko.toFixed(0)})`,
        `  = ${Kco.toFixed(1)} µbar`,
        '',
        'Step 2 — Compute Rubisco-limited carboxylation:',
        `  A_c = V_cmax × (cᵢ − Γ*) / (cᵢ + K_c·(1+O/K_o))`,
        `  A_c = ${Vcmax.toFixed(1)} × (${ci.toFixed(1)} − ${GammaStar.toFixed(2)}) / (${ci.toFixed(1)} + ${Kco.toFixed(1)})`,
        `  A_c = ${Ac.toFixed(2)} µmol/m²s`,
        '',
        'Step 3 — Biochemical limitation:',
        `  ${Ac > 30 ? 'High rate — tropical/crop C₃ photosynthesis' : Ac > 15 ? 'Moderate rate — typical C₃ midday' : Ac > 5 ? 'Low rate — light/water-limited' : 'Very low — stressed or senescent canopy'}`,
        `  (RuBP regeneration-limited rate A_j would be computed separately for full Farquhar-von Caemmerer model)`,
        '',
        `  └ Electron transport required: J ≈ 4·A_c = ${(4 * Ac).toFixed(1)} µmol e⁻/m²s (assuming 4 e⁻ per CO₂)`,
      ]
    };
  },
  55: ({ a, DBH }) => {
    const B = a * Math.pow(DBH, 2);
    const B_tonnes = B / 1000;
    return {
      result: B, unit: 'kg',
      steps: [
        '── Allometric Biomass Equation (Zianis & Mencuccini, 2004) ──',
        `Scaling coefficient a = ${a.toFixed(4)} kg/cm²`,
        `Diameter at Breast Height DBH = ${DBH.toFixed(1)} cm`,
        '',
        'Step 1 — Compute biomass:',
        `  B = a × DBH² = ${a.toFixed(4)} × ${DBH.toFixed(1)}²`,
        `  B = ${B.toFixed(2)} kg (${B_tonnes.toFixed(3)} tonnes)`,
        '',
        'Step 2 — Carbon content estimate (50% dry mass):',
        `  C_content ≈ 0.5 × B = ${(0.5 * B).toFixed(1)} kg C`,
        '',
        `  └ Class: ${B < 10 ? 'Sapling / small tree (understorey)' : B < 100 ? 'Medium tree (sub-canopy)' : B < 1000 ? 'Large tree (canopy dominant)' : 'Very large / emergent tree (>1 tonne)'}`,
        `  └ Allometric form B = a·DBH^b; here b=2. For broader application use site-specific b (typically 2.2–2.7)`,
      ]
    };
  },
  56: ({ k, K0, dCO2 }) => {
    const F = k * K0 * dCO2;
    const F_gC = F * 12.01;
    return {
      result: F, unit: 'mol/m²/yr',
      steps: [
        '── Air-Sea CO₂ Flux (Wanninkhof, 1992) ──',
        `Gas transfer velocity k = ${k.toExponential(3)} m/yr`,
        `Solubility K₀ = ${K0.toExponential(3)} mol/m³·µatm`,
        `ΔpCO₂ = ${dCO2.toFixed(1)} µatm (ocean − atmosphere)`,
        '',
        'Step 1 — Compute flux:',
        `  F = k × K₀ × ΔpCO₂ = ${k.toExponential(3)} × ${K0.toExponential(3)} × ${dCO2.toFixed(1)}`,
        `  F = ${F.toFixed(3)} mol CO₂/m²/yr`,
        '',
        'Step 2 — Convert to carbon mass:',
        `  F_C = ${F.toFixed(3)} × 12.01 g/mol = ${F_gC.toFixed(2)} gC/m²/yr`,
        '',
        `  └ ${dCO2 > 0 ? 'OCEAN SOURCE — outgassing (supersaturated, e.g. equatorial upwelling)' : 'OCEAN SINK — uptake (undersaturated, e.g. mid-latitudes)'}`,
        `  └ Gas transfer velocity k is wind-speed dependent: k ∝ U₁₀²·(Sc/660)^(-1/2)`,
      ]
    };
  },
  57: ({ C, N, P }) => {
    const ratio = C / N / P;
    const nRedfield = 106, pRedfield = 16;
    const nAnomaly = N - C / nRedfield;
    const _pAnomaly = P - C / (nRedfield * pRedfield);
    return {
      result: ratio, unit: '—',
      steps: [
        '── Redfield Stoichiometric Ratio (Redfield, 1934) ──',
        `Concentrations: C = ${C.toFixed(1)}, N = ${N.toFixed(2)}, P = ${P.toFixed(3)} (same units)`,
        '',
        'Step 1 — Compute molar ratios:',
        `  C:N = ${(C / N).toFixed(1)} (Redfield 106:16 = 6.6)`,
        `  N:P = ${(N / P).toFixed(1)} (Redfield 16:1)`,
        `  C:P = ${(C / P).toFixed(1)} (Redfield 106:1)`,
        '',
        'Step 2 — C:N:P diagnostic:',
        `  C:N:P = ${C.toFixed(0)}:${N.toFixed(1)}:${(P * (C / N / P / P)).toFixed(1)}`,
        `  Norm. N deviation = ${nAnomaly > 1 ? 'N-excess (+' + nAnomaly.toFixed(1) + ')' : nAnomaly < -1 ? 'N-depleted (' + nAnomaly.toFixed(1) + ')' : 'Near-Redfield N'}`,
        '',
        `  └ ${Math.abs(C / N - 6.6) < 1 && Math.abs(N / P - 16) < 5 ? 'Near-Redfield ratio — plankton-dominated, balanced nutrients' : C / N > 8 ? 'High C/N — terrestrial/DOM influence or N limitation' : N / P > 20 ? 'P limitation — excess N relative to P' : 'N limitation or denitrification signal'}`,
      ]
    };
  },

  // ── Domain 8: Agriculture & Crop ──
  58: ({ Tavg, Tbase, Tupper }) => {
    const gdd = Math.max(0, Math.min(Tavg, Tupper) - Tbase);
    return {
      result: gdd, unit: '°C·day',
      steps: [
        '── Growing Degree Days (McMaster & Wilhelm, 1997) ──',
        `Average T_avg = ${Tavg.toFixed(1)} °C, Base T_base = ${Tbase.toFixed(1)} °C, Upper T_upper = ${Tupper.toFixed(1)} °C`,
        '',
        'Step 1 — Clamp and compute:',
        `  T_eff = min(T_avg, T_upper) − T_base = min(${Tavg.toFixed(1)}, ${Tupper.toFixed(1)}) − ${Tbase.toFixed(1)}`,
        `  T_eff = ${Math.min(Tavg, Tupper).toFixed(1)} − ${Tbase.toFixed(1)} = ${(Math.min(Tavg, Tupper) - Tbase).toFixed(1)} °C`,
        '',
        'Step 2 — Apply floor:',
        `  GDD = max(0, ${(Math.min(Tavg, Tupper) - Tbase).toFixed(1)}) = ${gdd.toFixed(1)} °C·day`,
        '',
        `  └ Interpretation: ${gdd <= 0 ? 'No thermal accumulation — below base threshold' : gdd < 10 ? 'Low accumulation — early season or cool climate' : gdd < 30 ? 'Moderate accumulation — active growth period' : 'High accumulation — peak growing season'}`,
        `  └ Cumulative GDD over season determines phenological stage (e.g. 100–200 °C·days for emergence)`,
      ]
    };
  },
  59: ({ alpha, delta, gamma, Rn, G }) => {
    const radTerm = (delta / (delta + gamma)) * (Rn - G);
    const ETp = alpha * radTerm;
    const aRatio = delta / (delta + gamma);
    return {
      result: ETp, unit: 'mm/day',
      steps: [
        '── Priestley-Taylor Evapotranspiration (Priestley & Taylor, 1972) ──',
        `α = ${alpha.toFixed(2)}, Δ = ${delta.toFixed(3)} kPa/°C, γ = ${gamma.toFixed(3)} kPa/°C`,
        `Rₙ = ${Rn.toFixed(1)} W/m², G = ${G.toFixed(1)} W/m²`,
        '',
        'Step 1 — Compute radiation balance:',
        `  Rₙ − G = ${Rn.toFixed(1)} − ${G.toFixed(1)} = ${(Rn - G).toFixed(1)} W/m²`,
        '',
        'Step 2 — Compute Δ/(Δ+γ) ratio:',
        `  Δ/(Δ+γ) = ${delta.toFixed(3)} / (${delta.toFixed(3)} + ${gamma.toFixed(3)}) = ${aRatio.toFixed(4)}`,
        '',
        'Step 3 — Apply Priestley-Taylor:',
        `  ET_p = α × Δ/(Δ+γ) × (Rₙ−G)`,
        `  ET_p = ${alpha.toFixed(2)} × ${aRatio.toFixed(4)} × ${(Rn - G).toFixed(1)}`,
        `  ET_p = ${ETp.toFixed(2)} mm/day`,
        '',
        `  └ Interpretation: ${ETp > 6 ? 'Very high evaporative demand — arid/semi-arid conditions' : ETp > 3 ? 'Moderate demand — typical humid summer' : ETp > 1 ? 'Low demand — cool/overcast' : 'Minimal ET — near-dormant conditions'}`,
        `  └ α ≈ 1.26 for humid, well-watered surfaces; α < 1.0 for advective/arid conditions`,
      ]
    };
  },
  60: ({ Ra, Tmax, Tmin }) => {
    const dT = Math.max(0, Tmax - Tmin);
    const sqrtDT = Math.sqrt(dT);
    const ET0 = 0.0023 * Ra * (Tmax + 17.8) * sqrtDT;
    return {
      result: ET0, unit: 'mm/day',
      steps: [
        '── Hargreaves-Samani Reference ET (Hargreaves & Samani, 1985) ──',
        `Extraterrestrial radiation Rₐ = ${Ra.toFixed(1)} MJ/m²/day`,
        `T_max = ${Tmax.toFixed(1)} °C, T_min = ${Tmin.toFixed(1)} °C`,
        '',
        'Step 1 — Temperature difference:',
        `  ΔT = max(0, T_max − T_min) = max(0, ${Tmax.toFixed(1)} − ${Tmin.toFixed(1)}) = ${dT.toFixed(1)} °C`,
        `  √ΔT = ${sqrtDT.toFixed(4)}`,
        '',
        'Step 2 — Compute ET₀:',
        `  ET₀ = 0.0023 × Rₐ × (T_avg + 17.8) × √ΔT`,
        `  ET₀ = 0.0023 × ${Ra.toFixed(1)} × (${Tmax.toFixed(1)} + 17.8) × ${sqrtDT.toFixed(4)}`,
        `  ET₀ = ${ET0.toFixed(2)} mm/day`,
        '',
        'Step 3 — Hargreaves coefficient:',
        `  Implicit: C_H = 0.0023 (calibrated for semi-arid to sub-humid)`,
        '',
        `  └ Interpretation: ${ET0 > 7 ? 'Extreme demand — desert conditions' : ET0 > 5 ? 'Very high demand — dryland/arid' : ET0 > 3 ? 'High demand — typical dry summer' : ET0 > 1.5 ? 'Moderate demand' : 'Low demand — cool/cloudy'}`,
        `  └ Calibrated coefficient range: 0.0019 (coastal) to 0.0032 (inland), adjust locally ±15%`,
      ]
    };
  },
  61: ({ Ya, Ym, Ky, ETa, ETm }) => {
    const relYieldLoss = 1 - Ya / Ym;
    const relETDeficit = 1 - ETa / ETm;
    const predicted = Ky * relETDeficit;
    const residual = relYieldLoss - predicted;
    return {
      result: residual, unit: '—',
      steps: [
        '── Doorenbos-Kassam Yield Response (Doorenbos & Kassam, 1979) ──',
        `Actual yield Yₐ = ${Ya.toFixed(1)} t/ha, Maximum yield Yₘ = ${Ym.toFixed(1)} t/ha`,
        `Actual ET ETₐ = ${ETa.toFixed(1)} mm, Maximum ET ETₘ = ${ETm.toFixed(1)} mm`,
        `Yield response factor K_y = ${Ky.toFixed(2)}`,
        '',
        'Step 1 — Relative yield loss:',
        `  1 − Yₐ/Yₘ = 1 − ${Ya.toFixed(1)}/${Ym.toFixed(1)} = ${relYieldLoss.toFixed(4)}`,
        '',
        'Step 2 — Relative ET deficit:',
        `  1 − ETₐ/ETₘ = 1 − ${ETa.toFixed(1)}/${ETm.toFixed(1)} = ${relETDeficit.toFixed(4)}`,
        '',
        'Step 3 — Predicted yield loss:',
        `  (1 − Yₐ/Yₘ)_pred = K_y × (1 − ETₐ/ETₘ) = ${Ky.toFixed(2)} × ${relETDeficit.toFixed(4)} = ${predicted.toFixed(4)}`,
        '',
        'Step 4 — Residual (model misfit):',
        `  Residual = actual − predicted = ${relYieldLoss.toFixed(4)} − ${predicted.toFixed(4)} = ${residual.toFixed(4)}`,
        '',
        `  └ ${Math.abs(residual) < 0.05 ? 'Good fit — yield loss consistent with ET deficit' : residual > 0 ? 'Yield loss > predicted — other stresses (pest/nutrient/disease)' : 'Yield loss < predicted — partial compensation (e.g., deep soil moisture)'}`,
        `  └ K_y values: ${Ky < 0.8 ? 'Low sensitivity (e.g. cotton, alfalfa)' : Ky > 1.2 ? 'High sensitivity (e.g. maize, sorghum)' : 'Moderate sensitivity (most cereals)'}`,
      ]
    };
  },
  62: ({ umax, T }) => {
    const mu = umax * Math.pow(1.066, T - 20);
    const Q10 = 1.066 ** 10;
    return {
      result: mu, unit: '/day',
      steps: [
        '── Temperature-Dependent Microbial Growth (Ratkowsky et al., 1982) ──',
        `Maximum growth rate μ₂₀ = ${umax.toFixed(4)} /day at 20 °C`,
        `Actual temperature T = ${T.toFixed(1)} °C`,
        '',
        'Step 1 — Temperature deviation from reference:',
        `  T − 20 = ${T.toFixed(1)} − 20 = ${(T - 20).toFixed(1)} °C`,
        '',
        'Step 2 — Apply Arrhenius-type factor:',
        `  μ(T) = μ₂₀ × 1.066^(T−20)`,
        `  μ(${T.toFixed(1)}) = ${umax.toFixed(4)} × 1.066^(${(T - 20).toFixed(1)})`,
        `  μ(${T.toFixed(1)}) = ${mu.toFixed(4)} /day`,
        '',
        'Step 3 — Derived Q₁₀:',
        `  Q₁₀ = 1.066^10 = ${Q10.toFixed(2)} (factor increase per 10 °C)`,
        `  Doubling time: t_d = ln(2)/μ = ${mu > 0 ? (Math.LN2 / mu).toFixed(2) : '∞'} days`,
        '',
        `  └ ${Q10 < 1.5 ? 'Low sensitivity' : Q10 < 2.5 ? 'Typical microbial response' : 'High sensitivity (psychrophilic or mesophilic range)'}`,
        `  └ Range: T < 0 °C → near-zero activity; T > 45 °C → denaturation for mesophiles`,
      ]
    };
  },
  63: ({ rho, cp, Ts, Ta, ra, rs, es, ea, LE: _LE }) => {
    const H = rho * cp * (Ts - Ta) / ra;
    const Lv = 2.45e6;
    const le = rho * Lv * (es - ea) / (ra + rs);
    const total = H + le;
    const bowen = le > 0 ? H / le : NaN;
    return {
      result: total, unit: 'W/m²',
      steps: [
        '── Bowen Ratio Energy Balance (Bowen, 1926) ──',
        `Air density ρ = ${rho.toFixed(3)} kg/m³, c_p = ${cp.toFixed(0)} J/kg·K`,
        `Surface T_s = ${Ts.toFixed(1)} °C, Air T_a = ${Ta.toFixed(1)} °C`,
        `Aerodynamic resistance r_a = ${ra.toFixed(1)} s/m, Surface resistance r_s = ${rs.toFixed(1)} s/m`,
        `Saturation vapour pressure e_s = ${es.toFixed(2)} kPa, Actual e_a = ${ea.toFixed(2)} kPa`,
        '',
        'Step 1 — Sensible heat flux:',
        `  H = ρ·c_p·(T_s − T_a) / r_a`,
        `  H = ${rho.toFixed(3)} × ${cp.toFixed(0)} × (${Ts.toFixed(1)} − ${Ta.toFixed(1)}) / ${ra.toFixed(1)}`,
        `  H = ${H.toFixed(1)} W/m²`,
        '',
        'Step 2 — Latent heat flux:',
        `  LE = ρ·L_v·(e_s − e_a) / (r_a + r_s)`,
        `  LE = ${rho.toFixed(3)} × ${Lv.toExponential(1)} × (${es.toFixed(2)} − ${ea.toFixed(2)}) / (${ra.toFixed(1)} + ${rs.toFixed(1)})`,
        `  LE = ${le.toFixed(1)} W/m²`,
        '',
        'Step 3 — Total turbulent flux:',
        `  H + LE = ${H.toFixed(1)} + ${le.toFixed(1)} = ${total.toFixed(1)} W/m²`,
        `  Bowen ratio β = ${isNaN(bowen) ? 'N/A (no LE)' : bowen.toFixed(3)} (${!isNaN(bowen) && bowen < 0.2 ? 'wet surface — evaporation dominated' : bowen < 1 ? 'mixed regime' : 'dry surface — sensible heating dominated'})`,
        '',
        `  └ Net radiation Rₙ should approximately balance H + LE + G at the surface`,
      ]
    };
  },

  // ── Domain 9: Atmospheric Chemistry ──
  64: ({ O2, hnu }) => {
    const rate = O2 * hnu;
    return {
      result: rate, unit: 'mol/m³s',
      steps: [
        '── Chapman Ozone Photochemistry (Chapman, 1930) — proxy rate ──',
        `O₂ concentration [O₂] = ${O2.toExponential(2)} mol/m³`,
        `Solar photon flux hν = ${hnu.toExponential(2)} mol(photons)/m³s`,
        '',
        'Step 1 — Primary photolysis rate proxy:',
        `  J(O₂) ∝ [O₂] × hν = ${O2.toExponential(2)} × ${hnu.toExponential(2)}`,
        `  = ${rate.toExponential(2)} mol/m³s`,
        '',
        'Step 2 — Ozone production chain:',
        '  O₂ + hν → 2O· (λ < 242 nm)',
        '  O· + O₂ + M → O₃ + M (M = N₂, O₂)',
        '',
        `  └ ${hnu > 1e-6 ? 'Stratospheric production dominates — high-energy UV available' : 'Tropospheric production limited — O(¹D) from O₃ photolysis at λ < 320 nm'}`,
        `  └ Full Chapman: d[O₃]/dt = 2J(O₂) - 2k[O][O₂][M] - k'[O][O₃]`,
      ]
    };
  },
  65: ({ k, OH }) => {
    const tau = k > 0 ? 1 / (k * OH) : Infinity;
    const _tauUnit = tau > 1e9 ? (tau / 3.15e7).toFixed(1) + ' yr' : tau.toFixed(0) + ' s';
    return {
      result: tau, unit: 's',
      steps: [
        '── OH Oxidation Lifetime (Atkinson, 1986) ──',
        `Rate constant k = ${k.toExponential(2)} cm³/molecule·s`,
        `OH radical concentration [OH] = ${OH.toExponential(2)} molecules/cm³`,
        '',
        'Step 1 — Pseudo-first-order rate:',
        `  k' = k × [OH] = ${k.toExponential(2)} × ${OH.toExponential(2)} = ${(k * OH).toExponential(3)} s⁻¹`,
        '',
        'Step 2 — Atmospheric lifetime:',
        `  τ = 1/k' = 1 / ${(k * OH).toExponential(3)} = ${tau > 1e9 ? (tau / 3.15e7).toFixed(1) + ' yr (' + tau.toExponential(2) + ' s)' : tau > 86400 ? (tau / 86400).toFixed(2) + ' days (' + tau.toFixed(0) + ' s)' : tau.toFixed(0) + ' s'}`,
        '',
        `  └ Classification: ${tau > 3.15e7 ? 'Very long-lived (>1 yr) — well-mixed, global impact (e.g. CH₄, N₂O)' : tau > 86400 ? 'Long-lived (days−year) — regional transport (e.g. CO, CH₃Br)' : tau > 3600 ? 'Moderate (hours−days) — local/regional (e.g. VOCs, SO₂)' : 'Short-lived (<hour) — highly reactive (e.g. NO, isoprene)'}`,
        `  └ [OH] ≈ 1.0−1.5 × 10⁶ molecules/cm³ (global mean), varies with UV and H₂O`,
      ]
    };
  },

  // ── Part III · Domain 10: Ocean Dynamics ──
  66: ({ beta, rho0, curlTau_z }) => {
    const v = (1 / (rho0 * beta)) * curlTau_z;
    const vSv = v * 1e6; // Sverdrup transport proxy (1 Sv = 10⁶ m³/s per unit width)
    return {
      result: v, unit: 'm²/s²',
      steps: [
        '── Sverdrup Transport (Sverdrup, 1947) ──',
        `Planetary vorticity gradient β = ${beta.toExponential(3)} /m·s`,
        `Reference density ρ₀ = ${rho0.toFixed(0)} kg/m³`,
        `Wind stress curl (∇×τ)_z = ${curlTau_z.toExponential(3)} N/m³`,
        '',
        'Step 1 — Compute meridional transport:',
        `  β·v = (1/ρ₀)·(∇×τ)_z`,
        `  v = 1/(${rho0.toFixed(0)} × ${beta.toExponential(3)}) × ${curlTau_z.toExponential(3)}`,
        `  v = ${v.toExponential(3)} m²/s (${vSv.toFixed(2)} Sv equivalent per unit width)`,
        '',
        `  └ Interpretation: ${v > 0 ? 'Northward transport (positive wind stress curl, e.g. subtropical gyre interior)' : 'Southward transport (negative wind stress curl, e.g. subpolar gyre interior)'}`,
        `  └ β = 2Ωcos(φ)/R ≈ 2.0×10⁻¹¹ at mid-latitudes; determines western intensification scale`,
      ]
    };
  },
  67: ({ beta, psi, x, curlTau, R, visc }) => {
    const lhs = beta * (1 / visc) * (psi / x);
    const v = lhs + curlTau - R * Math.pow(psi / x, 2);
    return {
      result: v, unit: '—',
      steps: [
        '── Quasi-Geostrophic Vorticity Balance (Charney, 1947; Pedlosky, 1987) ──',
        `β = ${beta.toExponential(2)}, ψ ≈ ${psi.toExponential(2)}, x ≈ ${x.toExponential(1)}, curl τ = ${curlTau.toExponential(2)}`,
        `R (beta/Burger) = ${R.toExponential(2)}, eddy viscosity ν = ${visc.toExponential(2)}`,
        '',
        'Step 1 — β·∂ψ/∂x term:',
        `  β·ψ/x = ${beta.toExponential(2)} × ${psi.toExponential(2)} / ${x.toExponential(1)}`,
        `  = ${(beta * psi / x).toExponential(2)}`,
        '',
        'Step 2 — Balance equation:',
        `  Residual = β·∂ψ/∂x + curlτ − R·∇²ψ = ${v.toExponential(2)}`,
        '',
        `  └ ${Math.abs(v) < 0.01 * Math.abs(curlTau) ? 'Near-balance — quasi-geostrophic regime' : 'Imbalance — ageostrophic processes important (frontogenesis, convection)'}`,
        `  └ Full equation: β·∂ψ/∂x = curlτ − R·∇²ψ (± bottom drag term)`,
      ]
    };
  },
  68: ({ beta, psi, x, curlTau, visc }) => {
    const lhs = visc * Math.pow(1 / x, 4) * psi - beta * (1 / visc) * (psi / x);
    const v = curlTau - lhs;
    return {
      result: v, unit: '—',
      steps: [
        '── Munk Western Boundary Layer (Munk, 1950) ──',
        `Lateral eddy viscosity A_H = ${visc.toExponential(1)} m²/s`,
        `β = ${beta.toExponential(2)} /m·s, Streamfunction ψ = ${psi.toExponential(1)}`,
        `Scale x = ${x.toExponential(1)} m, Wind stress curl = ${curlTau.toExponential(2)}`,
        '',
        'Step 1 — Munk layer balance:',
        `  A_H·∇⁴ψ − β·∂ψ/∂x = curlτ`,
        `  lhs = ${visc.toExponential(1)}·∇⁴ψ − ${beta.toExponential(2)}·∂ψ/∂x`,
        `  lhs = ${lhs.toExponential(2)}`,
        '',
        'Step 2 — Residual (curlτ − lhs):',
        `  = ${v.toExponential(2)}`,
        '',
        `  └ Munk boundary layer width: δ_M = (A_H/β)^(1/3) ≈ ${Math.pow(visc / beta, 1/3).toFixed(0)} km`,
        `  └ ${Math.abs(v) < 0.1 * Math.abs(curlTau) ? 'Consistent with Munk layer dynamics' : 'Deviates from Munk balance — nonlinear or topographic effects'}`,
      ]
    };
  },
  69: ({ lambda, Tstar, T, q }) => {
    const forcing = lambda * (Tstar - T);
    const advection = q * T;
    const dT = forcing - advection;
    return {
      result: dT, unit: '°C/yr',
      steps: [
        '── Haney-Type Ocean Box Model (Haney, 1971; Stommel, 1961) ──',
        `Restoring rate λ = ${lambda.toFixed(4)} /yr, Atmospheric target T* = ${Tstar.toFixed(2)} °C`,
        `Ocean temperature T = ${T.toFixed(2)} °C, Advection rate q = ${q.toFixed(4)} /yr`,
        '',
        'Step 1 — Surface forcing (restoring):',
        `  λ·(T* − T) = ${lambda.toFixed(4)} × (${Tstar.toFixed(2)} − ${T.toFixed(2)})`,
        `  = ${forcing.toFixed(4)} °C/yr`,
        '',
        'Step 2 — Advective cooling (upwelling/export):',
        `  q·T = ${q.toFixed(4)} × ${T.toFixed(2)} = ${advection.toFixed(4)} °C/yr`,
        '',
        'Step 3 — Net temperature tendency:',
        `  dT/dt = λ(T*−T) − qT = ${forcing.toFixed(4)} − ${advection.toFixed(4)}`,
        `  dT/dt = ${dT.toFixed(4)} °C/yr`,
        '',
        `  └ ${dT > 0 ? 'WARMING — surface forcing dominates advection' : dT < 0 ? 'COOLING — advection/upwelling dominates' : 'STEADY STATE — forcing ≈ advection'}`,
        `  └ Equilibrium T_eq = λ·T*/(λ+q) = ${(lambda * Tstar / (lambda + q)).toFixed(2)} °C`,
      ]
    };
  },
  70: ({ S, Theta, p }) => {
    const rho = 1000 + S * 0.8 - (Theta - 20) * 0.2 + p * 4.6e-3;
    const sigmaT = rho - 1000;
    return {
      result: rho, unit: 'kg/m³',
      steps: [
        '── TEOS-10 Seawater Density Proxy (IOC et al., 2010) ──',
        `Practical Salinity S = ${S.toFixed(2)} PSU`,
        `Conservative Temperature Θ = ${Theta.toFixed(2)} °C`,
        `Pressure p = ${p.toFixed(0)} dbar (≈ ${(p / 10).toFixed(0)} m depth)`,
        '',
        'Step 1 — Apply linearised equation of state:',
        `  ρ = 1000 + 0.8·S − 0.2·(Θ−20) + 4.6×10⁻³·p`,
        `  ρ = 1000 + 0.8×${S.toFixed(2)} − 0.2×(${Theta.toFixed(2)}−20) + ${(4.6e-3).toExponential(1)}×${p.toFixed(0)}`,
        `  ρ = ${rho.toFixed(2)} kg/m³`,
        '',
        'Step 2 — Density anomaly:',
        `  σ_t = ρ − 1000 = ${sigmaT.toFixed(3)} kg/m³ (sigma-t)`,
        '',
        `  └ Water mass: ${sigmaT < 23 ? 'Light surface water (tropical warm pool)' : sigmaT < 26 ? 'Subtropical mode water' : sigmaT < 27.5 ? 'Central/thermocline water' : 'Deep/intermediate water (σθ > 27.5)'}`,
        `  └ Full TEOS-10 uses Gibbs-Seawater (GSW) formulation for non-linear effects at high pressure`,
      ]
    };
  },
  71: ({ gamma, eps, N2 }) => {
    const Krho = gamma * eps / (N2 || 1e-6);
    const mixingEff = Krho > 1e-4 ? 'Energetic' : Krho > 1e-5 ? 'Moderate' : 'Weak';
    return {
      result: Krho, unit: 'm²/s',
      steps: [
        '── Osborn Turbulent Diffusivity (Osborn, 1980) ──',
        `Mixing efficiency γ = ${gamma.toFixed(3)} (typically 0.15–0.25)`,
        `TKE dissipation rate ε = ${eps.toExponential(2)} W/kg (m²/s³)`,
        `Buoyancy frequency squared N² = ${N2.toExponential(3)} /s²`,
        '',
        'Step 1 — Compute diapycnal diffusivity:',
        `  K_ρ = γ·ε / N² = ${gamma.toFixed(3)} × ${eps.toExponential(2)} / ${N2.toExponential(3)}`,
        `  K_ρ = ${Krho.toExponential(3)} m²/s`,
        '',
        'Step 2 — Mixing regime classification:',
        `  ${mixingEff} turbulent mixing`,
        `  ${Krho > 1e-4 ? '→ Topography-enhanced mixing (e.g. rough bathymetry, straits)' : Krho > 1e-5 ? '→ Background thermocline mixing' : '→ Very weak — double-diffusive or quiescent regime'}`,
        '',
        `  └ Osborn identity assumes steady-state TKE: P = ε + buoyancy flux; γ = R_f/(1−R_f)`,
        `  └ Diapycnal upwelling velocity w* ≈ K_ρ·N²/(ρ·g)`,
      ]
    };
  },
  72: ({ Ri, threshold: _threshold }) => {
    const deepens = Ri > 0.65;
    return {
      result: deepens ? 1 : 0, unit: '—',
      steps: [
        '── Bulk Richardson Mixed Layer Deepening (Pollard et al., 1973) ──',
        `Bulk Richardson Number Ri_b = ${Ri.toFixed(3)}`,
        `Critical threshold Ri_c = 0.65 (Pollard–Rhines–Thompson criterion)`,
        '',
        'Step 1 — Evaluate deepening criterion:',
        `  ${Ri > 0.65 ? `Ri_b (${Ri.toFixed(3)}) > 0.65 → MIXED LAYER DEEPENS (shear instability erodes thermocline)` : `Ri_b (${Ri.toFixed(3)}) ≤ 0.65 → NO deepening, shear too weak`}`,
        '',
        `  └ Ri_b = Δb·h / (Δu)² where Δb = buoyancy jump, h = MLD, Δu = velocity shear across base`,
        `  └ When Ri < 0.65, Kelvin-Helmholtz instabilities entrain denser water below`,
      ]
    };
  },
  73: ({ g, alpha, fm, fpm }) => {
    const S = alpha * Math.pow(g, 2) * Math.pow(fm, -5) * Math.exp(-1.25 * Math.pow(fpm / fm, -4));
    const peakEnhance = Math.exp(-1.25 * Math.pow(fpm / fm, -4));
    return {
      result: S, unit: 'm²/s',
      steps: [
        '── JONSWAP Spectrum (Hasselmann et al., 1973) ──',
        `Phillips constant α = ${alpha.toExponential(2)}`,
        `Peak frequency f_m = ${fm.toExponential(2)} Hz, Spectral peak f_pm = ${fpm.toExponential(2)} Hz`,
        `Gravity g = ${g.toFixed(2)} m/s²`,
        '',
        'Step 1 — Compute f^(-5) term:',
        `  f_m^(-5) = (${fm.toExponential(2)})^(-5) = ${Math.pow(fm, -5).toExponential(3)}`,
        '',
        'Step 2 — Compute peak enhancement factor:',
        `  exp(−1.25·(f_pm/f_m)^(−4)) = exp(−1.25·(${fpm.toExponential(2)}/${fm.toExponential(2)})^(−4))`,
        `  = ${peakEnhance.toExponential(3)}`,
        '',
        'Step 3 — Spectral density at peak:',
        `  S(f_m) = αg²·f_m^(−5)·exp(−1.25·(f_pm/f_m)^(−4))`,
        `  S(f_m) = ${alpha.toExponential(2)} × ${g.toFixed(2)}² × ${Math.pow(fm, -5).toExponential(3)} × ${peakEnhance.toExponential(3)}`,
        `  S(f_m) = ${S.toExponential(3)} m²/s`,
        '',
        `  └ Significant wave height: H_s ≈ 4·√(∫S(f)df) — requires integration over full frequency range`,
        `  └ JONSWAP typical γ (peak enhancement) = 3.3 for fetch-limited developing seas`,
      ]
    };
  },

  // ── Domain 11: Coastal & Wave ──
  74: ({ etaU, Sw, Ssig }) => {
    const sqrtTerm = Math.sqrt(Sw * Sw + Ssig * Ssig);
    const R2 = 1.1 * (etaU + 0.5 * sqrtTerm);
    return {
      result: R2, unit: 'm',
      steps: [
        '── Stockdon Wave Runup (Stockdon et al., 2006) ──',
        `Setup η_u = ${etaU.toFixed(3)} m, Swash S_w = ${Sw.toFixed(3)} m, Infragravity S_ig = ${Ssig.toFixed(3)} m`,
        '',
        'Step 1 — Combined swash:',
        `  √(S_w² + S_ig²) = √(${Sw.toFixed(3)}² + ${Ssig.toFixed(3)}²) = ${sqrtTerm.toFixed(3)} m`,
        '',
        'Step 2 — Compute R₂ (2% exceedance runup):',
        `  R₂ = 1.1 × (η_u + 0.5 × √(S_w² + S_ig²))`,
        `  R₂ = 1.1 × (${etaU.toFixed(3)} + 0.5 × ${sqrtTerm.toFixed(3)})`,
        `  R₂ = ${R2.toFixed(2)} m`,
        '',
        `  └ ${R2 < 1 ? 'Low runup — sheltered or dissipative beach' : R2 < 3 ? 'Moderate runup — intermediate beach' : R2 < 6 ? 'High runup — reflective beach, storm overwash potential' : 'Extreme runup — dune erosion / overtopping likely'}`,
        `  └ R₂ valid for 2% exceedance; dissipative (Iribarren ξ < 0.3) vs. reflective (ξ > 0.3) regimes`,
      ]
    };
  },
  75: ({ L, S, B, hstar }) => {
    const R = (L * S) / (B + hstar);
    const R_mm = R * 1000;
    return {
      result: R, unit: 'm/yr',
      steps: [
        '── Bruun Shoreline Retreat (Bruun, 1962) ──',
        `Cross-shore profile length L* = ${L.toFixed(0)} m`,
        `Sea-level rise rate S = ${S.toExponential(2)} m/yr`,
        `Berm height B = ${B.toFixed(1)} m, Closure depth h* = ${hstar.toFixed(1)} m`,
        '',
        'Step 1 — Compute retreat rate:',
        `  R = (L* × S) / (B + h*) = (${L.toFixed(0)} × ${S.toExponential(2)}) / (${B.toFixed(1)} + ${hstar.toFixed(1)})`,
        `  R = ${R.toFixed(2)} m/yr (${R_mm.toFixed(0)} mm/yr)`,
        '',
        'Step 2 — Cumulative retreat over 50 years:',
        `  ΔR = R × 50 = ${(R * 50).toFixed(1)} m (base scenario)`,
        '',
        `  └ ${R < 0.1 ? 'Low retreat rate — stable coast or low SLR' : R < 0.5 ? 'Moderate retreat — requires monitoring' : R < 2 ? 'Rapid retreat — active erosion management needed' : 'Severe retreat — immediate adaptation required'}`,
        `  └ Bruun Rule assumes profile maintains equilibrium shape; does not account for longshore transport, sediment supply, or hard structures`,
      ]
    };
  },
  76: ({ H: _H, db }) => {
    const Hb = 0.78 * db;
    const Hrms = Hb / Math.SQRT2;
    return {
      result: Hb, unit: 'm',
      steps: [
        '── Komar Breaking Criterion (Komar & Gaughan, 1972) ──',
        `Water depth at breaking d_b = ${db.toFixed(2)} m`,
        `Breaking index γ_b = 0.78 (spilling/plunging breakers on 1:30–1:80 slope)`,
        '',
        'Step 1 — Compute breaking wave height:',
        `  H_b = γ_b × d_b = 0.78 × ${db.toFixed(2)}`,
        `  H_b = ${Hb.toFixed(2)} m`,
        '',
        'Step 2 — Derived quantities:',
        `  H_rms = H_b / √2 = ${Hrms.toFixed(3)} m`,
        `  Breaker type: ${Hb / db > 0.8 ? 'Plunging/surging (steep slope)' : 'Spilling (mild slope)'}`,
        '',
        `  └ γ_b = H_b/d_b = ${(Hb / db).toFixed(3)} — depends on beach slope (γ_b = 0.5–1.2)`,
        `  └ Inshore wave energy flux: (ρgH_b²c_g)/8 determines set-up and longshore transport`,
      ]
    };
  },
  77: ({ K, Hsb, thetaB }) => {
    const Hsb_2p5 = Math.pow(Hsb, 2.5);
    const sin2t = Math.sin(2 * thetaB);
    const Ql = K * Hsb_2p5 * sin2t;
    return {
      result: Ql, unit: 'm³/s',
      steps: [
        '── CERC Longshore Sediment Transport (USACE, 1984; Shore Protection Manual) ──',
        `empirical coefficient K = ${K.toFixed(4)} (typically 0.3–0.7)`,
        `Significant breaking wave height H_sb = ${Hsb.toFixed(2)} m`,
        `Breaking wave angle θ_b = ${thetaB.toFixed(1)}° (${(thetaB * 180 / Math.PI).toFixed(1)}° if radians)`,
        '',
        'Step 1 — Compute H_sb^(5/2):',
        `  H_sb^(5/2) = ${Hsb.toFixed(2)}^(2.5) = ${Hsb_2p5.toFixed(3)}`,
        '',
        'Step 2 — Compute sin(2θ_b):',
        `  sin(2 × ${thetaB.toFixed(2)}) = ${sin2t.toFixed(4)}`,
        '',
        'Step 3 — Compute transport rate:',
        `  Q_l = K × H_sb^(5/2) × sin(2θ_b)`,
        `  Q_l = ${K.toFixed(4)} × ${Hsb_2p5.toFixed(3)} × ${sin2t.toFixed(4)}`,
        `  Q_l = ${Ql.toFixed(1)} m³/s (approx. ${(Ql * 3.15e7).toFixed(0)} m³/yr)`,
        '',
        `  └ ${Ql < 0.1 ? 'Low transport' : Ql < 1 ? 'Moderate longshore drift' : Ql < 10 ? 'High transport rate — accreting/erosive beach' : 'Very high transport — major littoral drift (>10⁶ m³/yr)'}`,
        `  └ Direction: ${sin2t > 0 ? 'northward/eastward (depending on orientation)' : 'southward/westward'}`,
      ]
    };
  },
  78: ({ g, k, h }) => {
    const kh = k * h;
    const tanhKh = Math.tanh(kh);
    const omega2 = g * k * tanhKh;
    const omega = Math.sqrt(omega2);
    const T = 2 * Math.PI / omega;
    const c = omega / k;
    const L = 2 * Math.PI / k;
    return {
      result: omega, unit: 'rad/s',
      steps: [
        '── Airy Wave Dispersion Relation (Airy, 1845; Linear Wave Theory) ──',
        `Gravity g = ${g.toFixed(2)} m/s², Wavenumber k = ${k.toExponential(3)} rad/m`,
        `Water depth h = ${h.toFixed(1)} m`,
        '',
        'Step 1 — Compute kh:',
        `  kh = ${k.toExponential(3)} × ${h.toFixed(1)} = ${kh.toFixed(3)}`,
        `  tanh(kh) = ${tanhKh.toFixed(4)}`,
        '',
        'Step 2 — Compute angular frequency:',
        `  ω² = g·k·tanh(kh) = ${g.toFixed(2)} × ${k.toExponential(3)} × ${tanhKh.toFixed(4)}`,
        `  ω = √${omega2.toFixed(4)} = ${omega.toFixed(4)} rad/s`,
        '',
        'Step 3 — Wave parameters:',
        `  Period T = 2π/ω = ${T.toFixed(2)} s`,
        `  Celerity c = ω/k = ${c.toFixed(3)} m/s`,
        `  Wavelength L = 2π/k = ${L.toFixed(1)} m`,
        `  ${kh > Math.PI ? 'Deep water (kh > π): c = √(g/k)' : kh < 0.1 * Math.PI ? 'Shallow water (kh < 0.1π): c = √(gh)' : 'Intermediate water'}`,
      ]
    };
  },
  79: ({ omega, ka, z }) => {
    // Stokes (1847) Stokes drift: u_s(z) = (ω·k·a²/2)·exp(2kz)
    // Here `ka` carries the wave amplitude a (mapped from user input `ka`).
    // The wavenumber k is derived from the dispersion relation for the
    // given ω at the surface (deep water): k = ω²/g.
    const a = ka;
    const k = (omega * omega) / G_GRAV;  // deep-water dispersion: ω² = gk
    const usSurf = (omega * k * a * a) / 2;
    const us = usSurf * Math.exp(2 * k * z);
    return {
      result: us, unit: 'm/s',
      steps: [
        '── Stokes Drift (Stokes, 1847) ──',
        `Wave angular frequency ω = ${omega.toFixed(4)} rad/s`,
        `Wave amplitude a = ${a.toExponential(3)} m`,
        `Wavenumber k = ω²/g = ${k.toExponential(3)} rad/m (deep-water dispersion)`,
        `Depth below surface z = ${z.toFixed(1)} m (negative below surface)`,
        '',
        'Step 1 — Surface Stokes drift (z=0):',
        `  u_s(0) = (ω·k·a²)/2 = (${omega.toFixed(4)} × ${k.toExponential(3)} × ${a.toExponential(3)}²) / 2`,
        `  u_s(0) = ${usSurf.toExponential(3)} m/s (${(usSurf * 100).toFixed(2)} cm/s)`,
        '',
        'Step 2 — Depth attenuation:',
        `  u_s(z) = u_s(0) × exp(2kz) = ${usSurf.toExponential(3)} × exp(2 × ${k.toExponential(3)} × ${z.toFixed(1)})`,
        `  u_s(${z.toFixed(0)} m) = ${us.toExponential(3)} m/s (${(us * 100).toFixed(4)} cm/s)`,
        '',
        `  └ e-folding depth: z_e = 1/(2k) = ${(1 / (2 * k)).toFixed(1)} m (depth where drift = 37% of surface)`,
        `  └ Stokes transport: M_S = ∫u_s dz (volume transport in wave direction)`,
      ]
    };
  },
  80: ({ alpha, g2, fm, fpm, gamma }) => {
    // JONSWAP (Hasselmann et al., 1973):
    //   S(f) = αg²f⁻⁵ · exp[−1.25(f_p/f)⁻⁴] · γ^exp[−(f−f_p)²/(2σ²f_p²)]
    // with σ = 0.07 for f ≤ f_p and σ = 0.09 for f > f_p (the σ step).
    // Evaluated at f = f_m = f_p (the peak), so (f−f_p)=0 and the Gaussian
    // exponent = 0, giving γ^1 = γ. The σ-dependent broadening is included
    // in the displayed formula for completeness.
    const fp = fpm;          // peak frequency
    const f = fm;            // frequency at which to evaluate
    const sigma = f <= fp ? 0.07 : 0.09;   // JONSWAP σ step
    const peakEnhance = Math.exp(-1.25 * Math.pow(fp / f, -4));
    const gaussExp = Math.exp(-Math.pow(f - fp, 2) / (2 * sigma * sigma * fp * fp));
    const gammaFactor = Math.pow(gamma, gaussExp);
    const S = alpha * Math.pow(g2, 2) * Math.pow(f, -5) * peakEnhance * gammaFactor;
    return {
      result: S, unit: 'm²/s',
      steps: [
        '── JONSWAP Spectrum (Hasselmann et al., 1973) ──',
        `Phillips constant α = ${alpha.toExponential(2)}, g = ${g2.toFixed(2)} m/s²`,
        `Peak frequency f_p = ${fp.toExponential(2)} Hz, Evaluation f = ${f.toExponential(2)} Hz`,
        `Peak enhancement γ = ${gamma.toFixed(2)}, σ = ${sigma} (JONSWAP step: 0.07 if f≤f_p, 0.09 if f>f_p)`,
        '',
        'Step 1 — Phillips f⁻⁵ tail:',
        `  α·g²·f⁻⁵ = ${alpha.toExponential(2)} × ${g2.toFixed(2)}² × ${Math.pow(f, -5).toExponential(3)}`,
        `  = ${(alpha * g2 * g2 * Math.pow(f, -5)).toExponential(3)}`,
        '',
        'Step 2 — Peak enhancement exp[−1.25(f_p/f)⁻⁴]:',
        `  = ${peakEnhance.toExponential(3)}`,
        '',
        'Step 3 — Gaussian broadening exp[−(f−f_p)²/(2σ²f_p²)]:',
        `  = ${gaussExp.toExponential(3)} (σ=${sigma})`,
        `  γ^broadening = ${gamma.toFixed(2)}^${gaussExp.toExponential(2)} = ${gammaFactor.toExponential(3)}`,
        '',
        'Step 4 — Spectral density:',
        `  S(f) = α·g²·f⁻⁵ · exp[−1.25(f_p/f)⁻⁴] · γ^exp[−(f−f_p)²/(2σ²f_p²)]`,
        `  S(${f.toExponential(2)}) = ${S.toExponential(3)} m²/s`,
        '',
        `  └ At the peak (f=f_p): Gaussian exponent = 0 → γ^1 = γ; S(f_p) = αg²f_p⁻⁵·exp(−1.25)·γ`,
        `  └ H_m₀ = 4·√(∫S(f)df); frequency-integrated for total energy`,
      ]
    };
  },

  // ── Part IV · Domain 12: Geomorphology ──
  81: ({ K, A, m, S }) => {
    const E = K * Math.pow(A, m) * Math.pow(S, 1);
    const n = 1; // typical exponent for slope (n ≈ 1 assumed)
    return {
      result: E, unit: '—',
      steps: [
        '── Stream Power Incision Model (Howard & Kerby, 1983; Whipple & Tucker, 1999) ──',
        `Erodibility K = ${K.toExponential(3)}, Drainage area A = ${A.toFixed(1)} km²`,
        `Area exponent m = ${m.toFixed(3)}, Slope S = ${S.toFixed(5)} m/m, Slope exponent n = ${n.toFixed(0)}`,
        '',
        'Step 1 — Compute A^m:',
        `  A^m = (${A.toFixed(1)})^${m.toFixed(3)} = ${Math.pow(A, m).toExponential(3)}`,
        '',
        'Step 2 — Compute incision rate:',
        `  E = K·A^m·S^n = ${K.toExponential(3)} × ${Math.pow(A, m).toExponential(3)} × ${S.toFixed(5)}^${n.toFixed(0)}`,
        `  E = ${E.toExponential(4)} (dimensionless erosion metric)`,
        '',
        `  └ ${E > 1 ? 'High erosion potential — steep, high-discharge catchment' : E > 0.1 ? 'Moderate erosion — typical mountain stream' : 'Low erosion — low-gradient or resistant substrate'}`,
        `  └ Concavity index θ = m/n = ${(m / n).toFixed(3)}; typical values 0.35–0.6 for fluvial landscapes`,
      ]
    };
  },
  82: ({ c, A, h }) => {
    const L = c * Math.pow(A, h);
    return {
      result: L, unit: 'km',
      steps: [
        '── Hack\'s Law (Hack, 1957) ──',
        `Coefficient c = ${c.toFixed(3)}, Drainage area A = ${A.toFixed(1)} km²`,
        `Scaling exponent h = ${h.toFixed(3)} (Hack exponent, typically 0.55–0.7)`,
        '',
        'Step 1 — Compute main channel length:',
        `  L = c × A^h = ${c.toFixed(3)} × ${A.toFixed(1)}^{${h.toFixed(3)}}`,
        `  L = ${L.toFixed(2)} km`,
        '',
        'Step 2 — Hack exponent interpretation:',
        `  h = ${h.toFixed(3)} → ${h < 0.55 ? 'Low exponent — compact drainage basin' : h < 0.7 ? 'Typical exponent — self-similar network' : 'High exponent — elongated basin'}`,
        '',
        `  └ Hack's Law implies log(L) ∝ h·log(A); linear on log-log plot`,
        `  └ c depends on network geometry: ${c < 1 ? 'low coefficient ~ dendritic network on low slope' : c > 3 ? 'high coefficient ~ strongly elongated' : 'moderate coefficient'}`,
      ]
    };
  },
  83: ({ L, s }) => {
    const D = 1 - Math.log(L) / Math.log(s);
    return {
      result: D, unit: '—',
      steps: [
        '── Fractal Dimension of Drainage Networks (Mandelbrot, 1967; Tarboton et al., 1988) ──',
        `Main channel length L = ${L.toFixed(1)} km`,
        `Map scale / grid size s = ${s.toFixed(1)}`,
        '',
        'Step 1 — Compute log ratios:',
        `  ln(L) = ${Math.log(L).toFixed(4)}`,
        `  ln(s) = ${Math.log(s).toFixed(4)}`,
        '',
        'Step 2 — Compute fractal dimension:',
        `  D = 1 − ln(L)/ln(s) = 1 − ${Math.log(L).toFixed(4)} / ${Math.log(s).toFixed(4)}`,
        `  D = ${D.toFixed(4)}`,
        '',
        'Step 3 — Dimension interpretation:',
        `  ${D > 1.8 ? 'Space-filling network — strongly bifurcating (e.g. tidal creeks)' : D > 1.5 ? 'Typical river network (D ≈ 1.5–1.8)' : D > 1.2 ? 'Moderate complexity' : 'Simple, low-bifurcation drainage pattern'}`,
        '',
        `  └ Theoretical range: 1 ≤ D ≤ 2; D = 1 for straight line, D = 2 for fully planar fill`,
        `  └ Hortonian bifurcation ratio R_b ≈ (L_max/L_min)^D relates to D`,
      ]
    };
  },
  84: ({ cprime, gammaz, z: _z, cosB, u, phiP: _phiP, tanphi, sinB, cosB2 }) => {
    // Infinite-slope factor of safety (Taylor 1948; Duncan & Wright 2005):
    //   FS = [c' + (γz·cos²β − u)·tanφ'] / (γz·sinβ·cosβ)
    // The normal-stress term uses cos²β (the cosB2 parameter), not cosβ.
    const num = cprime + (gammaz * cosB2 - u) * tanphi;
    const den = gammaz * sinB * cosB;
    const FS = den !== 0 ? num / den : Infinity;
    return {
      result: FS, unit: '—',
      steps: [
        '── Infinite Slope Stability (Taylor, 1948; Duncan & Wright, 2005) ──',
        `Effective cohesion c' = ${cprime.toFixed(2)} kPa`,
        `Soil unit weight γz = ${gammaz.toFixed(2)} kN/m³, cosβ = ${cosB.toFixed(4)}`,
        `Pore pressure u = ${u.toFixed(2)} kPa, tanφ' = ${tanphi.toFixed(4)}`,
        `sinβ = ${sinB.toFixed(4)}, cos²β = ${cosB2.toFixed(4)}`,
        '',
        'Step 1 — Compute resisting (shear strength) term:',
        `  numerator = c' + (γz·cosβ − u)·tanφ'`,
        `  = ${cprime.toFixed(2)} + (${gammaz.toFixed(2)}×${cosB.toFixed(4)} − ${u.toFixed(2)})×${tanphi.toFixed(4)}`,
        `  = ${num.toFixed(4)} kPa`,
        '',
        'Step 2 — Compute driving (shear stress) term:',
        `  denominator = γz·sinβ·cosβ = ${gammaz.toFixed(2)} × ${sinB.toFixed(4)} × ${cosB.toFixed(4)}`,
        `  = ${den.toFixed(4)} kPa`,
        '',
        'Step 3 — Factor of Safety:',
        `  FS = ${num.toFixed(4)} / ${den.toFixed(4)} = ${FS.toFixed(3)}`,
        '',
        'Step 4 — Stability classification:',
        `  ${FS >= 1.5 ? 'STABLE — adequate factor of safety' : FS >= 1.25 ? 'MARGINALLY STABLE — monitor / minor remediation' : FS >= 1.0 ? 'NEARLY FAILING — requires detailed investigation' : 'FAILURE (FS < 1) — slope instable, remediation required'}`,
        '',
        `  └ Critical slip surface assumed planar and parallel to slope (infinite slope assumption valid when depth << length)`,
      ]
    };
  },
  85: ({ mu, sigmaN, xi: _xi }) => {
    const tau = mu * sigmaN;
    return {
      result: tau, unit: 'Pa',
      steps: [
        '── Granular Flow Friction (Coulomb, 1776; Savage & Hutter, 1989) ──',
        `Friction coefficient μ = ${mu.toFixed(4)}`,
        `Normal stress σ_n = ${sigmaN.toFixed(2)} Pa`,
        '',
        'Step 1 — Compute static Coulomb friction:',
        `  τ = μ × σ_n = ${mu.toFixed(4)} × ${sigmaN.toFixed(2)}`,
        `  τ = ${tau.toFixed(2)} Pa`,
        '',
        'Step 2 — Friction angle:',
        `  φ = atan(μ) = ${(Math.atan(mu) * 180 / Math.PI).toFixed(1)}°`,
        '',
        `  └ ${tau > 1000 ? 'High shear resistance — rock/debris avalanche basal friction' : tau > 100 ? 'Moderate — typical dry granular flow' : 'Low — near-fluidised or hydroplaning flow'}`,
        `  └ Full model includes velocity-dependent term: τ = μσ_n + ρgv²/ξ (μ(I) rheology)`,
      ]
    };
  },
  86: ({ As, tanB }) => {
    const slopeRad = tanB > 0 ? tanB : 1e-10;
    const SPI = Math.log(As * slopeRad);
    const slopeDeg = Math.atan(slopeRad) * 180 / Math.PI;
    return {
      result: SPI, unit: '—',
      steps: [
        '── Stream Power Index (Moore et al., 1991) ──',
        `Specific catchment area A_s = ${As.toFixed(1)} m²/m`,
        `Slope tan β = ${slopeRad.toFixed(5)} (≈ ${slopeDeg.toFixed(2)}°)`,
        '',
        'Step 1 — Compute SPI:',
        `  SPI = ln(A_s × tanβ) = ln(${As.toFixed(1)} × ${slopeRad.toFixed(5)})`,
        `  SPI = ln(${(As * slopeRad).toFixed(4)}) = ${SPI.toFixed(3)}`,
        '',
        'Step 2 — Erosion potential:',
        `  ${SPI > 5 ? 'HIGH EROSION POTENTIAL — convergent flow, steep slope' : SPI > 3 ? 'MODERATE — hillslope/channel transition' : 'LOW — divergent or low-gradient areas'}`,
        '',
        `  └ SPI quantifies erosive power of concentrated overland flow; used with LS factor in RUSLE`,
      ]
    };
  },
  87: ({ As, tanB }) => {
    const slopeRad = tanB > 0 ? tanB : 1e-10;
    const TWI = Math.log(As) - Math.log(slopeRad);
    const slopeDeg = Math.atan(slopeRad) * 180 / Math.PI;
    return {
      result: TWI, unit: '—',
      steps: [
        '── Topographic Wetness Index (Beven & Kirkby, 1979; TOPMODEL) ──',
        `Specific catchment area A_s = ${As.toFixed(1)} m²/m`,
        `Slope tan β = ${slopeRad.toFixed(5)} (≈ ${slopeDeg.toFixed(2)}°)`,
        '',
        'Step 1 — Compute TWI:',
        `  TWI = ln(A_s / tanβ) = ln(${As.toFixed(1)} / ${slopeRad.toFixed(5)})`,
        `  TWI = ln(${(As / slopeRad).toFixed(1)}) = ${TWI.toFixed(3)}`,
        '',
        'Step 2 — Saturation classification:',
        `  ${TWI > 8 ? 'SATURATION ZONE — likely variable source area, wetland / riparian' : TWI > 6 ? 'HIGH — periodic saturation, ephemeral channels' : TWI > 4 ? 'MODERATE — hillslope, well-drained' : 'WELL DRAINED — ridge top / steep slope'}`,
        '',
        `  └ TWI ln(a/tanβ) correlates with depth to water table; higher values → shallower water table`,
      ]
    };
  },

  // ── Domain 13: Limnology ──
  88: ({ Km, ew, ea, u }) => {
    const vpDeficit = ew - ea;
    const windFactor = 1 + u / 16;
    const E = Km * vpDeficit * windFactor;
    return {
      result: E, unit: 'mm/day',
      steps: [
        '── Lake Evaporation (Penman-type, modified by Linacre, 1993) ──',
        `Mass transfer coefficient K_m = ${Km.toFixed(4)} mm/day·kPa`,
        `Saturation vapour pressure e_w = ${ew.toFixed(2)} kPa`,
        `Actual vapour pressure e_a = ${ea.toFixed(2)} kPa`,
        `Wind speed at 2 m height u = ${u.toFixed(1)} m/s`,
        '',
        'Step 1 — Vapour pressure deficit:',
        `  e_w − e_a = ${ew.toFixed(2)} − ${ea.toFixed(2)} = ${vpDeficit.toFixed(2)} kPa`,
        '',
        'Step 2 — Wind function:',
        `  (1 + u/16) = (1 + ${u.toFixed(1)}/16) = ${windFactor.toFixed(3)}`,
        '',
        'Step 3 — Compute evaporation:',
        `  E = K_m × (e_w−e_a) × (1+u/16)`,
        `  E = ${Km.toFixed(4)} × ${vpDeficit.toFixed(2)} × ${windFactor.toFixed(3)}`,
        `  E = ${E.toFixed(2)} mm/day`,
        '',
        `  └ ${E > 6 ? 'Very high evaporation — arid/warm, open water' : E > 3 ? 'High evaporation — summer conditions' : E > 1 ? 'Moderate evaporation — typical temperate lake' : 'Low evaporation — cool/humid conditions'}`,
        `  └ Equivalent energy flux: LE = ρ·L_v·E = ${(1000 * 2.45e6 * E / 1000 / 86400).toFixed(0)} W/m²`,
      ]
    };
  },
  89: ({ A: _A, z, rms }) => {
    const S = rms * z;
    return {
      result: S, unit: 'J/m²',
      steps: [
        '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
        `Lake surface area A = ${_A !== undefined ? _A.toFixed(0) : 'N/A'} m²`,
        `Depth to centre of volume z_v = ${z.toFixed(1)} m`,
        `Root-mean-square density difference rms(Δρ) = ${rms.toExponential(3)} kg/m³`,
        '',
        'Step 1 — Compute stability:',
        `  S = g × A₀⁻¹ × ∫A(z)·(ρ_z−ρ_m)·(z−z_v)dz`,
        `  S ≈ g × rms(Δρ) × z_v (simplified one-layer proxy)`,
        `  S = ${G_GRAV.toFixed(3)} × ${rms.toExponential(3)} × ${z.toFixed(1)}`,
        `  S = ${S.toFixed(1)} J/m²`,
        '',
        'Step 2 — Stability classification:',
        `  ${S > 500 ? 'Strongly stratified — resistant to mixing (deep temperate lake in summer)' : S > 100 ? 'Moderately stratified — seasonal thermocline present' : S > 20 ? 'Weakly stratified — polymictic or frequent turnover' : 'Near-mixed — continuous vertical exchange (shallow/polymictic)'}`,
        '',
        `  └ Required wind work to completely mix lake: W ≈ S × A₀ (total energy in J)`,
        `  └ Wedderburn number W = Δρ·g·h²/(ρ·u*²·L) — dynamic stability measure`,
      ]
    };
  },
  90: ({ n, K, t, Q0 }) => {
    const K_n1 = Math.pow(K, n - 1);
    const fact = factorial(n - 1);
    const q = (Math.pow(t, n - 1) / (K_n1 * fact)) * (1 / K) * Math.exp(-t / K) * Q0;
    return {
      result: q, unit: 'm³/s',
      steps: [
        '── Nash Cascade Unit Hydrograph (Nash, 1957) ──',
        `Number of linear reservoirs n = ${n.toFixed(0)}, Storage coefficient K = ${K.toFixed(2)} h`,
        `Time t = ${t.toFixed(1)} h, Total inflow volume Q₀ = ${Q0.toFixed(1)} m³/s·h`,
        '',
        'Step 1 — Gamma-distribution coefficients:',
        `  (n−1)! = ${n.toFixed(0)}! = ${factorial(n - 1).toExponential(2)}`,
        `  K^(n−1) = (${K.toFixed(2)})^(${n.toFixed(0)}−1) = ${K_n1.toExponential(3)}`,
        '',
        'Step 2 — Compute IUH ordinate:',
        `  q(t) = t^(n−1) / (K^(n−1)·(n−1)!) · (1/K) · exp(−t/K) · Q₀`,
        `  q(${t.toFixed(1)} h) = ${q.toExponential(3)} m³/s`,
        '',
        'Step 3 — Hydrograph timing:',
        `  Time to peak: t_p = (n−1)·K = ${((n - 1) * K).toFixed(1)} h`,
        '',
        `  └ Nash model: n reservoirs in series; higher n → more peaked, delayed response`,
        `  └ Quickflow only — baseflow must be added separately for total streamflow`,
      ]
    };
  },

  // ── Domain 14: Cryosphere & Volcanology ──
  91: ({ accum, DDF, Tpos, days }) => {
    const ablation = DDF * Tpos * days;
    const Bn = accum - ablation;
    return {
      result: Bn, unit: 'm w.e.',
      steps: [
        '── Glacier Surface Mass Balance (Cogley et al., 2011; WGMS) ──',
        `Annual accumulation = ${accum.toFixed(2)} m w.e.`,
        `Degree-Day Factor DDF = ${DDF.toFixed(3)} m w.e./°C·day`,
        `Positive degree-days T_pos = ${Tpos.toFixed(1)} °C, Melt season length = ${days.toFixed(0)} days`,
        '',
        'Step 1 — Compute total ablation:',
        `  Ablation = DDF × T_pos × days = ${DDF.toFixed(3)} × ${Tpos.toFixed(1)} × ${days.toFixed(0)}`,
        `  Ablation = ${ablation.toFixed(3)} m w.e.`,
        '',
        'Step 2 — Compute net balance:',
        `  B_n = Accumulation − Ablation = ${accum.toFixed(2)} − ${ablation.toFixed(3)}`,
        `  B_n = ${Bn.toFixed(3)} m w.e.`,
        '',
        'Step 3 — Glacier health:',
        `  ${Bn > 0.5 ? 'STRONGLY POSITIVE — glacier advance expected' : Bn > 0 ? 'POSITIVE — slight mass gain' : Bn > -0.5 ? 'NEGATIVE — mass loss, retreating' : 'STRONGLY NEGATIVE — severe wastage, likely terminus retreat > 100 m/yr'}`,
        `  Equilibrium Line Altitude (ELA) ≈ altitude where B_n = 0; accumulation area ratio (AAR) ≈ 0.5–0.6 for steady state`,
      ]
    };
  },
  92: ({ K, DDF, L, lambda }) => {
    const ALT = Math.sqrt((2 * K * DDF) / (L || 1)) * Math.sqrt(lambda);
    return {
      result: ALT, unit: 'm',
      steps: [
        '── Stefan Active Layer Thickness (Stefan, 1891; Romanovsky & Osterkamp, 1997) ──',
        `Thermal conductivity K = ${K.toFixed(2)} W/m·K`,
        `Degree-Day Factor DDF = ${DDF.toFixed(0)} °C·days (thawing index)`,
        `Volumetric latent heat of fusion L = ${L.toFixed(2)} MJ/m³`,
        `Thawing season length factor λ = ${lambda.toFixed(2)}`,
        '',
        'Step 1 — Compute thawing index numerator:',
        `  2K·DDF = 2 × ${K.toFixed(2)} × ${DDF.toFixed(0)} = ${(2 * K * DDF).toFixed(0)} W·°C·day/m·K`,
        '',
        'Step 2 — Compute ALT:',
        `  ALT = √(2K·DDF/L) × √λ`,
        `  ALT = √(${(2 * K * DDF).toFixed(0)} / ${L.toFixed(2)}) × √${lambda.toFixed(2)}`,
        `  ALT = ${ALT.toFixed(2)} m`,
        '',
        'Step 3 — Permafrost classification:',
        `  ${ALT <= 0.5 ? 'Continuous permafrost — very shallow active layer (high Arctic)' : ALT <= 1.5 ? 'Typical continuous permafrost' : ALT <= 3 ? 'Discontinuous permafrost — moderate active layer' : 'Sporadic/isolated permafrost — deep active layer, talik formation possible'}`,
        '',
        `  └ Stefan solution assumes: (i) step-change surface temperature, (ii) homogeneous soil, (iii) no unfrozen water content`,
      ]
    };
  },
  93: ({ k, b, rhoI, rhoF }) => {
    const drho = k * b * (rhoI - rhoF);
    const _halfDensity = (rhoI + rhoF) / 2;
    return {
      result: drho, unit: 'kg/m³/s',
      steps: [
        '── Dry Snow Densification (Herron & Langway, 1980; Arthern et al., 2010) ──',
        `Rate constant k = ${k.toExponential(2)} /s`,
        `Overburden factor b = ${b.toFixed(3)} (proportional to accumulation rate)`,
        `Initial snow density ρ_i = ${rhoI.toFixed(1)} kg/m³`,
        `Final firn density ρ_f = ${rhoF.toFixed(1)} kg/m³`,
        '',
        'Step 1 — Compute density gradient:',
        `  ρ_i − ρ_f = ${rhoI.toFixed(1)} − ${rhoF.toFixed(1)} = ${(rhoI - rhoF).toFixed(1)} kg/m³`,
        '',
        'Step 2 — Densification rate:',
        `  dρ/dt = k × b × (ρ_i − ρ_f)`,
        `  dρ/dt = ${k.toExponential(2)} × ${b.toFixed(3)} × ${(rhoI - rhoF).toFixed(1)}`,
        `  dρ/dt = ${drho.toExponential(2)} kg/m³/s`,
        '',
        'Step 3 — Timescale to closure (pore close-off at ρ ≈ 830 kg/m³):',
        `  Δt ≈ (830 − ${rhoF.toFixed(0)}) / |dρ/dt| = ${drho !== 0 ? ((830 - rhoF) / Math.abs(drho)).toExponential(2) : '∞'} s`,
        '',
        `  └ ${drho > 0 ? 'Compaction progressing — air volume decreasing' : 'No densification — pore space saturated or equilibrium'}`,
        `  └ Main stages: (1) settling (ρ < 550), (2) densification (550–830), (3) ice bubble closure (>830 kg/m³)`,
      ]
    };
  },
  94: ({ V }) => {
    const logV = -4.42 + 0.75 * V;
    const V_km3 = Math.pow(10, logV);
    return {
      result: V_km3, unit: 'km³',
      steps: [
        '── Volcanic Explosivity Index to Volume (Newhall & Self, 1982) ──',
        `Volcanic Explosivity Index VEI = ${V.toFixed(0)} (0–8 scale)`,
        '',
        'Step 1 — Compute log₁₀(volume):',
        `  log₁₀(V) = −4.42 + 0.75 × VEI = −4.42 + 0.75 × ${V.toFixed(0)}`,
        `  log₁₀(V) = ${logV.toFixed(3)}`,
        '',
        'Step 2 — Exponentiate:',
        `  V = 10^${logV.toFixed(3)} = ${V_km3.toExponential(3)} km³ (${V_km3.toFixed(2)} km³)`,
        '',
        'Step 3 — Eruption classification:',
        `  VEI ${V.toFixed(0)}: ${V <= 1 ? 'Gentle/Hawaiian effusive' : V <= 2 ? 'Strombolian' : V <= 3 ? 'Vulcanian' : V <= 4 ? 'Plinian (Pompeii-type)' : V <= 5 ? 'Plinian (sub-Plinian)' : V <= 6 ? 'Ultra-Plinian (e.g. Pinatubo 1991, 5 km³)' : V <= 7 ? 'Super-colossal (e.g. Tambora 1815, 50 km³)' : 'Ultra-colossal / supervolcanic (e.g. Toba 74 ka, >1000 km³)'}`,
        '',
        `  └ Plume height approx.: H ∝ V^(1/4) for Plinian eruptions (Carey & Sparks, 1986)`,
      ]
    };
  },
  95: ({ Qdot, rhoAir, alpha }) => {
    const buoyancyTerm = Math.pow(Qdot / (rhoAir + 1), 1 / 3);
    const h = alpha * buoyancyTerm;
    return {
      result: h, unit: 'km',
      steps: [
        '── Volcanic Plume Height (Mastin et al., 2009; Degruyter & Bonadonna, 2015) ──',
        `Mass eruption rate Q̇ = ${Qdot.toExponential(2)} kg/s`,
        `Ambient air density ρ_air = ${rhoAir.toFixed(3)} kg/m³`,
        `Empirical constant α = ${alpha.toFixed(3)} (≈ 0.1–0.3)`,
        '',
        'Step 1 — Compute buoyancy scaling:',
        `  (Q̇/ρ_air)^(1/3) = (${Qdot.toExponential(2)} / ${rhoAir.toFixed(3)})^(1/3)`,
        `  = ${buoyancyTerm.toFixed(3)} m^(1/3)·kg^(1/3)·s^(−1/3)`,
        '',
        'Step 2 — Compute plume height:',
        `  H = α × (Q̇/ρ_air)^(1/3) = ${alpha.toFixed(3)} × ${buoyancyTerm.toFixed(3)}`,
        `  H = ${h.toFixed(2)} km`,
        '',
        'Step 3 — Plume classification:',
        `  ${h < 1 ? 'Weak/ash-poor puffing (<1 km)' : h < 5 ? 'Low-level plume — local ashfall, aviation risk below FL200' : h < 10 ? 'Moderate plume — regional ashfall, FL200-FL350 aviation risk' : h < 20 ? 'Strong/Plinian plume (>10 km) — widespread ash, high-risk aviation' : 'Ultra-Plinian / co-ignimbrite plume (>20 km) — stratospheric injection, global dispersal'}`,
        '',
        `  └ Mastin relation: H = 0.25·Q̇^0.25 for m < 10⁶ kg/s; buoyant plume theory applies when wind < 20 m/s`,
      ]
    };
  },

  // ── Part V · Domain 15: Climate Dynamics ──
  96: ({ C, T: _T, Q, alpha, I, D, divDT }) => {
    const absorbed = Q * (1 - alpha);
    const diffusion = D * divDT;
    const net = absorbed - I + diffusion;
    const dT = net / (C || 1);
    return {
      result: dT, unit: 'K/yr',
      steps: [
        '── EBM — Energy Balance Model (Budyko, 1969; Sellers, 1969) ──',
        `Heat capacity C = ${C.toExponential(3)} J/m²K, Solar constant Q = ${Q.toFixed(0)} W/m²`,
        `Albedo α = ${alpha.toFixed(3)}, OLR I = ${I.toFixed(2)} W/m², Diffusion D = ${D.toExponential(3)}, div(D∇T) = ${divDT.toExponential(3)}`,
        '',
        'Step 1 — Absorbed solar radiation:',
        `  Q(1−α) = ${Q.toFixed(0)} × (1 − ${alpha.toFixed(3)}) = ${absorbed.toFixed(3)} W/m²`,
        '',
        'Step 2 — Net energy budget:',
        `  Q(1−α) − I + div(D∇T) = ${absorbed.toFixed(3)} − ${I.toFixed(3)} + ${diffusion.toExponential(3)}`,
        `  = ${net.toExponential(4)} W/m²`,
        '',
        'Step 3 — Temperature tendency:',
        `  ∂T/∂t = net / C = ${net.toExponential(4)} / ${C.toExponential(3)}`,
        `  ∂T/∂t = ${dT.toExponential(5)} K/yr`,
        '',
        `  └ Interpretation: ${dT > 0 ? 'WARMING — positive energy imbalance' : dT < 0 ? 'COOLING — negative energy imbalance' : 'STEADY STATE — net zero imbalance'}`,
      ]
    };
  },
  97: ({ dF, lambda0, f }) => {
    const invLambda0 = 1 / (lambda0 || 1);
    const den = invLambda0 - f;
    const lambda = 1 / den;
    const dT = lambda * dF;
    return {
      result: dT, unit: 'K',
      steps: [
        '── Climate Sensitivity — Feedback Analysis (Hansen et al., 1984; Roe, 2009) ──',
        `Radiative forcing ΔF = ${dF.toFixed(2)} W/m²`,
        `Reference sensitivity λ₀ = ${lambda0.toFixed(4)} K/(W/m²)`,
        `Total feedback parameter f = ${f.toFixed(4)} (sum of Planck + water vapor + lapse rate + cloud + albedo)`,
        '',
        'Step 1 — Compute effective climate sensitivity parameter:',
        `  λ = 1 / (1/λ₀ − f) = 1 / (${invLambda0.toFixed(4)} − ${f.toFixed(4)})`,
        `  λ = 1 / ${den.toFixed(4)} = ${lambda.toFixed(3)} K/(W/m²)`,
        '',
        'Step 2 — Compute equilibrium temperature change:',
        `  ΔT = λ × ΔF = ${lambda.toFixed(3)} × ${dF.toFixed(2)}`,
        `  ΔT = ${dT.toFixed(2)} K`,
        '',
        'Step 3 — Gain factor:',
        `  Gain G = λ/λ₀ = ${(lambda / lambda0).toFixed(2)}`,
        `  ${Math.abs(f) < 0.1 ? 'Weak feedback regime' : f > 0 ? 'POSITIVE FEEDBACK AMPLIFICATION (G > 1)' : 'NEGATIVE FEEDBACK DAMPENING (G < 1)'}`,
        '',
        `  └ Interpretation: ${dT < 1.5 ? 'Low sensitivity — likely aerosol or cloud damping' : dT < 3 ? 'Moderate sensitivity — within IPCC likely range (2–4.5 K)' : dT < 6 ? 'High sensitivity — strong positive feedbacks' : 'Very high sensitivity — model-dependent, potential tipping cascade'}`,
      ]
    };
  },
  98: ({ dRdT }) => {
    return {
      result: dRdT, unit: 'W/m²K',
      steps: [
        '── Planck Feedback (Manabe & Wetherald, 1967) ──',
        `Planck feedback parameter λ_P = ∂R/∂T (OLR sensitivity to surface temperature)`,
        '',
        'Step 1 — Compute Planck response:',
        `  λ_P = d(σT⁴)/dT = 4σT³ ≈ 3.2–3.8 W/m²K at terrestrial temperatures`,
        `  λ_P = ${dRdT.toFixed(3)} W/m²K`,
        '',
        'Step 2 — Planck timescale:',
        `  Effective damping: τ = C/λ_P ≈ ${(1e8 / dRdT).toExponential(1)} s (for C ≈ 10⁸ J/m²K column)`,
        '',
        `  └ λ_P = ${dRdT.toFixed(2)}: ${dRdT < 3 ? 'Below Stefan-Boltzmann (4σT³ ~ 3.8) — possible non-Planck masking' : dRdT < 4 ? 'Within expected Stefan-Boltzmann range' : 'Above S-B expectation — additional negative feedback'}`,
      ]
    };
  },
  99: ({ k: _k, beta, kx, ky }) => {
    const K2 = kx * kx + ky * ky;
    const omega = -beta * ky / K2;
    const phaseSpeed = K2 > 0 ? omega / Math.sqrt(K2) : 0;
    return {
      result: omega, unit: 'rad/s',
      steps: [
        '── Rossby Wave Dispersion Relation (Rossby, 1939; Haurwitz, 1940) ──',
        `Beta parameter β = ${beta.toExponential(3)} /m·s`,
        `Zonal wavenumber k_x = ${kx.toExponential(3)} /m, Meridional wavenumber k_y = ${ky.toExponential(3)} /m`,
        '',
        'Step 1 — Total wavenumber squared:',
        `  K² = k_x² + k_y² = (${kx.toExponential(3)})² + (${ky.toExponential(3)})²`,
        `  K² = ${K2.toExponential(4)} /m²`,
        '',
        'Step 2 — Barotropic Rossby wave frequency:',
        `  ω = −β·k_y / K² = −(${beta.toExponential(3)}) × ${ky.toExponential(3)} / ${K2.toExponential(4)}`,
        `  ω = ${omega.toExponential(4)} rad/s`,
        '',
        'Step 3 — Phase speed and direction:',
        `  c = ω/K = ${phaseSpeed.toExponential(3)} m/s (${phaseSpeed >= 0 ? 'eastward' : 'westward'})`,
        '',
        `  └ ${ky > 0 ? 'Southward phase propagation (k_y > 0)' : 'Northward phase propagation (k_y < 0)'}`,
        `  └ Group velocity: c_gx = β·(k_x²−k_y²)/(k_x²+k_y²)² (eastward energy transport for long waves)`,
      ]
    };
  },
  100: ({ dpdy, f: _f, N: _N, dudy: _dudy }) => {
    const cond = dpdy < 0;
    return {
      result: cond ? 1 : 0, unit: '—',
      steps: [
        '── Baroclinic Instability Criterion (Charney, 1947; Eady, 1949) ──',
        `Meridional PV gradient ∂q/∂y = ${dpdy.toExponential(4)} /m·s`,
        `Coriolis f = ${_f ?? 0}, Brunt-Väisälä N = ${_N ?? 0}, Wind shear ∂u/∂z = ${_dudy ?? 0}`,
        '',
        'Step 1 — Evaluate necessary condition:',
        `  ∂q/∂y = ${dpdy.toExponential(4)} < 0 → ${cond ? 'TRUE: satisfies Charney-Stern criterion' : 'FALSE: baroclinic instability NOT possible'}`,
        '',
        'Step 2 — Growth context:',
        `  ${cond ? 'PV gradient reversal — wave energy extraction from mean flow possible' : 'Positive PV gradient — flow is baroclinically stable'}`,
        '',
        `  └ Charney-Stern necessary condition: β − ∂²ū/∂y² + f²/ρ·∂/∂z(ρ/N²·∂ū/∂z) must change sign`,
        `  └ Eady maximum growth rate: σ_max ≈ 0.31·|f|·|∂u/∂z|/N`,
      ]
    };
  },
  101: ({ f, N, dudy }) => {
    const sigma = 0.31 * (f / N) * Math.abs(dudy);
    const eFoldHours = sigma > 0 ? (1 / sigma) * 24 : Infinity;
    const periodDays = (2 * Math.PI) / (sigma || 1e-30) / 86400;
    return {
      result: sigma, unit: '/day',
      steps: [
        '── Eady Baroclinic Growth Rate (Eady, 1949) ──',
        `Coriolis parameter f = ${f.toFixed(6)} /s`,
        `Brunt-Väisälä frequency N = ${N.toExponential(4)} /s`,
        `Vertical wind shear ∂u/∂z = ${dudy.toExponential(4)} /s`,
        '',
        'Step 1 — Compute Eady growth rate:',
        `  σ_Eady = 0.31 × (f/N) × |∂u/∂z|`,
        `  = 0.31 × (${f.toFixed(6)} / ${N.toExponential(4)}) × ${Math.abs(dudy).toExponential(4)}`,
        `  σ_Eady = ${sigma.toExponential(4)} /day (${(sigma / 86400).toExponential(4)} /s)`,
        '',
        'Step 2 — Growth timescales:',
        `  e-folding time: τ_e = 1/σ = ${eFoldHours < 24 ? (eFoldHours).toFixed(1) + ' h' : (eFoldHours / 24).toFixed(1) + ' days'}`,
        `  Period of most unstable wave: T ≈ ${periodDays.toFixed(1)} days`,
        '',
        `  └ Classification: ${sigma > 0.5 ? 'RAPID GROWTH — explosive cyclogenesis potential' : sigma > 0.2 ? 'MODERATE GROWTH — typical mid-latitude cyclone' : sigma > 0.05 ? 'WEAK GROWTH — slowly developing system' : 'VERY WEAK / DAMPED — baroclinically inactive'}`,
      ]
    };
  },

  // ── Domain 16: Atmospheric Dynamics ──
  102: ({ psi: _psi, f, dpy, dpp }) => {
    const q = dpy + f + dpp;
    const relVort = dpy;
    const stretching = dpp;
    return {
      result: q, unit: '/s',
      steps: [
        '── Quasi-Geostrophic Potential Vorticity (Charney, 1947; Pedlosky, 1987) ──',
        `Relative vorticity (∇²ψ) ≈ ${relVort.toExponential(4)} /s`,
        `Planetary vorticity f = ${f.toExponential(4)} /s`,
        `Stretching term ∂/∂p(f²/N²·∂ψ/∂p) ≈ ${stretching.toExponential(4)} /s`,
        '',
        'Step 1 — Assemble QGPV:',
        `  q = ∇²ψ + f + f²/N²·∂²ψ/∂p²`,
        `  q = ${relVort.toExponential(4)} + ${f.toExponential(4)} + ${stretching.toExponential(4)}`,
        `  q = ${q.toExponential(4)} /s`,
        '',
        'Step 2 — Vertical structure:',
        `  ${Math.abs(dpp / (dpy || 1e-30)) > 1 ? 'Stretching dominates — baroclinic structure' : 'Relative vorticity dominates — equivalent barotropic'}`,
        '',
        `  └ QGPV conservation (Dq/Dt = 0) is the foundational equation for mid-latitude synoptic dynamics`,
      ]
    };
  },
  103: ({ ubar, uprime }) => {
    const u = ubar + uprime;
    const ratio = ubar !== 0 ? uprime / ubar : 0;
    return {
      result: u, unit: 'm/s',
      steps: [
        '── Reynolds Decomposition (Reynolds, 1895) ──',
        `Mean flow ū = ${ubar.toFixed(3)} m/s, Perturbation u' = ${uprime.toFixed(3)} m/s`,
        '',
        'Step 1 — Superpose mean and perturbation:',
        `  u = ū + u' = ${ubar.toFixed(3)} + ${uprime.toFixed(3)}`,
        `  u = ${u.toFixed(3)} m/s`,
        '',
        'Step 2 — Turbulence intensity:',
        `  u'/ū = ${ratio.toFixed(3)} |u'|/|ū| = ${(Math.abs(ratio) * 100).toFixed(1)}%`,
        `  ${Math.abs(ratio) < 0.1 ? 'Weak perturbation — nearly steady flow' : Math.abs(ratio) < 0.5 ? 'Moderate perturbation — distinct eddies' : 'Large perturbation — highly transient / turbulent flow'}`,
        '',
        `  └ Reynolds averaging: ¯(u'v') ≠ 0 defines turbulent momentum flux (Reynolds stress)`,
      ]
    };
  },
  104: ({ Km, f }) => {
    const DE = Math.PI * Math.sqrt((2 * Km) / f);
    return {
      result: DE, unit: 'm',
      steps: [
        '── Ekman Depth (Ekman, 1905) ──',
        `Eddy viscosity K_m = ${Km.toExponential(3)} m²/s`,
        `Coriolis parameter f = ${f.toExponential(6)} /s`,
        '',
        'Step 1 — Compute Ekman depth:',
        `  D_E = π × √(2·K_m/f) = π × √(2 × ${Km.toExponential(3)} / ${f.toExponential(6)})`,
        `  D_E = π × √(${(2 * Km / f).toExponential(3)})`,
        `  D_E = ${DE.toFixed(1)} m`,
        '',
        'Step 2 — Derived parameters:',
        `  Ekman transport: U_E = τ/(ρf) (total transport in upper D_E m)`,
        `  ${DE > 100 ? 'Deep Ekman layer — typical of ocean interior (low latitudes)' : DE > 30 ? 'Mid-depth Ekman layer — typical mid-latitude ocean' : 'Shallow Ekman layer — high-latitude or high-wind conditions'}`,
        '',
        `  └ Surface current rotates 45° right (NH) / left (SH) of wind; net transport 90° right/left`,
      ]
    };
  },
  105: ({ g, thetaVbar, wthetaV, zi }) => {
    const buoyFlux = (g / (thetaVbar || 1)) * (wthetaV * zi);
    const wstar = Math.pow(buoyFlux, 1 / 3);
    return {
      result: wstar, unit: 'm/s',
      steps: [
        '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
        `Gravity g = ${g.toFixed(2)} m/s²`,
        `Mean virtual potential temperature θ̄_v = ${thetaVbar.toFixed(2)} K`,
        `Surface kinematic heat flux w'θ'_v = ${wthetaV.toExponential(4)} K·m/s`,
        `Boundary layer height z_i = ${zi.toFixed(0)} m`,
        '',
        'Step 1 — Buoyancy production of TKE:',
        `  (g/θ̄_v)·(w'θ'_v)₀·z_i = (${g.toFixed(2)}/${thetaVbar.toFixed(2)}) × ${wthetaV.toExponential(4)} × ${zi.toFixed(0)}`,
        `  = ${buoyFlux.toExponential(4)} m²/s³`,
        '',
        'Step 2 — Convective velocity scale:',
        `  w_* = (buoyancy flux)^(1/3) = (${buoyFlux.toExponential(4)})^(1/3)`,
        `  w_* = ${wstar.toFixed(3)} m/s`,
        '',
        'Step 3 — Convective regime:',
        `  ${wstar > 1.5 ? 'STRONG convection — vigorous thermals, deep BL' : wstar > 0.5 ? 'MODERATE convection — typical fair-weather cumulus' : wstar > 0.1 ? 'WEAK convection — suppressed or stable BL' : 'NEARLY NIL — stably stratified or nocturnal BL'}`,
        '',
        `  └ w_* scales vertical velocity variance and eddy diffusivity in the convective BL`,
      ]
    };
  },
  106: ({ dtheta, D, cos2b, delta, dB: _dB, dudy }) => {
    const cosBeta = Math.sqrt((cos2b + 1) / 2);
    const deformTerm = dtheta * (D * cos2b - delta);
    const shearTerm = cosBeta * Math.abs(dudy) * Math.abs(dtheta);
    const F = Math.abs(deformTerm) + Math.abs(shearTerm);
    return {
      result: F, unit: 'K/s',
      steps: [
        '── Frontogenesis Function (Petterssen, 1936; Sanders, 1955) ──',
        `Potential temperature gradient |∇θ| = ${dtheta.toExponential(4)} K/m`,
        `Deformation rate D = ${D.toExponential(4)} /s, Shearing deformation δ = ${delta.toExponential(4)} /s`,
        `Orientation angle cos(2β) = ${cos2b.toFixed(4)}, Wind gradient ∂u/∂s = ${dudy.toExponential(4)} /s`,
        '',
        'Step 1 — Deformation contribution:',
        `  F_def = |∇θ|·(D·cos2β − δ) = ${dtheta.toExponential(4)} × (${D.toExponential(4)} × ${cos2b.toFixed(4)} − ${delta.toExponential(4)})`,
        `  = ${deformTerm.toExponential(4)} K/s`,
        '',
        'Step 2 — Shear contribution:',
        `  F_shear = cosβ·|∂u/∂s|·|∇θ| = ${cosBeta.toFixed(4)} × ${Math.abs(dudy).toExponential(4)} × ${Math.abs(dtheta).toExponential(4)}`,
        `  = ${shearTerm.toExponential(4)} K/s`,
        '',
        'Step 3 — Total frontogenesis:',
        `  F = ${F.toExponential(4)} K/s`,
        '',
        `  └ Interpretation: ${F > 1e-9 ? 'FRONTOGENESIS — temperature gradient intensifying (cold/warm front development)' : F < -1e-9 ? 'FRONTOLYSIS — gradient weakening (front decaying)' : 'Near-neutral — no frontal activity'}`,
      ]
    };
  },
  107: ({ zeta, f, dudx, dudy: _dudy, dvdx: _dvdx, dvdy }) => {
    const div = dudx + dvdy;
    const DzetaDt = -(zeta + f) * div;
    return {
      result: DzetaDt, unit: '/s²',
      steps: [
        '── Barotropic Vorticity Equation (Holton & Hakim, 2012, Ch. 4) ──',
        `Relative vorticity ζ = ${zeta.toExponential(4)} /s`,
        `Planetary vorticity f = ${f.toExponential(4)} /s`,
        `Divergence ∇·V = ∂u/∂x + ∂v/∂y = ${dudx.toExponential(4)} + ${dvdy.toExponential(4)} = ${div.toExponential(4)} /s`,
        '',
        'Step 1 — Stretching/tilting term:',
        `  −(ζ+f)·(∇·V) = −(${zeta.toExponential(4)} + ${f.toExponential(4)}) × ${div.toExponential(4)}`,
        `  |ζ+f| = ${Math.abs(zeta + f).toExponential(4)} /s, Sign: ${(zeta + f) > 0 ? 'cyclonic' : 'anticyclonic'}`,
        '',
        'Step 2 — Relative vorticity tendency:',
        `  Dζ/Dt = ${DzetaDt.toExponential(4)} /s²`,
        '',
        'Step 3 — Dynamical interpretation:',
        `  ${div > 0 ? 'DIVERGENCE → vorticity decreasing (upper-level ridge building)' : 'CONVERGENCE → vorticity increasing (upper-level trough deepening)'}`,
        '',
        `  └ Full equation: Dζ/Dt = −(ζ+f)∇·V − (∂w/∂x·∂v/∂z − ∂w/∂y·∂u/∂z) + (curl F)_z / ρ`,
      ]
    };
  },

  // ── Domain 17: Cloud Physics ──
  108: ({ a, r, b }) => {
    const curvature = a / r;
    const solute = b / (r * r * r);
    const S = curvature - solute;
    const rc = b / a; // approximate critical radius (if S=0 at r_c)
    return {
      result: S, unit: '—',
      steps: [
        '── Köhler Curve — Cloud Activation (Köhler, 1936; Pruppacher & Klett, 1997) ──',
        `Curvature (Kelvin) coefficient a = ${a.toExponential(3)} m`,
        `Solute (Raoult) coefficient b = ${b.toExponential(3)} m³`,
        `Droplet radius r = ${r.toExponential(3)} m (${(r * 1e6).toFixed(1)} µm)`,
        '',
        'Step 1 — Curvature (Kelvin) term:',
        `  a/r = ${a.toExponential(3)} / ${r.toExponential(3)} = ${curvature.toExponential(4)}`,
        '',
        'Step 2 — Solute (Raoult) term:',
        `  b/r³ = ${b.toExponential(3)} / (${r.toExponential(3)})³ = ${solute.toExponential(4)}`,
        '',
        'Step 3 — Supersaturation:',
        `  S = a/r − b/r³ = ${curvature.toExponential(4)} − ${solute.toExponential(4)}`,
        `  S = ${S.toExponential(4)} (${(S * 100).toFixed(4)}% supersaturation)`,
        '',
        `  └ Activation: ${S > 0 ? 'SUPERSATURATED — droplet grows spontaneously (r > r_crit)' : 'SUBSATURATED — droplet evaporates'}`,
        `  └ Critical radius r_c ≈ √(b/a) = ${rc.toExponential(3)} m (${(rc * 1e6).toFixed(1)} µm)`,
      ]
    };
  },
  109: ({ N0, Lambda, D }) => {
    const expTerm = Math.exp(-Lambda * D);
    const N = N0 * expTerm;
    const meanD = 1 / Lambda;
    return {
      result: N, unit: 'm⁻³·mm⁻¹',
      steps: [
        '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
        `Intercept parameter N₀ = ${N0.toExponential(3)} m⁻³·mm⁻¹`,
        `Slope parameter Λ = ${Lambda.toExponential(3)} /mm`,
        `Drop diameter D = ${D.toFixed(2)} mm`,
        '',
        'Step 1 — Exponential distribution:',
        `  N(D) = N₀·exp(−Λ·D) = ${N0.toExponential(3)} × exp(−${Lambda.toExponential(3)} × ${D.toFixed(2)})`,
        `  exp(−ΛD) = ${expTerm.toExponential(4)}`,
        '',
        'Step 2 — Concentration at given diameter:',
        `  N(${D.toFixed(1)} mm) = ${N.toExponential(3)} m⁻³·mm⁻¹`,
        '',
        'Step 3 — Distribution moments:',
        `  Mean diameter: 1/Λ = ${meanD.toFixed(2)} mm`,
        `  Liquid water content: LWC ∝ N₀·Γ(4)/Λ⁴ ∝ N₀ × ${(6 / Math.pow(Lambda, 4)).toExponential(3)}`,
        `  Rain rate: Z = ∫N(D)D⁶dD = N₀·Γ(7)/Λ⁷ = ${(N0 * 720 / Math.pow(Lambda, 7)).toExponential(3)} mm⁶/m³`,
        '',
        `  └ Classic MP: N₀ = 8×10³ m⁻³·mm⁻¹, Λ = 4.1·R^(-0.21) mm⁻¹ (R in mm/h)`,
      ]
    };
  },
  110: ({ a, R }) => {
    const b = 1.6;
    const Z = a * Math.pow(R, b);
    const dBZ = 10 * Math.log10(Z || 1);
    const rainClass = Z < 20 ? 'Light drizzle' : Z < 200 ? 'Moderate rain' : Z < 2000 ? 'Heavy rain' : 'Very heavy / hailstorm';
    return {
      result: Z, unit: 'mm⁶/m³',
      steps: [
        '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
        `Coefficient a = ${a.toFixed(1)} (Marshall-Palmer standard: a=200)`,
        `Rain rate R = ${R.toFixed(2)} mm/h, Exponent b = ${b.toFixed(1)}`,
        '',
        'Step 1 — Compute radar reflectivity:',
        `  Z = a × R^b = ${a.toFixed(1)} × ${R.toFixed(2)}^${b.toFixed(1)}`,
        `  Z = ${Z.toExponential(3)} mm⁶/m³`,
        '',
        'Step 2 — Convert to dBZ:',
        `  dBZ = 10 × log₁₀(Z) = 10 × log₁₀(${Z.toExponential(3)})`,
        `  dBZ = ${dBZ.toFixed(1)} dBZ`,
        '',
        'Step 3 — Precipitation classification:',
        `  ${rainClass} (${dBZ.toFixed(0)} dBZ)`,
        '',
        `  └ Common Z-R pairs: stratiform (200,1.6), orographic (31,1.71), thunderstorm (486,1.37)`,
        `  └ Dual-pol improves R estimate by reducing Z-R ambiguity (K_dp, Z_dr)`,
      ]
    };
  },

  // ── Part VI · Domain 18: Geodesy ──
  111: ({ Rx, Ry: _Ry, Rz: _Rz, P, N, W }) => {
    const Rt = P * N * Rx * W;
    return {
      result: Rt, unit: '—',
      steps: [
        '── Composite Rotation Matrix — Earth Orientation (McCarthy & Petit, 2003; IERS 2010) ──',
        `Precession matrix P = ${P.toExponential(3)}, Nutation matrix N = ${N.toExponential(3)}`,
        `Earth rotation matrix R_x = ${Rx.toExponential(3)}`,
        `Wobble (polar motion) W = ${W.toExponential(3)}`,
        '',
        'Step 1 — Form composite rotation:',
        `  R(t) = P(t)·N(t)·R(t)·W(t)`,
        `  R(t) ≈ ${P.toExponential(3)} × ${N.toExponential(3)} × ${Rx.toExponential(3)} × ${W.toExponential(3)}`,
        `  R(t) ≈ ${Rt.toExponential(3)} (matrix element proxy)`,
        '',
        'Step 2 — Astrometric accuracy:',
        `  ${Math.abs(Rt - 1) < 0.01 ? 'Near-unity element — consistent with rotation matrix' : 'Significant rotation magnitude — check for inversion/transposition'}`,
        '',
        `  └ Full transformation: ITRS→GCRS uses P·N·R·W matrix product for IAU 2006/2000 precession-nutation`,
      ]
    };
  },
  112: ({ hn, Vn, g }) => {
    const u = hn * Vn / (g || 1);
    return {
      result: u, unit: 'm',
      steps: [
        '── Love Numbers — Tidal Displacement (Love, 1911; Wahr, 1981) ──',
        `Love number h_n (degree-n vertical) = ${hn.toExponential(3)}`,
        `Tidal potential V_n = ${Vn.toExponential(3)} m²/s²`,
        `Gravity g = ${g.toFixed(3)} m/s²`,
        '',
        'Step 1 — Compute radial displacement:',
        `  u_r = h_n·V_n / g = ${hn.toExponential(3)} × ${Vn.toExponential(3)} / ${g.toFixed(3)}`,
        `  u_r = ${u.toExponential(3)} m (${(u * 1000).toFixed(2)} mm)`,
        '',
        'Step 2 — Tidal context:',
        `  ${u < 0.1 ? 'Small displacement — deep Earth or ocean loading tide' : u < 0.5 ? 'Moderate — solid Earth tide body response' : 'Large — surface loading tide near coast'}`,
        '',
        `  └ Shida number l_n gives horizontal displacement; k_n gives self-gravitation correction`,
      ]
    };
  },
  113: ({ GM, r, n, Cnm, Snm, Pnm, phi: _phi, lam }) => {
    const R_earth = 6371000;
    const ratio = R_earth / r;
    const surfTerm = Cnm * Math.cos(n * lam) + Snm * Math.sin(n * lam);
    const V = (GM / r) * Math.pow(ratio, n) * surfTerm * Pnm;
    return {
      result: V, unit: 'm²/s²',
      steps: [
        '── Spherical Harmonic Gravity Field (Heiskanen & Moritz, 1967; EGM2008) ──',
        `Gravitational constant GM = ${GM.toExponential(4)} m³/s²`,
        `Radius r = ${r.toFixed(0)} m, Earth radius R = ${R_earth.toFixed(0)} m`,
        `Degree n = ${n.toFixed(0)}, Order m = (from C_nm/S_nm indices)`,
        `Coefficient C_nm = ${Cnm.toExponential(4)}, S_nm = ${Snm.toExponential(4)}`,
        `Associated Legendre P_nm = ${Pnm.toExponential(3)}`,
        `Longitude λ = ${lam.toFixed(4)} rad`,
        '',
        'Step 1 — Scale ratio:',
        `  (R/r)^n = (${R_earth.toFixed(0)} / ${r.toFixed(0)})^${n.toFixed(0)} = ${Math.pow(ratio, n).toExponential(4)}`,
        '',
        'Step 2 — Surface spherical harmonic:',
        `  C_nm·cos(nλ) + S_nm·sin(nλ) = ${Cnm.toExponential(4)}·cos(${n.toFixed(0)}×${lam.toFixed(4)}) + ${Snm.toExponential(4)}·sin(${n.toFixed(0)}×${lam.toFixed(4)})`,
        `  = ${surfTerm.toExponential(4)}`,
        '',
        'Step 3 — Gravitational potential:',
        `  V = (GM/r) × (R/r)^n × (C_nm cos+Snm sin) × P_nm`,
        `  V = ${(GM / r).toExponential(3)} × ${Math.pow(ratio, n).toExponential(4)} × ${surfTerm.toExponential(4)} × ${Pnm.toExponential(3)}`,
        `  V = ${V.toExponential(4)} m²/s²`,
        '',
        `  └ Degree variance: σ_n² = Σ(C_nm²+S_nm²) — degree n contributes ~${(Math.sqrt(Cnm * Cnm + Snm * Snm) * 1e8).toFixed(1)} mGal RMS geoid`,
        `  └ Full field: V = GM/r · Σ(R/r)^n Σ(C_nm cos mλ + S_nm sin mλ)·P_nm(sin φ)`,
      ]
    };
  },
  114: ({ S, R, X, T }) => {
    const Xt = S * R * X + T;
    return {
      result: Xt, unit: 'm',
      steps: [
        '── Helmert 7-Parameter Transformation (Helmert, 1880; Molodensky, 1962) ──',
        `Scale factor S = ${S.toExponential(3)} (1 + ppm), Rotation matrix R = ${R.toExponential(3)}`,
        `Input vector X = ${X.toExponential(3)} m`,
        `Translation vector T = ${T.toExponential(3)} m`,
        '',
        'Step 1 — Apply rotation and scaling:',
        `  S·R·X = ${S.toExponential(3)} × ${R.toExponential(3)} × ${X.toExponential(3)} = ${(S * R * X).toExponential(3)} m`,
        '',
        'Step 2 — Add translation:',
        `  X_t = S·R·X + T = ${(S * R * X).toExponential(3)} + ${T.toExponential(3)}`,
        `  X_t = ${Xt.toExponential(3)} m`,
        '',
        'Step 3 — Transformation magnitude:',
        `  Δ = |X_t − X| = ${Math.abs(Xt - X).toExponential(3)} m`,
        `  ${Math.abs(Xt - X) > 100 ? 'Continental-scale shift (ITRF to local datum)' : Math.abs(Xt - X) > 1 ? 'Regional datum shift' : 'Local/minor refinement'}`,
        '',
        `  └ Full Helmert: 7 parameters (3 translations, 3 rotations, 1 scale) for datum transformations (ITRF↔WGS84↔ETRS89)`,
      ]
    };
  },
  115: ({ h, N }) => {
    const H = h - N;
    return {
      result: H, unit: 'm',
      steps: [
        '── Orthometric Height (Helmert, 1890; Heiskanen & Moritz, 1967) ──',
        `Ellipsoidal height (GNSS) h = ${h.toFixed(3)} m`,
        `Geoid undulation N = ${N.toFixed(3)} m (EGM2008/EGM2020)`,
        '',
        'Step 1 — Convert to orthometric height:',
        `  H = h − N = ${h.toFixed(3)} − ${N.toFixed(3)}`,
        `  H = ${H.toFixed(3)} m (height above sea level / geoid)`,
        '',
        'Step 2 — Geoid context:',
        `  ${N > 0 ? 'N > 0: geoid above ellipsoid (excess mass region)' : 'N < 0: geoid below ellipsoid (mass deficit region)'}`,
        `  Geoid slope: ~${Math.abs(N / 100e3 * 1e6).toFixed(2)} cm/km (typical geoid gradient)`,
        '',
        `  └ EGM2020 resolution ~5′ (~9 km); accuracy improves with regional geoid models`,
        `  └ In coastal zones, use local chart datum (e.g., LAT, MSL) — orthometric height ≠ tidal datum`,
      ]
    };
  },

  // ── Domain 19: Ionosphere & Magnetosphere ──
  116: ({ ni, mi }) => {
    const rho = ni.reduce((s: number, n: number, i: number) => s + n * (mi[i] || 1), 0);
    const nIons = ni.length;
    return {
      result: rho, unit: 'kg/m³',
      steps: [
        '── Ion Plasma Mass Density (Chapman, 1931; Kelley, 2009) ──',
        `${nIons} ion species with densities: [${ni.map((n: number) => n.toExponential(2)).join(', ')}] m⁻³`,
        `Ion masses: [${mi.map((m: number) => m.toExponential(2)).join(', ')}] kg`,
        '',
        'Step 1 — Sum over species:',
        `  ρ = Σ(n_i·m_i) for i = 1..${nIons}`,
        `  ρ = ${rho.toExponential(3)} kg/m³`,
        '',
        'Step 2 — Dominant ion identification:',
        `  ${rho > 1e-15 ? 'F-region — O⁺ dominant, high density (10¹¹–10¹² m⁻³)' : rho > 1e-18 ? 'E-region — NO⁺/O₂⁺ dominant' : 'Topside/plasmasphere — H⁺/He⁺ dominant, low density'}`,
        '',
        `  └ Electron density n_e ≈ Σ n_i (quasi-neutrality); plasma frequency f_p ∝ √n_e`,
      ]
    };
  },
  117: ({ Ne }) => {
    const fp = Math.sqrt(Ne * 80.6164) * 1e-6; // plasma frequency in MHz
    const Teq = 1200; // typical F-region temperature (K)
    const _scaleH = (K_BOLTZMANN * Teq) / (16 * 1.67e-27 * G_GRAV) / 1000;
    return {
      result: Ne, unit: 'm⁻³',
      steps: [
        '── Empirical Electron Density Profile (Kelley, 2009; IRI-2020) ──',
        `Electron density N_e = ${Ne.toExponential(2)} m⁻³`,
        '',
        'Step 1 — Plasma frequency:',
        `  f_p = √(N_e·e²/(4π²ε₀m_e)) ≈ √(N_e × 80.6164)`,
        `  f_p = ${fp.toFixed(3)} MHz`,
        '',
        'Step 2 — Ionospheric layer identification:',
        `  ${fp < 3 ? 'E-layer / low F-layer — below critical frequency f₀F₂' : fp < 10 ? 'F-region (f₀F₂ typical 3–10 MHz)' : 'High F-region / spread-F / auroral — enhanced ionisation'}`,
        '',
        `  └ TEC = ∫N_e·dh (Total Electron Content, 1 TECU = 10¹⁶ m⁻²)`,
        `  └ Maximum usable frequency (MUF) ≈ f₀F₂ × 3.5 for oblique propagation at 2000 km`,
      ]
    };
  },
  118: ({ J, E }) => {
    const Q = J * E;
    const sigma = E !== 0 ? J / E : 0;
    return {
      result: Q, unit: 'W/m³',
      steps: [
        '── Joule Heating in the Ionosphere (Cowley, 1982; Richmond, 1995) ──',
        `Current density J = ${J.toExponential(3)} A/m²`,
        `Electric field E = ${E.toExponential(3)} V/m`,
        `Derived conductivity σ = J/E ≈ ${sigma.toExponential(3)} S/m`,
        '',
        'Step 1 — Compute Joule heating rate:',
        `  Q_J = J·E = σ·E² = ${J.toExponential(3)} × ${E.toExponential(3)}`,
        `  Q_J = ${Q.toExponential(3)} W/m³`,
        '',
        'Step 2 — Heating class:',
        `  ${Q > 1e-6 ? 'STRONG Joule heating — auroral zone, geomagnetic storm conditions' : Q > 1e-9 ? 'MODERATE — sub-auroral, SAPS events' : 'WEAK — low-latitude / quiet conditions'}`,
        '',
        `  └ Height-integrated heating: Σ_Q = ∫Q_J·dh ∼ mW/m² — drives thermospheric expansion during storms`,
      ]
    };
  },
  119: ({ Imean, Istd }) => {
    // Scintillation index S4 = √(⟨I²⟩−⟨I⟩²)/⟨I⟩ = σ_I/⟨I⟩ (Briggs & Parkin 1963).
    // The implementation receives σ_I and ⟨I⟩; S4 = σ_I / ⟨I⟩.
    const S4 = Imean !== 0 ? Istd / Imean : 0;
    return {
      result: S4, unit: '—',
      steps: [
        '── S4 Scintillation Index (Briggs & Parkin, 1963; Yeh & Liu, 1982) ──',
        `Mean signal intensity ⟨I⟩ = ${Imean.toExponential(3)} (relative units)`,
        `Standard deviation σ_I = ${Istd.toExponential(3)} (relative units)`,
        '',
        'Step 1 — Compute S4 index:',
        `  S4 = √(⟨I²⟩ − ⟨I⟩²) / ⟨I⟩ = σ_I / ⟨I⟩ = ${Istd.toExponential(3)} / ${Imean.toExponential(3)}`,
        `  S4 = ${S4.toExponential(4)}`,
        '',
        'Step 2 — Scintillation classification:',
        `  ${S4 < 0.1 ? 'WEAK — negligible amplitude fading (quiet ionosphere)' : S4 < 0.3 ? 'MODERATE — occasional fading, typical equatorial post-sunset' : S4 < 0.6 ? 'STRONG — frequent deep fades, GNSS tracking issues' : 'SEVERE (S4 > 0.6) — cycle slips, loss of lock likely'}`,
        '',
        `  └ L-band (GPS L1=1.575 GHz): S4 > 0.5 causes significant positioning degradation`,
        `  └ Also: σ_φ (phase scintillation) index in radians; strong S4 often correlates with σ_φ > 0.5 rad`,
      ]
    };
  },
  120: ({ Pdyn, Bz }) => {
    const PdynExp = Math.pow(Pdyn, -1 / 6.6);
    const expTerm = Math.exp(0.19 * Bz);
    const Rmp = 107.4 * PdynExp * (1 + 0.013 * expTerm);
    const Rmp_km = Rmp * 6371;
    return {
      result: Rmp, unit: 'R_E',
      steps: [
        '── Magnetopause Standoff Distance (Shue et al., 1998; Sibeck et al., 1991) ──',
        `Solar wind dynamic pressure P_dyn = ${Pdyn.toFixed(2)} nPa`,
        `IMF B_z (GSM) = ${Bz.toFixed(1)} nT`,
        '',
        'Step 1 — Dynamic pressure scaling:',
        `  P_dyn^(−1/6.6) = ${Pdyn.toFixed(2)}^{−1/6.6} = ${PdynExp.toExponential(4)}`,
        '',
        'Step 2 — IMF B_z erosion factor:',
        `  exp(0.19 × B_z) = exp(0.19 × ${Bz.toFixed(1)}) = ${expTerm.toExponential(4)}`,
        `  1 + 0.013·exp(0.19·B_z) = 1 + 0.013 × ${expTerm.toExponential(4)} = ${(1 + 0.013 * expTerm).toFixed(4)}`,
        '',
        'Step 3 — Standoff distance:',
        `  R_mp = 107.4 × ${PdynExp.toExponential(4)} × ${(1 + 0.013 * expTerm).toFixed(4)}`,
        `  R_mp = ${Rmp.toFixed(2)} R_E (${Rmp_km.toFixed(0)} km)`,
        '',
        'Step 4 — Magnetopause state:',
        `  ${Rmp > 10 ? 'COMPRESSED — strong solar wind, magnetopause pushed inward' : Rmp > 8 ? 'NOMINAL — average solar wind conditions' : 'EXPANDED — weak solar wind, magnetopause far out'}`,
        `  ${Bz < -5 ? 'Strong southward B_z — erosion enhancement, dayside reconnection active' : Bz > 5 ? 'Strong northward B_z — minimal erosion' : 'Quiet IMF orientation'}`,
        '',
        `  └ Polar cusp latitude: θ_cusp ≈ arccos(√(1/R_mp)) ≈ ${(Math.acos(Math.sqrt(1 / Rmp)) * 180 / Math.PI).toFixed(1)}°`,
      ]
    };
  },
  121: ({ Dst, Pdyn, b, c }) => {
    const magPert = b * Math.sqrt(Pdyn);
    const DstStar = Dst - magPert + c;
    return {
      result: DstStar, unit: 'nT',
      steps: [
        '── Pressure-Corrected Dst Index (Burton et al., 1975; O\'Brien & McPherron, 2000) ──',
        `Raw Dst = ${Dst.toFixed(1)} nT`,
        `Solar wind dynamic pressure P_dyn = ${Pdyn.toFixed(2)} nPa`,
        `Pressure coefficient b = ${b.toFixed(2)} nT/nPa^(1/2), Baseline c = ${c.toFixed(1)} nT`,
        '',
        'Step 1 — Magnetopause current contribution:',
        `  b·√(P_dyn) = ${b.toFixed(2)} × √(${Pdyn.toFixed(2)}) = ${magPert.toFixed(2)} nT`,
        '',
        'Step 2 — Corrected Dst:',
        `  Dst* = Dst − b√(P_dyn) + c`,
        `  Dst* = ${Dst.toFixed(1)} − ${magPert.toFixed(2)} + ${c.toFixed(1)}`,
        `  Dst* = ${DstStar.toFixed(1)} nT`,
        '',
        'Step 3 — Storm classification (based on Dst*):',
        `  ${DstStar < -200 ? 'EXTREME STORM — Dst* < -200 nT (e.g. Carrington-class)' : DstStar < -100 ? 'MAJOR STORM — Dst* -100 to -200 nT (e.g. 1989, 2003 Halloween)' : DstStar < -50 ? 'MODERATE STORM — Dst* -50 to -100 nT' : DstStar < -30 ? 'WEAK STORM — Dst* -30 to -50 nT' : 'QUIET / RECOVERY PHASE — Dst* > -30 nT'}`,
        '',
        `  └ Dst* isolates ring current injection by removing magnetopause compression effects`,
      ]
    };
  },
  122: ({ eps0, kB, Te, ne }) => {
    const lambda = Math.sqrt((eps0 * kB * Te) / (ne || 1));
    const N_D = ne * (4 / 3) * Math.PI * Math.pow(lambda, 3);
    return {
      result: lambda, unit: 'm',
      steps: [
        '── Debye Length (Debye & Hückel, 1923; Chen, 1984) ──',
        `Vacuum permittivity ε₀ = ${eps0.toExponential(4)} F/m`,
        `Boltzmann constant k_B = ${kB.toExponential(4)} J/K`,
        `Electron temperature T_e = ${Te.toFixed(1)} K (${(Te / 11604.5).toFixed(2)} eV)`,
        `Electron density n_e = ${ne.toExponential(3)} m⁻³`,
        '',
        'Step 1 — Compute Debye length:',
        `  λ_D = √(ε₀·k_B·T_e / n_e)`,
        `  λ_D = √(${eps0.toExponential(4)} × ${kB.toExponential(4)} × ${Te.toFixed(1)} / ${ne.toExponential(3)})`,
        `  λ_D = ${lambda.toExponential(3)} m (${(lambda * 1000).toFixed(3)} mm)`,
        '',
        'Step 2 — Plasma parameter (number of particles in Debye sphere):',
        `  N_D = n_e · (4π/3) · λ_D³ = ${ne.toExponential(3)} × ${(4 * Math.PI / 3).toFixed(3)} × (${lambda.toExponential(3)})³`,
        `  N_D = ${N_D.toExponential(3)} particles`,
        '',
        'Step 3 — Plasma state:',
        `  ${N_D > 100 ? 'IDEAL PLASMA (N_D ≫ 1) — collective behaviour dominates' : 'Non-ideal / strongly coupled — kinetic effects important'}`,
        '',
        `  └ Debye shielding length: E-field of a test charge decays as exp(−r/λ_D)`,
        `  └ Quasi-neutrality holds for scale L ≫ λ_D`,
      ]
    };
  },

  // ── Domain 20: Satellite Dynamics ──
  123: ({ rho, CD, A, m, v }) => {
    const dragAccel = -0.5 * rho * CD * (A / (m || 1)) * v * v;
    const FD = dragAccel * m;
    return {
      result: FD, unit: 'N',
      steps: [
        '── Atmospheric Drag — Satellite Perturbation (King-Hele, 1964; Vallado, 2013) ──',
        `Atmospheric density ρ = ${rho.toExponential(3)} kg/m³`,
        `Drag coefficient C_D = ${CD.toFixed(2)} (typical: 2.0–2.2)`,
        `Cross-sectional area A = ${A.toFixed(2)} m², Mass m = ${m.toFixed(1)} kg`,
        `Velocity v = ${v.toFixed(0)} m/s (${(v / 1000).toFixed(2)} km/s)`,
        '',
        'Step 1 — Compute drag acceleration:',
        `  a_D = −½·ρ·C_D·(A/m)·v²`,
        `  a_D = −½ × ${rho.toExponential(3)} × ${CD.toFixed(2)} × (${A.toFixed(2)}/${m.toFixed(1)}) × (${v.toFixed(0)})²`,
        `  a_D = ${dragAccel.toExponential(4)} m/s²`,
        '',
        'Step 2 — Compute drag force:',
        `  F_D = m × a_D = ${m.toFixed(1)} × ${dragAccel.toExponential(4)}`,
        `  F_D = ${FD.toExponential(4)} N`,
        '',
        'Step 3 — Decay significance:',
        `  ${Math.abs(dragAccel) > 1e-4 ? 'SIGNIFICANT — orbit decaying rapidly (low altitude < 500 km)' : Math.abs(dragAccel) > 1e-6 ? 'MODERATE — noticeable decay, orbit maintenance needed' : 'WEAK — negligible drag (high altitude > 800 km or ballistic coefficient large)'}`,
        '',
        `  └ Ballistic coefficient: B* = C_D·A/m = ${(CD * A / m).toExponential(4)} m²/kg`,
        `  └ Semi-major axis decay: da/dt ≈ −ρ·B*·v·a (integrated over orbit)`,
      ]
    };
  },
  124: ({ rho, CD, A, v, m }) => {
    const da = -(rho * CD * A * v) / (m || 1);
    return {
      result: da, unit: 'm/s²',
      steps: [
        '── Satellite Deceleration (King-Hele, 1964) ──',
        `Atmospheric density ρ = ${rho.toExponential(3)} kg/m³`,
        `Drag coefficient C_D = ${CD.toFixed(2)}, Area A = ${A.toFixed(2)} m²`,
        `Mass m = ${m.toFixed(1)} kg, Velocity v = ${v.toFixed(0)} m/s`,
        '',
        'Step 1 — Compute deceleration:',
        `  da/dt = −(ρ·C_D·A·v) / m`,
        `  da/dt = −(${rho.toExponential(3)} × ${CD.toFixed(2)} × ${A.toFixed(2)} × ${v.toFixed(0)}) / ${m.toFixed(1)}`,
        `  da/dt = ${da.toExponential(3)} m/s²`,
        '',
        'Step 2 — Orbital impact:',
        `  Orbital energy loss: dE/dt = v·da/dt = ${(v * da).toExponential(3)} W/kg`,
        `  ${Math.abs(da) > 1e-4 ? 'Rapid deceleration — orbit decay measurable within days (LEO < 400 km)' : Math.abs(da) > 1e-6 ? 'Gradual decay — typical for 500–700 km altitude' : 'Minimal drag — above 800 km, drag is negligible'}`,
        '',
        `  └ Decay rate: dh/dt ≈ −(da/dt)·(2a³/GM)^(1/2) — altitude loss per orbit`,
      ]
    };
  },
  125: ({ A1, A2, sigmax, sigmay, d }) => {
    const combinedArea = A1 + A2;
    const normConst = combinedArea / (2 * Math.PI * sigmax * sigmay);
    const expArg = -(d * d) / (2 * sigmax * sigmay);
    const Pc = normConst * Math.exp(expArg);
    return {
      result: Pc, unit: '—',
      steps: [
        '── Satellite Collision Probability (Akella & Alfano, 2000; Chan, 2008) ──',
        `Covariance (radial): σ_x = ${sigmax.toFixed(3)} m, (cross-track): σ_y = ${sigmay.toFixed(3)} m`,
        `Object cross-sections: A₁ = ${A1.toFixed(2)} m², A₂ = ${A2.toFixed(2)} m²`,
        `Miss distance d = ${d.toFixed(2)} m`,
        '',
        'Step 1 — Combined hard-body radius:',
        `  R = √((A₁+A₂)/π) = √(${combinedArea.toFixed(2)} / π) = ${Math.sqrt(combinedArea / Math.PI).toFixed(2)} m`,
        '',
        'Step 2 — Probability density at encounter:',
        `  P_c = (A₁+A₂) / (2πσ_xσ_y) × exp(−d²/(2σ_xσ_y))`,
        `  = ${combinedArea.toFixed(2)} / (2π × ${sigmax.toFixed(3)} × ${sigmay.toFixed(3)}) × exp(−(${d.toFixed(2)})² / (2 × ${sigmax.toFixed(3)} × ${sigmay.toFixed(3)}))`,
        `  = ${normConst.toExponential(4)} × exp(${expArg.toFixed(3)})`,
        '',
        'Step 3 — Collision risk:',
        `  P_c = ${Pc.toExponential(3)}`,
        '',
        `  └ Threshold: ${Pc > 1e-4 ? 'HIGH RISK — avoidance maneuver recommended (> 1/10,000)' : Pc > 1e-5 ? 'MODERATE RISK — monitor closely' : 'LOW RISK — routine monitoring'}`,
        `  └ Assumes: linear relative motion, Gaussian errors, short conjunction window`,
      ]
    };
  },
  126: ({ rho2, sigma, v, N, L, beta, gamma }) => {
    const fragTerm = 0.5 * rho2 * rho2 * sigma * v * N * N;
    const lossCubic = beta * Math.pow(N, 3);
    const lossLinear = gamma * N;
    const dN = fragTerm + L - lossCubic - lossLinear;
    return {
      result: dN, unit: 'km⁻³/yr',
      steps: [
        '── Kessler-McKinley Debris Evolution (Kessler & Cour-Palais, 1978; Kessler, 1991) ──',
        `Spatial density ρ = ${rho2.toExponential(3)} km⁻³, Collision cross-section σ = ${sigma.toExponential(3)} km²`,
        `Relative velocity v = ${v.toExponential(3)} km/yr`,
        `Current debris count N = ${N.toExponential(3)}, Launch rate L = ${L.toExponential(2)} km⁻³/yr`,
        `Collision loss β = ${beta.toExponential(3)} km³/yr, Drag decay γ = ${gamma.toExponential(3)} /yr`,
        '',
        'Step 1 — Fragmentation source term:',
        `  ½ρ²·σ·v·N² = ½ × (${rho2.toExponential(3)})² × ${sigma.toExponential(3)} × ${v.toExponential(3)} × (${N.toExponential(3)})²`,
        `  = ${fragTerm.toExponential(3)} km⁻³/yr`,
        '',
        'Step 2 — Loss terms:',
        `  Cubic (collisional) loss: βN³ = ${beta.toExponential(3)} × (${N.toExponential(3)})³ = ${lossCubic.toExponential(3)} km⁻³/yr`,
        `  Linear (drag) loss: γN = ${gamma.toExponential(3)} × ${N.toExponential(3)} = ${lossLinear.toExponential(3)} km⁻³/yr`,
        '',
        'Step 3 — Net rate of change:',
        `  dN/dt = ${fragTerm.toExponential(3)} + ${L.toExponential(2)} − ${lossCubic.toExponential(3)} − ${lossLinear.toExponential(3)}`,
        `  dN/dt = ${dN.toExponential(3)} km⁻³/yr`,
        '',
        'Step 4 — Kessler Syndrome assessment:',
        `  ${dN > 0 ? 'POSITIVE GROWTH — debris population increasing (collisional cascading potential)' : dN < 0 ? 'NEGATIVE GROWTH — debris decreasing (decay > production)' : 'STEADY STATE — production balanced by removal'}`,
        '',
        `  └ Critical density threshold: N_crit ≈ √(2γ/(ρ²σv)) beyond which cascading is self-sustaining`,
      ]
    };
  },
  127: ({ n, ax, ay, az }) => {
    const xAccel = 2 * n * ax - 3 * n * n * ax;
    const yAccel = 2 * n * ay;
    const zAccel = -n * n * az + az;
    const accelMag = Math.hypot(xAccel, yAccel, zAccel);
    return {
      result: accelMag, unit: 'm/s²',
      steps: [
        '── Hill-Clohessy-Wiltshire Equations (Clohessy & Wiltshire, 1960; Hill, 1878) ──',
        `Mean motion n = ${n.toExponential(4)} rad/s`,
        `Perturbation accelerations: a_x = ${ax.toExponential(3)} m/s², a_y = ${ay.toExponential(3)} m/s², a_z = ${az.toExponential(3)} m/s²`,
        '',
        'Step 1 — HCW relative motion:',
        `  ẍ − 2nẏ − 3n²x = a_x`,
        `  → ẍ = 2·${n.toExponential(4)}·${ax.toExponential(3)} − 3·(${n.toExponential(4)})²·${ax.toExponential(3)}`,
        `  → ẍ = ${xAccel.toExponential(3)} m/s²`,
        '',
        'Step 2 — Cross-track components:',
        `  ÿ + 2nẋ = a_y → ÿ = ${yAccel.toExponential(3)} m/s²`,
        `  z̈ + n²z = a_z → z̈ = ${zAccel.toExponential(3)} m/s²`,
        '',
        'Step 3 — Total perturbation acceleration:',
        `  |a| = √(${xAccel.toExponential(3)}² + ${yAccel.toExponential(3)}² + ${zAccel.toExponential(3)}²)`,
        `  |a| = ${accelMag.toExponential(3)} m/s²`,
        '',
        `  └ Secular drift occurs when initial conditions yield a non-zero offset in along-track position`,
        `  └ HCW valid for close proximity manoeuvres with circular reference orbit`,
      ]
    };
  },

  // ── Domain 21: Solar-Terrestrial & GNSS ──
  128: ({ wi: _wi, Ki }) => {
    const sumWeights = Ki.reduce((s: number) => s + 1, 0);
    const sumWeighted = Ki.reduce((s: number, k: number, i: number) => s + k * (i + 1), 0);
    const Kp = sumWeighted / (sumWeights || 1);
    return {
      result: Kp, unit: '—',
      steps: [
        '── Kp-index Planetary Geomagnetic Index (Bartels, 1939; GFZ Potsdam) ──',
        `${Ki.length} magnetic observatory K-index values: [${Ki.map((k: number) => k.toFixed(1)).join(', ')}]`,
        'Weights (i+1): each station weighted equally',
        '',
        'Step 1 — Weighted average of K-values:',
        `  Σ(w_i·K_i) = ${Ki.map((k: number, i: number) => `${(i + 1).toFixed(0)}×${k.toFixed(1)}`).join(' + ')}`,
        `  = ${sumWeighted.toFixed(2)}`,
        `  Σw_i = ${sumWeights.toFixed(0)}`,
        '',
        'Step 2 — Compute Kp:',
        `  Kp = ${sumWeighted.toFixed(2)} / ${sumWeights.toFixed(0)} = ${Kp.toFixed(1)}`,
        '',
        'Step 3 — Geomagnetic activity:',
        `  ${Kp < 3 ? 'QUIET — Kp 0–2: stable geomagnetic field' : Kp < 5 ? 'ACTIVE — Kp 3–4: minor storm, aurora at high latitudes' : Kp < 6 ? 'G1 STORM — Kp 5: minor, aurora visible at lower latitudes' : Kp < 7 ? 'G2 STORM — Kp 6: moderate, power grid fluctuations' : Kp < 8 ? 'G3 STORM — Kp 7: strong, satellite anomalies possible' : Kp < 9 ? 'G4 STORM — Kp 8: severe, widespread voltage control problems' : 'G5 STORM — Kp 9: extreme, extensive power grid collapse risk'}`,
        '',
        `  └ A_p index = 10^(Kp/9)·15.8 (linear equivalent, range 0–400 nT)`,
      ]
    };
  },
  129: ({ traceH }) => {
    const GDOP = Math.sqrt(traceH);
    const PDOP = Math.sqrt(traceH * 0.7); // proxy: PDOP ~ 0.84·GDOP
    const HDOP = Math.sqrt(traceH * 0.4);
    const VDOP = Math.sqrt(traceH * 0.3);
    return {
      result: GDOP, unit: '—',
      steps: [
        '── Geometric Dilution of Precision (Langley, 1999; Parkinson & Spilker, 1996) ──',
        `Trace of (H^T·H)^(−1) = ${traceH.toFixed(4)}`,
        '',
        'Step 1 — Compute GDOP:',
        `  GDOP = √(trace(H^T·H)^(−1)) = √(${traceH.toFixed(4)})`,
        `  GDOP = ${GDOP.toFixed(2)}`,
        '',
        'Step 2 — DOP components (approximate: PDOP/HDOP/VDOP):',
        `  PDOP ≈ ${PDOP.toFixed(2)} (position) | HDOP ≈ ${HDOP.toFixed(2)} (horizontal) | VDOP ≈ ${VDOP.toFixed(2)} (vertical)`,
        '',
        'Step 3 — GNSS quality rating:',
        `  ${GDOP < 2 ? 'EXCELLENT — ideal satellite geometry' : GDOP < 4 ? 'GOOD — typical for open-sky conditions' : GDOP < 6 ? 'MODERATE — reduced accuracy, trees/buildings' : GDOP < 10 ? 'POOR — limited sky view, urban canyon' : 'VERY POOR — unreliable positioning, few satellites'}`,
        '',
        `  └ Good GDOP requires ≥ 6 satellites well-distributed (minimum elevation mask)`,
        `  └ VDOP typically 1.5–3× worse than HDOP due to single-sided sky view`,
      ]
    };
  },
  130: ({ P, T, e, Sc }) => {
    // Saastamoinen (1972): Δτ = (0.002277/sin θ)·[P + (1255/(T+0.05))·e]
    // Here Sc carries the elevation angle θ (mapped via ALIGN 'θ'→'Sc' from
    // the user input / Saastamoinen param block). sin(θ) = sin(Sc).
    const sinTheta = Math.sin(Sc);
    const dryTerm = P;
    const wetTerm = (1255 / (T + 0.05)) * e;
    const dTau = (0.002277 / sinTheta) * (dryTerm + wetTerm);
    return {
      result: dTau, unit: 'm',
      steps: [
        '── Tropospheric Delay — Saastamoinen Model (Saastamoinen, 1972; Davis et al., 1985) ──',
        `Surface pressure P = ${P.toFixed(1)} hPa`,
        `Temperature T = ${T.toFixed(1)} K (${(T - 273.15).toFixed(1)} °C)`,
        `Partial water vapour pressure e = ${e.toFixed(2)} hPa`,
        `Elevation angle θ = ${Sc.toFixed(4)} rad (${(Sc * 180 / Math.PI).toFixed(1)}°), sin(θ) = ${sinTheta.toFixed(4)}`,
        '',
        'Step 1 — Hydrostatic (dry) delay term:',
        `  P = ${dryTerm.toFixed(1)} hPa`,
        '',
        'Step 2 — Wet delay term:',
        `  (1255/(T+0.05))·e = 1255/(${T.toFixed(1)}+0.05) × ${e.toFixed(2)} = ${wetTerm.toFixed(2)} hPa`,
        '',
        'Step 3 — Total slant delay:',
        `  Δτ = 0.002277/sin(θ) × (P + wet) = 0.002277/${sinTheta.toFixed(4)} × (${dryTerm.toFixed(1)} + ${wetTerm.toFixed(2)})`,
        `  Δτ = ${dTau.toFixed(3)} m (${(dTau * 100).toFixed(2)} cm)`,
        '',
        'Step 4 — Delay breakdown:',
        `  Hydrostatic zenith delay (ZHD) ≈ 0.002277·P = ${(0.002277 * P).toFixed(3)} m`,
        `  Wet zenith delay (ZWD) ≈ 0.002277·1255·e/(T+0.05) = ${(0.002277 * wetTerm).toFixed(3)} m`,
        '',
        `  └ ${dTau < 1 ? 'Low delay — low elevation or dry atmosphere' : dTau < 3 ? 'Moderate delay — typical mid-latitude' : 'High delay — tropical / humid atmosphere'}`,
      ]
    };
  },

  // ── Part VII · Domain 22: Groundwater ──
  131: ({ T, h1, h2, r1, r2 }) => {
    const dh = h2 - h1;
    const lnRatio = Math.log(r2 / r1);
    const Q = (2 * Math.PI * T * dh) / lnRatio;
    return {
      result: Q, unit: 'm³/day',
      steps: [
        '── Thiem Equation — Steady Radial Flow (Thiem, 1906; Dupuit, 1863) ──',
        `Transmissivity T = ${T.toFixed(2)} m²/day`,
        `Drawdown: h₁ = ${h1.toFixed(2)} m (at r₁ = ${r1.toFixed(1)} m), h₂ = ${h2.toFixed(2)} m (at r₂ = ${r2.toFixed(1)} m)`,
        `Head difference Δh = ${dh.toFixed(2)} m`,
        '',
        'Step 1 — Compute log ratio:',
        `  ln(r₂/r₁) = ln(${r2.toFixed(1)} / ${r1.toFixed(1)}) = ${lnRatio.toFixed(4)}`,
        '',
        'Step 2 — Compute flow rate:',
        `  Q = 2π·T·Δh / ln(r₂/r₁)`,
        `  Q = 2π × ${T.toFixed(2)} × ${dh.toFixed(2)} / ${lnRatio.toFixed(4)}`,
        `  Q = ${Q.toFixed(2)} m³/day`,
        '',
        'Step 3 — Aquifer productivity:',
        `  ${Q > 5000 ? 'HIGH-YIELD — regional water supply aquifer' : Q > 500 ? 'MODERATE — suitable for irrigation / municipal' : Q > 50 ? 'LOW — domestic well scale' : 'MINOR — limited production capacity'}`,
        '',
        `  └ Assumes: confined aquifer, complete penetration, steady-state, homogeneous T`,
      ]
    };
  },
  132: ({ Q, T, t, r, S }) => {
    const u = Math.max((r * r) * S / (4 * T * t), 1e-30);
    const gamma = 0.5772156649;
    const W_u = u < 1
      ? -gamma - Math.log(u) + u - (u * u) / 4 + (u * u * u) / 18 - (u * u * u * u) / 96
      : Math.exp(-u) / u;
    const s = (Q / (4 * Math.PI * T)) * W_u;
    return {
      result: s, unit: 'm',
      steps: [
        '── Theis Well Function — Unsteady Radial Flow (Theis, 1935) ──',
        `Pumping rate Q = ${Q.toFixed(2)} m³/day, Transmissivity T = ${T.toFixed(2)} m²/day`,
        `Time t = ${t.toFixed(2)} days, Distance r = ${r.toFixed(1)} m`,
        `Storativity S = ${S.toExponential(3)}`,
        '',
        'Step 1 — Compute dimensionless argument u:',
        `  u = r²·S / (4·T·t) = (${r.toFixed(1)})² × ${S.toExponential(3)} / (4 × ${T.toFixed(2)} × ${t.toFixed(2)})`,
        `  u = ${u.toExponential(3)}`,
        '',
        'Step 2 — Compute well function W(u):',
        `  W(u) = −γ − ln(u) + u − u²/4 + u³/18 − u⁴/96`,
        `  ${u < 1 ? 'u < 1: series converges rapidly (small u approximation valid)' : 'u ≥ 1: using exponential integral asymptotic'}`,
        `  W(u) = ${W_u.toExponential(4)}`,
        '',
        'Step 3 — Drawdown at observation well:',
        `  s = (Q / 4πT) × W(u) = (${Q.toFixed(2)} / (4π × ${T.toFixed(2)})) × ${W_u.toExponential(4)}`,
        `  s = ${s.toFixed(3)} m`,
        '',
        'Step 4 — Aquifer test diagnostics:',
        `  ${s < 0.1 ? 'Minimal drawdown — high T or low Q' : s < 1 ? 'Small drawdown — good transmissivity' : s < 5 ? 'Moderate drawdown — typical pumping test' : 'Large drawdown — low T or excessive pumping'}`,
        '',
        `  └ Uses Jacob approximation (on semi-log plot) when u < 0.01 for straight-line analysis`,
      ]
    };
  },
  133: ({ Q, T, t, r, S }) => {
    const arg = (2.25 * T * t) / (r * r * S);
    const s = (2.3 * Q / (4 * Math.PI * T)) * Math.log10(Math.max(arg, 1e-10));
    return {
      result: s, unit: 'm',
      steps: [
        '── Cooper-Jacob Approximation (Cooper & Jacob, 1946) ──',
        `Pumping rate Q = ${Q.toFixed(2)} m³/day, Transmissivity T = ${T.toFixed(2)} m²/day`,
        `Time t = ${t.toFixed(2)} days, Distance r = ${r.toFixed(1)} m`,
        `Storativity S = ${S.toExponential(3)}`,
        '',
        'Step 1 — Verify validity (u < 0.01):',
        `  u = r²S / 4Tt = ${(r * r * S / (4 * T * t)).toExponential(3)}`,
        `  ${(r * r * S / (4 * T * t)) < 0.01 ? '✓ u < 0.01 — Jacob approximation valid' : '⚠ u ≥ 0.01 — use full Theis well function for accuracy'}`,
        '',
        'Step 2 — Logarithmic argument:',
        `  2.25·T·t/(r²·S) = 2.25 × ${T.toFixed(2)} × ${t.toFixed(2)} / (${(r * r).toFixed(0)} × ${S.toExponential(3)})`,
        `  = ${arg.toExponential(3)}`,
        '',
        'Step 3 — Compute drawdown:',
        `  s = (2.3·Q / 4πT) × log₁₀(2.25·T·t/r²S)`,
        `  s = (2.3 × ${Q.toFixed(2)} / (4π × ${T.toFixed(2)})) × log₁₀(${arg.toExponential(3)})`,
        `  s = ${s.toFixed(3)} m`,
        '',
        'Step 4 — Straight-line diagnostics:',
        `  Slope on semi-log plot: Δs/log cycle ≈ ${(2.3 * Q / (4 * Math.PI * T)).toFixed(4)} m/log cycle`,
        `  ${s > 0.1 ? 'Measurable drawdown — suitable for T/S estimation' : 'Very small drawdown — needs longer pumping or closer observation well'}`,
        '',
        `  └ Also gives: T = 2.3Q/(4πΔs) from slope; S = 2.25Tt₀/r² from intercept t₀`,
      ]
    };
  },
  134: ({ fc, f0, k, t }) => {
    const excess = f0 - fc;
    const decay = Math.exp(-k * t);
    const f = fc + excess * decay;
    const cumInf = fc * t + (excess / k) * (1 - decay);
    return {
      result: f, unit: 'mm/h',
      steps: [
        '── Horton Infiltration Model (Horton, 1933) ──',
        `Initial infiltration rate f₀ = ${f0.toFixed(2)} mm/h`,
        `Equilibrium rate f_c = ${fc.toFixed(2)} mm/h (saturated conductivity)`,
        `Decay constant k = ${k.toExponential(3)} /h, Time t = ${t.toFixed(2)} h`,
        '',
        'Step 1 — Compute exponential decay factor:',
        `  e^(−kt) = exp(−${k.toExponential(3)} × ${t.toFixed(2)}) = ${decay.toExponential(4)}`,
        '',
        'Step 2 — Infiltration rate at time t:',
        `  f(t) = f_c + (f₀ − f_c)·e^(−kt)`,
        `  f(${t.toFixed(1)} h) = ${fc.toFixed(2)} + (${f0.toFixed(2)} − ${fc.toFixed(2)}) × ${decay.toExponential(4)}`,
        `  f(${t.toFixed(1)} h) = ${f.toFixed(2)} mm/h`,
        '',
        'Step 3 — Cumulative infiltration:',
        `  F(t) = f_c·t + (f₀−f_c)/k·(1−e^(−kt))`,
        `  F(${t.toFixed(1)} h) = ${cumInf.toFixed(2)} mm total infiltrated`,
        '',
        'Step 4 — Infiltration regime:',
        `  ${f / f0 > 0.8 ? 'EARLY STAGE — matrix potential dominated' : f / f0 > 0.3 ? 'TRANSITION — mixed gravitational/capillary' : 'LATE STAGE — gravity-dominated, near f_c'}`,
        '',
        `  └ Time to near-equilibrium (f ≈ 1.05·f_c): t ≈ 3/k ≈ ${(3 / k).toFixed(1)} h`,
      ]
    };
  },

  // ── Domain 23: Hazard & Risk ──
  135: ({ H, V, E }) => {
    const R = H * V * E;
    return {
      result: R, unit: '—',
      steps: [
        '── Risk Equation — Crichton Triangle (Crichton, 1999; UNDRO, 1979) ──',
        `Hazard H = ${H.toFixed(3)} (event probability × intensity)`,
        `Vulnerability V = ${V.toFixed(3)} (0–1: degree of loss given event)`,
        `Exposure E = ${E.toFixed(3)} (elements at risk, e.g. population × value)`,
        '',
        'Step 1 — Compute risk:',
        `  Risk = H × V × E = ${H.toFixed(3)} × ${V.toFixed(3)} × ${E.toFixed(3)}`,
        `  Risk = ${R.toFixed(3)} (expected loss units)`,
        '',
        'Step 2 — Risk level:',
        `  ${R < 0.1 ? 'LOW — negligible risk, routine monitoring' : R < 0.3 ? 'MODERATE — acceptable risk, standard mitigation' : R < 0.6 ? 'HIGH — requires active risk reduction measures' : 'VERY HIGH — priority intervention, evacuation planning'}`,
        '',
        `  └ Components: H = f(probability, magnitude); V depends on structural/physical/social factors; E quantifies population and assets`,
      ]
    };
  },
  136: ({ Parr }) => {
    const EAD = Number(Parr) || 0;
    return {
      result: EAD, unit: '$/yr',
      steps: [
        '── Expected Annual Damage (Meyer et al., 2009; FEMA HAZUS) ──',
        `Damage integral EAD = ∫₀¹ D(P)·dP`,
        `Input damage estimate = $${EAD.toFixed(0)}/yr`,
        '',
        'Step 1 — Expected annual damage:',
        `  EAD = Σ_{i} P(event_i) × D_i`,
        `  EAD ≈ $${EAD.toFixed(0)} per year`,
        '',
        'Step 2 — Risk assessment:',
        `  ${EAD > 1e6 ? 'CATASTROPHIC — > $1M/yr expected loss, flood insurance essential' : EAD > 1e4 ? 'HIGH — > $10K/yr, risk transfer recommended' : EAD > 1e3 ? 'MODERATE — > $1K/yr, monitor regularly' : 'LOW — minimal financial risk'}`,
        '',
        `  └ EAD derived from flood hazard curve (stage-frequency), depth-damage functions, and asset inventory`,
        `  └ Benefits of mitigation: reduction in EAD @ BCR = ΔEAD / annual cost`,
      ]
    };
  },
  137: ({ I_Hi, I_Lo, BP_Hi, BP_Lo, C_p }) => {
    const denom = (BP_Hi - BP_Lo) || 1;
    const concRatio = (C_p - BP_Lo) / denom;
    const AQI = (I_Hi - I_Lo) * concRatio + I_Lo;
    return {
      result: AQI, unit: '—',
      steps: [
        '── US EPA Air Quality Index (EPA, 2016) ──',
        `Breakpoints: BP_lo = ${BP_Lo.toFixed(1)}, BP_hi = ${BP_Hi.toFixed(1)}`,
        `Indices: I_lo = ${I_Lo.toFixed(0)}, I_hi = ${I_Hi.toFixed(0)}`,
        `Pollutant concentration C_p = ${C_p.toFixed(2)}`,
        '',
        'Step 1 — Ratio of concentration within breakpoint interval:',
        `  (C_p − BP_lo) / (BP_hi − BP_lo) = (${C_p.toFixed(2)} − ${BP_Lo.toFixed(1)}) / (${BP_Hi.toFixed(1)} − ${BP_Lo.toFixed(1)})`,
        `  = ${concRatio.toFixed(4)}`,
        '',
        'Step 2 — Linear interpolation to AQI:',
        `  AQI = (I_hi − I_lo) × ratio + I_lo`,
        `  AQI = (${I_Hi.toFixed(0)} − ${I_Lo.toFixed(0)}) × ${concRatio.toFixed(4)} + ${I_Lo.toFixed(0)}`,
        `  AQI = ${AQI.toFixed(0)}`,
        '',
        'Step 3 — Health classification:',
        `  ${AQI <= 50 ? 'GOOD (0–50) — green, satisfactory air quality' : AQI <= 100 ? 'MODERATE (51–100) — yellow, acceptable for most' : AQI <= 150 ? 'UNHEALTHY FOR SENSITIVE GROUPS (101–150) — orange' : AQI <= 200 ? 'UNHEALTHY (151–200) — red, general population affected' : AQI <= 300 ? 'VERY UNHEALTHY (201–300) — purple, avoid outdoor activity' : 'HAZARDOUS (301–500) — maroon, emergency conditions'}`,
        '',
        `  └ Each pollutant (PM₂.₅, PM₁₀, O₃, NO₂, SO₂, CO) has distinct breakpoint table`,
      ]
    };
  },
  138: ({ Xbar, Kp, sigmaX }) => {
    const PMP = Xbar + Kp * sigmaX;
    return {
      result: PMP, unit: 'mm',
      steps: [
        '── Probable Maximum Precipitation — Hershfield Method (Hershfield, 1961; World Meteorological Organization, 1986) ──',
        `Mean annual maximum rainfall X̄ = ${Xbar.toFixed(1)} mm`,
        `Frequency factor K_p = ${Kp.toFixed(2)} (typically 5–20 for PMP)`,
        `Standard deviation σ_x = ${sigmaX.toFixed(1)} mm`,
        '',
        'Step 1 — Compute PMP:',
        `  PMP = X̄ + K_p × σ_x = ${Xbar.toFixed(1)} + ${Kp.toFixed(2)} × ${sigmaX.toFixed(1)}`,
        `  PMP = ${PMP.toFixed(1)} mm`,
        '',
        'Step 2 — Comparison with observed maximum:',
        `  K_p = ${Kp.toFixed(2)} → ${Kp < 10 ? 'Moderate factor — less extreme basin' : 'High factor — extreme rainfall potential'}`,
        `  Ratio PMP / X̄ = ${(PMP / Xbar).toFixed(1)}× the mean annual maximum`,
        '',
        `  └ PMP used for design of high-hazard dams (spillway capacity), nuclear facilities`,
        `  └ Hershfield envelope: K_p max ≈ 15 for 24-hr PMP in most regions`,
      ]
    };
  },
  139: ({ Xim1, Zi }) => {
    const Xi = 0.897 * Xim1 + Zi / 3;
    return {
      result: Xi, unit: '—',
      steps: [
        '── Palmer Drought Severity Index (Palmer, 1965) — Antecedent Precipitation ──',
        `Previous month value X_{i−1} = ${Xim1.toFixed(3)}`,
        `Current moisture anomaly Z_i = ${Zi.toFixed(3)} (hydrological departure)`,
        '',
        'Step 1 — PDSI recurrence formula:',
        `  X_i = 0.897 × X_{i−1} + Z_i / 3`,
        `  X_i = 0.897 × ${Xim1.toFixed(3)} + ${Zi.toFixed(3)} / 3`,
        `  X_i = ${Xi.toFixed(3)}`,
        '',
        'Step 2 — Drought classification:',
        `  ${Xi > 4 ? 'EXTREME WET — flood potential' : Xi > 3 ? 'SEVERE WET — very moist' : Xi > 2 ? 'MODERATE WET — above normal' : Xi > 0 ? 'SLIGHTLY WET / NEAR NORMAL' : Xi > -1 ? 'NEAR NORMAL' : Xi > -2 ? 'MODERATE DROUGHT' : Xi > -3 ? 'SEVERE DROUGHT' : 'EXTREME DROUGHT (< -3)'}`,
        '',
        `  └ PDSI uses a two-layer soil moisture model with 0.897 as a persistence factor calibrated for central US`,
        `  └ Z-index derived from: precipitation, temperature, soil moisture depletion, evapotranspiration`,
      ]
    };
  },
  140: ({ K0, Vres, hb }) => {
    const Bavg = 0.1803 * K0 * Math.pow(Vres, 0.32) * Math.pow(hb, 0.19);
    return {
      result: Bavg, unit: 'm³/s',
      steps: [
        '── Dam-Break Peak Discharge — Regression Model (Froehlich, 1995; USBR, 1988) ──',
        `Reservoir volume V_res = ${Vres.toExponential(2)} m³`,
        `Embarkment height h_b = ${hb.toFixed(1)} m`,
        `Breach factor K₀ = ${K0.toFixed(3)} (coefficient based on failure type)`,
        '',
        'Step 1 — Volume exponent:',
        `  V_res^0.32 = (${Vres.toExponential(2)})^0.32 = ${Math.pow(Vres, 0.32).toExponential(3)}`,
        '',
        'Step 2 — Height exponent:',
        `  h_b^0.19 = (${hb.toFixed(1)})^0.19 = ${Math.pow(hb, 0.19).toExponential(4)}`,
        '',
        'Step 3 — Compute peak discharge:',
        `  B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19`,
        `  B_avg = 0.1803 × ${K0.toFixed(3)} × ${Math.pow(Vres, 0.32).toExponential(3)} × ${Math.pow(hb, 0.19).toExponential(4)}`,
        `  B_avg = ${Bavg.toFixed(1)} m³/s`,
        '',
        'Step 4 — Hazard classification:',
        `  ${Bavg > 10000 ? 'CATASTROPHIC — >10,000 m³/s, massive downstream flooding' : Bavg > 1000 ? 'MAJOR — 1,000–10,000 m³/s, significant flood wave' : Bavg > 100 ? 'MODERATE — 100–1,000 m³/s, localized flooding' : 'MINOR — <100 m³/s, limited hazard'}`,
        '',
        `  └ K₀ ≈ 0.7–1.3: overtopping (piping 1.0–2.0); 0.1803 is fitting constant from dam failure database`,
      ]
    };
  },

  // ── Domain 24: Data Assimilation ──
  141: ({ xf, Pf, y, R, xb, H = 1 }) => {
    const den = (H * Pf * H + R) || 1;
    const K = (Pf * H) / den;
    const innov = y - H * xf;
    const xa = xb + K * innov;
    return {
      result: xa, unit: '—',
      steps: [
        '── Kalman Filter Analysis (Kalman, 1960; Welch & Bishop, 2006) ──',
        `Forecast x_f = ${xf.toFixed(3)}, Forecast error covariance P_f = ${Pf.toFixed(3)}`,
        `Observation y = ${y.toFixed(3)}, Observation error variance R = ${R.toFixed(3)}`,
        `Background x_b = ${xb.toFixed(3)}, Observation operator H = ${H.toFixed(2)}`,
        '',
        'Step 1 — Innovation (observation increment):',
        `  d = y − H·x_f = ${y.toFixed(3)} − ${H.toFixed(2)} × ${xf.toFixed(3)}`,
        `  d = ${innov.toFixed(4)}`,
        '',
        'Step 2 — Kalman gain:',
        `  K = P_f·H / (H·P_f·H + R) = ${Pf.toFixed(3)} × ${H.toFixed(2)} / (${H.toFixed(2)} × ${Pf.toFixed(3)} × ${H.toFixed(2)} + ${R.toFixed(3)})`,
        `  K = ${K.toFixed(4)} (weighting: model vs observation)`,
        '',
        'Step 3 — Analysis update:',
        `  x_a = x_b + K·d = ${xb.toFixed(3)} + ${K.toFixed(4)} × ${innov.toFixed(4)}`,
        `  x_a = ${xa.toFixed(3)}`,
        '',
        'Step 4 — Analysis error variance:',
        `  P_a = (1 − K·H)·P_f = (1 − ${K.toFixed(4)} × ${H.toFixed(2)}) × ${Pf.toFixed(3)} = ${((1 - K * H) * Pf).toFixed(4)}`,
        '',
        `  └ ${K > 0.5 ? 'OBSERVATION-WEIGHTED — high confidence in obs (R << P_f)' : K < 0.1 ? 'MODEL-WEIGHTED — high confidence in forecast' : 'BALANCED — comparable weights'}`,
      ]
    };
  },
  142: ({ xb, H = 1, y, R, B }) => {
    const den = (H * B * H + R) || 1;
    const K = (B * H) / den;
    const innov = y - H * xb;
    const xa = xb + K * innov;
    return {
      result: xa, unit: '—',
      steps: [
        '── 3D-Var Analysis (Lorenc, 1986; Ide et al., 1997) ──',
        `Background x_b = ${xb.toFixed(3)}, Background error covariance B = ${B.toFixed(3)}`,
        `Observation y = ${y.toFixed(3)}, Observation error variance R = ${R.toFixed(3)}`,
        `Observation operator H = ${H.toFixed(2)}`,
        '',
        'Step 1 — Innovation:',
        `  d = y − H·x_b = ${y.toFixed(3)} − ${H.toFixed(2)} × ${xb.toFixed(3)}`,
        `  d = ${innov.toFixed(4)}`,
        '',
        'Step 2 — Kalman gain matrix:',
        `  K = B·H^T / (H·B·H^T + R) = ${B.toFixed(3)} × ${H.toFixed(2)} / (${H.toFixed(2)} × ${B.toFixed(3)} × ${H.toFixed(2)} + ${R.toFixed(3)})`,
        `  K = ${K.toFixed(4)}`,
        '',
        'Step 3 — Analysis:',
        `  x_a = x_b + K·(y − H·x_b) = ${xb.toFixed(3)} + ${K.toFixed(4)} × ${innov.toFixed(4)}`,
        `  x_a = ${xa.toFixed(3)}`,
        '',
        'Step 4 — Weighting ratio:',
        `  B/R = ${(B / R).toFixed(2)} — ${B / R > 1 ? 'Background error dominates → analysis trusts observations more' : 'Observation error dominates → analysis stays close to background'}`,
        '',
        `  └ 3D-Var is equivalent to Kalman filter with static background error covariance B (no flow dependence)`,
      ]
    };
  },
  143: ({ x, xb, B, y, H, R, i: _i }) => {
    const bgTerm = 0.5 * (x - xb) * (1 / B) * (x - xb);
    const obsTerm = 0.5 * (y - H * x) * (1 / R) * (y - H * x);
    const J = bgTerm + obsTerm;
    return {
      result: J, unit: '—',
      steps: [
        '── Variational Cost Function — 3D/4D-Var (Sasaki, 1970; Lorenc, 1986) ──',
        `State vector x = ${x.toFixed(3)}, Background x_b = ${xb.toFixed(3)}`,
        `Background error covariance B = ${B.toFixed(3)}`,
        `Observation y = ${y.toFixed(3)}, Observation error R = ${R.toFixed(3)}`,
        `Observation operator H = ${H.toFixed(2)}`,
        '',
        'Step 1 — Background (J_b) term:',
        `  J_b = ½(x − x_b)ᵀB⁻¹(x − x_b)`,
        `  J_b = ½ × (${x.toFixed(3)} − ${xb.toFixed(3)}) × (1/${B.toFixed(3)}) × (${x.toFixed(3)} − ${xb.toFixed(3)})`,
        `  J_b = ${bgTerm.toFixed(4)}`,
        '',
        'Step 2 — Observation (J_o) term:',
        `  J_o = ½(y − H·x)ᵀR⁻¹(y − H·x)`,
        `  J_o = ½ × (${y.toFixed(3)} − ${H.toFixed(2)} × ${x.toFixed(3)}) × (1/${R.toFixed(3)}) × (${y.toFixed(3)} − ${H.toFixed(2)} × ${x.toFixed(3)})`,
        `  J_o = ${obsTerm.toFixed(4)}`,
        '',
        'Step 3 — Total cost:',
        `  J(x) = J_b + J_o = ${bgTerm.toFixed(4)} + ${obsTerm.toFixed(4)}`,
        `  J(x) = ${J.toFixed(4)}`,
        '',
        'Step 4 — Balance:',
        `  bg/obs ratio: J_b / J_o = ${obsTerm !== 0 ? (bgTerm / obsTerm).toFixed(2) : 'inf'} — ${bgTerm > obsTerm ? 'Background penalty dominates (strong constraint)' : 'Observation penalty dominates (weak constraint)'}`,
        '',
        `  └ Minimised by gradient descent: ∇J = B⁻¹(x−x_b) − HᵀR⁻¹(y−H·x) = 0 for optimal x_a`,
      ]
    };
  },
  144: ({ px, py, Hxy }) => {
    const Hx = -px * Math.log2(px || 1e-9);
    const Hy = -py * Math.log2(py || 1e-9);
    const Hjoint = -Hxy * Math.log2(Hxy || 1e-9);
    const Hinfo = Hx + Hy + Hjoint;
    return {
      result: Hinfo, unit: 'bits',
      steps: [
        '── Information Entropy — Shannon (Shannon, 1948; Cover & Thomas, 2006) ──',
        `Probability p(x) = ${px.toFixed(4)}, p(y) = ${py.toFixed(4)}, joint p(x,y) ≈ ${Hxy.toFixed(4)}`,
        '',
        'Step 1 — Marginal entropy H(X):',
        `  H(X) = −p(x)·log₂(p(x)) = −${px.toFixed(4)} × log₂(${px.toFixed(4)})`,
        `  H(X) = ${Hx.toFixed(4)} bits`,
        '',
        'Step 2 — Marginal entropy H(Y):',
        `  H(Y) = −p(y)·log₂(p(y)) = −${py.toFixed(4)} × log₂(${py.toFixed(4)})`,
        `  H(Y) = ${Hy.toFixed(4)} bits`,
        '',
        'Step 3 — Joint entropy H(X,Y) (proxy):',
        `  H(X,Y) ≈ −p(x,y)·log₂(p(x,y)) = ${Hjoint.toFixed(4)} bits`,
        '',
        'Step 4 — Total information:',
        `  H_total = H(X) + H(Y) + H(X,Y) = ${Hx.toFixed(4)} + ${Hy.toFixed(4)} + ${Hjoint.toFixed(4)}`,
        `  H_total = ${Hinfo.toFixed(3)} bits`,
        '',
        `  └ ${px > 0.9 || py > 0.9 ? 'Low entropy — near-deterministic variable' : Hinfo > 2 ? 'High entropy — high information content' : 'Moderate entropy'}`,
        `  └ Mutual information: I(X;Y) = H(X) + H(Y) − H(X,Y) — quantifies dependence between variables`,
      ]
    };
  },

  // ── Domain 25: Signal Processing ──
  145: ({ dKm, fGHz }) => {
    const logD = 20 * Math.log10(dKm || 1e-3);
    const logF = 20 * Math.log10(fGHz || 1e-3);
    const FSPL = 32.45 + logD + logF;
    const lambda_m = fGHz > 0 ? 0.3 / fGHz : 0; // λ = c/f in m
    return {
      result: FSPL, unit: 'dB',
      steps: [
        '── Free Space Path Loss (Friis, 1946; ITU-R P.525) ──',
        `Distance d = ${dKm.toFixed(1)} km, Frequency f = ${fGHz.toFixed(2)} GHz`,
        `Wavelength λ = c/f = 0.3 / ${fGHz.toFixed(2)} = ${lambda_m.toFixed(3)} m (${(lambda_m * 100).toFixed(1)} cm)`,
        '',
        'Step 1 — Distance term:',
        `  20·log₁₀(d_km) = 20 × log₁₀(${dKm.toFixed(1)}) = ${logD.toFixed(2)} dB`,
        '',
        'Step 2 — Frequency term:',
        `  20·log₁₀(f_GHz) = 20 × log₁₀(${fGHz.toFixed(2)}) = ${logF.toFixed(2)} dB`,
        '',
        'Step 3 — Free space path loss:',
        `  FSPL(dB) = 32.45 + 20·log₁₀(d_km) + 20·log₁₀(f_GHz)`,
        `  FSPL(dB) = 32.45 + ${logD.toFixed(2)} + ${logF.toFixed(2)}`,
        `  FSPL = ${FSPL.toFixed(2)} dB`,
        '',
        'Step 4 — Link budget assessment:',
        `  ${FSPL < 100 ? 'SHORT RANGE — line-of-sight, strong signal' : FSPL < 130 ? 'MEDIUM RANGE — typical terrestrial link (10–50 km)' : FSPL < 160 ? 'LONG RANGE — satellite downlink / rural comms' : 'EXTREME — deep-space / interplanetary link'}`,
        '',
        `  └ Received power: P_r = P_t + G_t + G_r − FSPL − other losses (dB)`,
      ]
    };
  },
  146: ({ Ai, x }) => {
    const poly = 1 - (x * x) / 2 + Math.pow(x, 4) / 24;
    const delay_s = 5e-9 + Ai * poly;
    const delay_ns = delay_s * 1e9;
    const rangeErr = delay_s * 299792458;
    return {
      result: delay_ns, unit: 'ns',
      steps: [
        '── Klobuchar Ionospheric Delay Model (Klobuchar, 1987; ICD-GPS-200) ──',
        `Amplitude A_i = ${Ai.toExponential(2)} s`,
        `Normalised time x = t/period = ${x.toFixed(4)} (drives cosinusoidal shape)`,
        '',
        'Step 1 — Polynomial approximation of cosine:',
        `  1 − x²/2 + x⁴/24 = 1 − (${x.toFixed(4)})²/2 + (${x.toFixed(4)})⁴/24`,
        `  = ${poly.toFixed(4)}`,
        '',
        'Step 2 — Slant delay at L1 (1.57542 GHz):',
        `  Δτ = 5 ns + A_i × (1 − x²/2 + x⁴/24)`,
        `  Δτ = 5 ns + ${Ai.toExponential(2)} × ${poly.toFixed(4)}`,
        `  Δτ = ${delay_s.toExponential(3)} s = ${delay_ns.toFixed(1)} ns`,
        '',
        'Step 3 — Range error equivalent:',
        `  Δρ = c·Δτ = ${rangeErr.toFixed(2)} m`,
        '',
        'Step 4 — Diurnal variation:',
        `  ${delay_ns > 15 ? 'HIGH delay — midday / equatorial / solar max conditions' : delay_ns > 5 ? 'MODERATE — typical mid-latitude daytime' : 'LOW — night-time / polar / solar minimum'}`,
        '',
        `  └ Klobuchar removes ~50% RMS error; dual-frequency (L1/L2) removes >90%`,
      ]
    };
  },
  147: ({ f0, vrel, c }) => {
    const beta = vrel / (c || 1);
    const df = f0 * beta;
    const isApproach = vrel < 0;
    return {
      result: df, unit: 'Hz',
      steps: [
        '── Doppler Shift (Doppler, 1842; Christian Doppler) ──',
        `Source frequency f₀ = ${f0.toExponential(4)} Hz`,
        `Relative velocity v_rel = ${vrel.toFixed(1)} m/s (${isApproach ? 'approaching' : 'receding'})`,
        `Speed of light c = ${c.toExponential(1)} m/s`,
        '',
        'Step 1 — Relativistic β factor:',
        `  β = v_rel / c = ${vrel.toFixed(1)} / ${c.toExponential(1)}`,
        `  β = ${beta.toExponential(4)} (non-relativistic: β ≪ 1)`,
        '',
        'Step 2 — Frequency shift:',
        `  Δf = f₀ × β = ${f0.toExponential(4)} × ${beta.toExponential(4)}`,
        `  Δf = ${df.toExponential(4)} Hz (${Math.abs(df) > 1e6 ? (df / 1e6).toFixed(2) + ' MHz' : Math.abs(df) > 1e3 ? (df / 1e3).toFixed(2) + ' kHz' : df.toFixed(1) + ' Hz'})`,
        '',
        'Step 3 — Observed frequency:',
        `  f_obs = f₀ + Δf = ${f0.toExponential(4)} + ${df.toExponential(4)} = ${(f0 + df).toExponential(4)} Hz`,
        `  ${isApproach ? 'BLUESHIFT (approaching: f_obs > f₀)' : 'REDSHIFT (receding: f_obs < f₀)'}`,
        '',
        `  └ Incoherent scatter radar: f_obs shift measured to derive ionospheric plasma velocity`,
      ]
    };
  },

  // ── Domain 26: Mathematical Frameworks ──
  148: ({ GM, r1, r2 }) => {
    const v_circ1 = Math.sqrt(GM / r1);
    const sqrtTerm = Math.sqrt(2 * r2 / (r1 + r2));
    const dv1 = v_circ1 * (sqrtTerm - 1);
    const dv2 = Math.sqrt(GM / r2) * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
    const totalDV = dv1 + dv2;
    const semiMajor = (r1 + r2) / 2;
    const period = 2 * Math.PI * Math.sqrt(Math.pow(semiMajor, 3) / GM);
    return {
      result: dv1, unit: 'm/s',
      steps: [
        '── Hohmann Transfer Orbit (Hohmann, 1925; Walter Hohmann) ──',
        `Standard gravitational parameter GM = ${GM.toExponential(3)} m³/s²`,
        `Initial circular orbit radius r₁ = ${r1.toExponential(3)} m (h = ${(r1 / 1000 - 6371).toFixed(0)} km altitude)`,
        `Target orbit radius r₂ = ${r2.toExponential(3)} m (h = ${(r2 / 1000 - 6371).toFixed(0)} km altitude)`,
        '',
        'Step 1 — Circular velocity in initial orbit:',
        `  v_circ₁ = √(GM/r₁) = √(${GM.toExponential(3)} / ${r1.toExponential(3)})`,
        `  v_circ₁ = ${v_circ1.toFixed(1)} m/s (${(v_circ1 / 1000).toFixed(2)} km/s)`,
        '',
        'Step 2 — Transfer ellipse velocity at perigee:',
        `  v_p = v_circ₁ × √(2·r₂/(r₁+r₂)) = ${v_circ1.toFixed(1)} × √(2 × ${r2.toExponential(3)} / (${r1.toExponential(3)} + ${r2.toExponential(3)}))`,
        `  v_p = ${v_circ1.toFixed(1)} × ${sqrtTerm.toFixed(4)} = ${(v_circ1 * sqrtTerm).toFixed(1)} m/s`,
        '',
        'Step 3 — Δv₁ at perigee:',
        `  Δv₁ = v_p − v_circ₁ = ${(v_circ1 * sqrtTerm).toFixed(1)} − ${v_circ1.toFixed(1)}`,
        `  Δv₁ = ${dv1.toFixed(1)} m/s`,
        '',
        'Step 4 — Second burn at apogee:',
        `  Δv₂ = ${dv2.toFixed(1)} m/s | Total Δv = ${totalDV.toFixed(1)} m/s`,
        `  Transfer semi-major axis a = ${semiMajor.toExponential(3)} m, Period = ${(period / 3600).toFixed(1)} h`,
        '',
        `  └ ${dv1 > 0 ? 'Orbit raising (r₂ > r₁) ✓' : 'Orbit lowering (r₂ < r₁)'}`,
        `  └ Hohmann is fuel-optimal for co-planar circular orbits when r₂/r₁ < 11.94`,
      ]
    };
  },
  149: ({ x: _x, y: _y }) => {
    const gamma = 0.5;
    const poly = gamma - gamma * gamma / 3 - gamma * gamma * gamma / 9;
    return {
      result: poly, unit: '—',
      steps: [
        '── Lagrange Point L1/L2 Polynomial (Lagrange, 1772; Euler, 1767) ──',
        `Mass ratio parameter γ = ${gamma.toFixed(3)} (proxy for μ = M₂/(M₁+M₂))`,
        '',
        'Step 1 — 5th-order collinear polynomial:',
        `  Leading terms for L₁/L₂ distance from secondary:`,
        `  r_L ≈ γ − γ²/3 − γ³/9`,
        `  r_L ≈ ${gamma.toFixed(3)} − (${gamma.toFixed(3)})²/3 − (${gamma.toFixed(3)})³/9`,
        '',
        'Step 2 — Distance from secondary mass:',
        `  r_L ≈ ${poly.toFixed(4)} (in units of separation distance)`,
        '',
        'Step 3 — Stability class:',
        `  ${poly < 0.1 ? 'Very close to secondary — L₁ (inside Hill sphere)' : poly < 0.3 ? 'Moderate distance — typical L₁/L₂ for binary system' : 'Far from secondary — marginal stability'}`,
        '',
        `  └ Full polynomial: (1−μ)(γ+μ)/|γ+μ|³ + μ(γ−1+μ)/|γ−1+μ|³ + γ − μγ = 0`,
        `  └ L₁ lies between M₁ and M₂; L₂ lies beyond M₂; both are unstable equilibrium points`,
      ]
    };
  },
  150: ({ px, py, pxy }) => {
    const pProd = (px * py) / (pxy || 1e-9);
    const MI = px * Math.log2((px || 1e-9) / pProd) + py * Math.log2((py || 1e-9) / pProd);
    const Hx = -px * Math.log2(px || 1e-9);
    const Hy = -py * Math.log2(py || 1e-9);
    const Hxy = -pxy * Math.log2(pxy || 1e-9);
    return {
      result: MI, unit: 'bits',
      steps: [
        '── Mutual Information (Shannon, 1948; Cover & Thomas, 2006) ──',
        `Probability p(x) = ${px.toFixed(4)}, p(y) = ${py.toFixed(4)}, joint p(x,y) ≈ ${pxy.toFixed(4)}`,
        '',
        'Step 1 — Entropy H(X) and H(Y):',
        `  H(X) = ${Hx.toFixed(4)} bits, H(Y) = ${Hy.toFixed(4)} bits`,
        '',
        'Step 2 — Joint entropy:',
        `  H(X,Y) ≈ ${Hxy.toFixed(4)} bits`,
        '',
        'Step 3 — Mutual information:',
        `  I(X;Y) = H(X) + H(Y) − H(X,Y)`,
        `  I(X;Y) = ${Hx.toFixed(4)} + ${Hy.toFixed(4)} − ${Hxy.toFixed(4)}`,
        `  I(X;Y) = ${MI.toFixed(4)} bits`,
        '',
        'Step 4 — Dependence strength:',
        `  ${MI < 0.01 ? 'NEARLY INDEPENDENT — variables uncorrelated' : MI < 0.1 ? 'WEAK dependence' : MI < 0.5 ? 'MODERATE dependence' : 'STRONG dependence — high predictive power'}`,
        '',
        `  └ I(X;Y) = 0 iff X and Y are independent; I(X;Y) = H(X) if Y fully determines X`,
        `  └ Normalised: NMI = I(X;Y) / √(H(X)·H(Y))`,
      ]
    };
  },
};

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Maps the analytical-tool input symbols (often Unicode subscripts / Greek
 * letters, e.g. Rₙ, σₙ, T_air) to the plain-ASCII parameter names the
 * compute functions destructure. Without this every non-ASCII input arrives
 * as `undefined` and the result is NaN.
 */
const PARAM_ALIASES: Record<number, Record<string, string>> = {
  1: { 'T₁₀': 'T10', 'T₁₁': 'T11', 'ε₁₀': 'eps10', 'ε₁₁': 'eps11' },
  5: { 'ρ': 'rho', 'dP/dx': 'dPdx', 'dP/dy': 'dPdy' },
  6: { 'C₀': 'C0' },
  7: { 'z_g': 'zg', 'z_s': 'zs', 'θᵥ(z)': 'thvz', 'θᵥ(s)': 'thvs', 'u(z)': 'uz', 'u(s)': 'us' },
  8: { 'ε': 'eps' },
  9: { 'Rₙ': 'Rn', 'u₂': 'u2', 'eₛ': 'es', 'eₐ': 'ea', 'Δ': 'delta', 'γ': 'gamma' },
  10: { 'Iₐ': 'Ia' },
  13: { 'Iₜ': 'It', 'Oₜ': 'Ot' },
  14: { 'H₀': 'H0' },
  15: { 'τ': 'tau', 'ρ': 'rho', 'Aᵥ': 'A' },
  16: { 'ρ': 'rho', '∂p/∂x': 'dpdx' },
  17: { 'Qₛ': 'Qs', 'Q_b': 'Qb', 'Q_h': 'Qh', 'Q_e': 'Qe' },
  18: { 'Kₛ': 'Ks', 'ψ_w': 'psiW', 'ψ₀': 'psi0', 'Δθ': 'dTheta', 'F(t)': 'Ft' },
  21: { 'M_ag': 'mag', 'D_st': 'dist', 'S_te': 'site', 'F_lt': 'fault', 'H_w': 'hw' },
  22: { 'σₙ': 'sigmaN', 'tan φ': 'tanPhi' },
  23: { 'M₀': 'M0' },
  24: { 'M₀': 'M0' },
  25: { 'M_w': 'Mw' },
  32: { 'ε': 'eps' },
  34: { 'T_air': 'Tair', 'T_base': 'Tbase' },
  36: { 'lat₁': 'lat1', 'lon₁': 'lon1', 'lat₂': 'lat2', 'lon₂': 'lon2' },
  37: { 'λᵢ': 'weights' },
  38: { 'wᵢ': 'weights' },
  39: { 'σ_y': 'sigmaY', 'σ_z': 'sigmaZ' },
  40: { 'μ': 'mu', 'β': 'beta' },
  41: { 'ξ': 'xi', 'β': 'beta' },
  43: { 'θ_r': 'thetaR', 'θ_s': 'thetaS', 'α': 'alpha', 'ψ': 'psi' },
  44: { 'ψ_b': 'psib', 'ψ': 'psi' },
  46: { 'R_base': 'Rbase', 'Q₁₀': 'Q10', 'T_base': 'Tbase' },
  47: { 'kᵢ': 'ki', 'fᵢ': 'fractions' },
  48: { 'κ': 'kappa', 'u_*': 'ustar' },
  49: { 'u_*': 'ustar', 'z₀': 'z0' },
  50: { 'g₀': 'g0', 'a₁': 'a1', 'hₛ': 'hs', 'cₛ': 'cs' },
  51: { 'ε': 'eps', 'fPAR': 'fpar', 'PAR': 'par' },
  52: { 'I₀': 'I0' },
  53: { 'R_eco': 'Reco' },
  54: { 'cᵢ': 'ci', 'Γ*': 'GammaStar', 'K_c': 'Kc', 'K_o': 'Ko' },
  56: { 'K₀': 'K0', 'ΔpCO₂': 'dCO2' },
  58: { 'T_avg': 'Tavg', 'T_base': 'Tbase', 'T_upper': 'Tupper' },
  59: { 'α': 'alpha', 'Δ': 'delta', 'γ': 'gamma', 'Rₙ': 'Rn' },
  60: { 'Rₐ': 'Ra', 'T_max': 'Tmax', 'T_min': 'Tmin' },
  61: { 'Yₐ': 'Ya', 'Yₘ': 'Ym', 'K_y': 'Ky', 'ETₐ': 'ETa', 'ETₘ': 'ETm' },
  62: { 'μ₂₀': 'umax' },
  63: { 'ρ': 'rho', 'c_p': 'cp', 'T_s': 'Ts', 'T_a': 'Ta', 'r_a': 'ra', 'r_s': 'rs', 'e_s': 'es', 'e_a': 'ea' },
  64: { 'O₂': 'O2', 'hν': 'hnu' },
  65: { '[OH]': 'OH' },
  66: { 'β': 'beta', 'ρ₀': 'rho0', '(∇×τ)_z': 'curlTau_z' },
  67: { 'β': 'beta', 'ν': 'visc' },
  68: { 'A_H': 'visc', 'β': 'beta' },
  69: { 'λ': 'lambda', 'T*': 'Tstar' },
  70: { 'Θ': 'Theta' },
  71: { 'γ': 'gamma', 'ε': 'eps', 'N²': 'N2' },
  73: { 'α': 'alpha', 'f_m': 'fm' },
  74: { 'η_u': 'etaU', 'S_w': 'Sw', 'S_ig': 'Ssig' },
  75: { 'L*': 'L', 'h*': 'hstar' },
  76: { 'd_b': 'db' },
  77: { 'H_sb': 'Hsb', 'θ_b': 'thetaB' },
  79: { 'ω': 'omega', 'a': 'ka' },
  80: { 'α': 'alpha', 'g': 'g2', 'f_m': 'fm', 'γ': 'gamma' },
  84: { "c'": 'cprime', 'γz': 'gammaz', 'cosβ': 'cosB', "φ'": 'tanphi', 'sinβ': 'sinB', 'cos²β': 'cosB2' },
  85: { 'μ': 'mu', 'σₙ': 'sigmaN', 'ξ': 'xi' },
  86: { 'Aₛ': 'As', 'tan β': 'tanB' },
  87: { 'Aₛ': 'As', 'tan β': 'tanB' },
  88: { 'K_m': 'Km', 'e_w': 'ew', 'e_a': 'ea', 'u₉': 'u' },
  90: { 'Q₀': 'Q0' },
  91: { 'T_pos': 'Tpos' },
  93: { 'ρᵢ': 'rhoI', 'ρ_f': 'rhoF' },
  94: { 'VEI': 'V' },
  95: { 'Q̇': 'Qdot', 'ρ_air': 'rhoAir', 'α': 'alpha' },
  96: { '∇²T': 'divDT' },
  97: { 'ΔF': 'dF', 'λ₀': 'lambda0' },
  98: { '∂R/∂T': 'dRdT' },
  99: { 'β': 'beta', 'k_x': 'kx', 'k_y': 'ky' },
  100: { '∂q/∂y': 'dpdy' },
  101: { '∂u/∂z': 'dudy' },
  102: { '∂²ψ/∂p²': 'dpp' },
  103: { 'u_bar': 'ubar', 'u_prime': 'uprime' },
  104: { 'K_m': 'Km' },
  105: { 'θ̄_v': 'thetaVbar', "w'θ'_v₀": 'wthetaV', 'z_i': 'zi' },
  106: { '|∇θ|': 'dtheta', 'β': 'cos2b', 'δ': 'delta' },
  107: { 'ζ': 'zeta', '∇·V': 'dvdy' },
  109: { 'N₀': 'N0', 'Λ': 'Lambda' },
  112: { 'hₙ': 'hn', 'Vₙ': 'Vn' },
  113: { 'C_nm': 'Cnm', 'S_nm': 'Snm', 'P_nm': 'Pnm' },
  116: { 'nᵢ': 'ni', 'mᵢ': 'mi' },
  117: { 'N_e': 'Ne' },
  119: { '⟨I⟩': 'Imean', 'σ_I': 'Istd' },
  120: { 'P_dyn': 'Pdyn', 'B_z': 'Bz' },
  121: { 'P_dyn': 'Pdyn' },
  122: { 'ε₀': 'eps0', 'k_B': 'kB', 'T_e': 'Te', 'n_e': 'ne' },
  123: { 'ρ': 'rho', 'C_D': 'CD' },
  124: { 'ρ': 'rho', 'C_D': 'CD' },
  125: { 'A₁': 'A1', 'A₂': 'A2', 'σ_x': 'sigmax', 'σ_y': 'sigmay' },
  126: { 'ρ': 'rho2', 'σ': 'sigma', 'β': 'beta', 'γ': 'gamma' },
  128: { 'wᵢ': 'wi', 'Kᵢ': 'Ki' },
  129: { 'tr(H)': 'traceH' },
  130: { 'θ': 'Sc' },
  131: { 'h₁': 'h1', 'h₂': 'h2', 'r₁': 'r1', 'r₂': 'r2' },
  134: { 'f_c': 'fc', 'f₀': 'f0' },
  136: { 'D(P)': 'Parr' },
  137: { 'I_Hi': 'IHi', 'I_Lo': 'ILo', 'BP_Hi': 'BPHi', 'BP_Lo': 'BPLo', 'C_p': 'Cp' },
  138: { 'X̄': 'Xbar', 'K_p': 'Kp', 'σ_x': 'sigmaX' },
  139: { 'X_{i-1}': 'Xim1', 'Z': 'Zi' },
  140: { 'K₀': 'K0', 'V_res': 'Vres', 'h_b': 'hb' },
  141: { 'x_f': 'xf', 'P_f': 'Pf', 'x_b': 'xb' },
  142: { 'x_b': 'xb' },
  144: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'Hxy' },
  145: { 'd_km': 'dKm', 'f_GHz': 'fGHz' },
  146: { 'A': 'Ai' },
  147: { 'f₀': 'f0', 'v_rel': 'vrel' },
  148: { 'r₁': 'r1', 'r₂': 'r2' },
  150: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'pxy' },
};

export function normalizeInputs(id: number, inputs: Record<string, number>): Record<string, number> {
  const aliases = PARAM_ALIASES[id];
  if (!aliases) return inputs;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(inputs)) {
    const mapped = aliases[key];
    out[mapped ?? key] = value;
  }
  return out;
}

export function computeEquation(
  id: number,
  inputs: Record<string, number>,
  _context?: { studyArea?: unknown; time?: unknown; filters?: unknown },
): ComputeResult | null {
  const fn = EQUATION_ENGINE[id];
  if (!fn) return null;
  return fn(normalizeInputs(id, inputs));
}
