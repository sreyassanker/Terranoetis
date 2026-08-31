/**
 * PART1 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import { C_LIGHT, G_GRAV, H_PLANCK, K_BOLTZMANN, PI, R_SPEC, SIGMA } from '../equationShared';
import type { ComputeFn } from '../equationShared';
import { cb2014Terms } from '../../data/campbellBozorgnia2014';
import { inverseDistanceWeighting } from '../../data/idw';
import { ordinaryKriging, pairDistanceKm, type VariogramModel } from '../../data/kriging';

export const PART1: Record<number, ComputeFn> = {

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
  2: ({ lambda, T }) => {
    const lamM = lambda * 1e-6;
    const hc_over_lkT = (H_PLANCK * C_LIGHT) / (lamM * K_BOLTZMANN * T);
    const e = Math.exp(hc_over_lkT);
    const B = (2 * H_PLANCK * C_LIGHT ** 2) / Math.pow(lamM, 5) * (1 / (e - 1));
    // Wien's displacement law: λ_max = 2898 / T(°K) µm
    const lamMax = 2897.771955 / T;
    // Stefan-Boltzmann: total exitance M = σT⁴
    const M = SIGMA * Math.pow(T, 4);
    // Spectrum series — B_λ(T) over log-spaced wavelengths 0.1 → 100 µm
    // (10 points), evaluated with the tool's own Planck formula and T.
    const spectrumPoints: Array<{ x: number; y: number }> = Array.from({ length: 10 }, (_, i) => {
      const lam = 0.1 * Math.pow(1000, i / 9);
      const lamM = lam * 1e-6;
      const hcOverLkT = (H_PLANCK * C_LIGHT) / (lamM * K_BOLTZMANN * T);
      const expo = Math.exp(hcOverLkT);
      const b = (2 * H_PLANCK * C_LIGHT ** 2) / Math.pow(lamM, 5) * (1 / (expo - 1));
      return { x: lam, y: Number.isFinite(b) ? b : Number.NaN };
    });
    return {
      result: B, unit: 'W·sr⁻¹·m⁻³',
      secondary: [
        { key: 'wien_peak', value: lamMax, unit: 'µm', label: 'Wien Peak Wavelength' },
        { key: 'total_exitance', value: M, unit: 'W/m²', label: 'Total Exitance (Stefan-Boltzmann)' },
      ],
      series: [{
        label: 'Spectral radiance B_λ(T)',
        color: '#D55E00',
        points: spectrumPoints,
      }],
      steps: [
        '── Planck Radiation Law (Planck, 1901) ──',
        `Wavelength λ = ${lambda} µm, Temperature T = ${T} K (${(T - 273.15).toFixed(1)} °C)`,
        '',
        'Step 1 — Convert wavelength to meters:',
        `  λ(m) = ${lambda} × 10⁻⁶ = ${lamM.toExponential(3)} m`,
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
    // Slope of the Magnus–Tetens curve (exact analytic derivative, hPa/°C):
    //   Δ = d e_s / dT = 17.625·243.04·e_s / (T + 243.04)²
    // Same quantity FAO-56 tabulates (converted) for Penman–Monteith.
    const delta = (17.625 * 243.04 * es) / Math.pow(Tc + 243.04, 2);
    // Mixing ratio at saturation (g/kg)
    const ws = 622 * es / (1013.25 - es);
    return {
      result: es, unit: 'hPa',
      secondary: [
        { key: 'slope', value: delta, unit: 'hPa/°C', label: 'Saturation Vapour Slope Δ' },
        { key: 'mixing_ratio', value: ws, unit: 'g/kg', label: 'Saturation Mixing Ratio' },
      ],
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
        `  Slope Δ = de_s/dT = ${delta.toFixed(3)} hPa/°C (used in Penman-Monteith ET₀)`,
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
    // Profile series — P(z) over altitude 0 → 10000 m (21 points) using the
    // tool's isothermal exponential-decay formula with the supplied P0/T.
    const profilePoints: Array<{ x: number; y: number }> = Array.from({ length: 21 }, (_, i) => {
      const zAlt = (10000 * i) / 20;
      return { x: zAlt, y: P0 * Math.exp(-zAlt / H) };
    });
    return {
      result: P, unit: 'hPa',
      secondary: [
        { key: 'scale_height', value: H, unit: 'm', label: 'Scale Height' },
      ],
      series: [{
        label: 'Hydrostatic pressure P(z)',
        color: '#0072B2',
        points: profilePoints,
      }],
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
    // Geostrophic balance breaks down at the equator (f → 0). Return a
    // finite NaN with an explanation instead of ±Infinity.
    const allFinite = [f, rho, dPdx, dPdy].every(Number.isFinite);
    if (!allFinite || Math.abs(f) < 1e-7 || rho <= 0) {
      const eqLine = Math.abs(f) < 1e-7
        ? `Coriolis parameter f = ${Number.isFinite(f) ? f.toExponential(2) : 'NaN'} /s — |f| < 10⁻⁷ s⁻¹`
        : `Non-finite / non-positive input: f=${f}, ρ=${rho}, ∂P/∂x=${dPdx}, ∂P/∂y=${dPdy}`;
      return {
        result: NaN, unit: 'm/s',
        secondary: [
          { key: 'u_g', value: Number.NaN, unit: 'm/s', label: 'Zonal component u_g = −(1/fρ)·∂P/∂y' },
          { key: 'v_g', value: Number.NaN, unit: 'm/s', label: 'Meridional component v_g = (1/fρ)·∂P/∂x' },
          { key: 'wind_direction', value: Number.NaN, unit: '°', label: 'Meteorological wind direction (coming from)' },
          { key: 'coriolis_f', value: Number.isFinite(f) ? f : Number.NaN, unit: 's⁻¹', label: 'Coriolis parameter f' },
        ],
        steps: [
          '── Geostrophic Wind (Holton & Hakim, 2012, Ch. 3) ──',
          eqLine,
          '',
          'Geostrophic balance (f·Vg = (1/ρ)|∇P|) requires |f| well away from',
          'the equator; the Coriolis force vanishes at 0° latitude so the',
          'wind would become infinite, and ρ must be a finite positive density.',
          'Supply a mid-latitude study area, a positive air density, and finite',
          'pressure gradients. Result: NaN (honest — never ±Infinity).',
        ],
      };
    }
    const Vgx = (1 / (f * rho)) * -dPdy;
    const Vgy = (1 / (f * rho)) * dPdx;
    const Vg = Math.hypot(Vgx, Vgy);
    const dirRad = Math.atan2(Vgy, Vgx);
    const dirDeg = ((dirRad * 180 / PI) + 360) % 360;
    // Meteorological wind direction (coming from): 270° - cartesian angle
    const metDir = ((270 - (dirRad * 180 / PI)) + 360) % 360;
    return {
      result: Vg, unit: 'm/s',
      secondary: [
        { key: 'u_g', value: Vgx, unit: 'm/s', label: 'Zonal component u_g = −(1/fρ)·∂P/∂y' },
        { key: 'v_g', value: Vgy, unit: 'm/s', label: 'Meridional component v_g = (1/fρ)·∂P/∂x' },
        { key: 'wind_direction', value: metDir, unit: '°', label: 'Meteorological wind direction (coming from), 0°=N 90°=E' },
        { key: 'coriolis_f', value: f, unit: 's⁻¹', label: 'Coriolis parameter f' },
      ],
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
  6: ({ u, D, C0, t, sigma0 }) => {
    const Pe = (u * u * t) / (4 * D);
    // 3-D Gaussian puff with σ² = σ₀² + 2Dt (σ₀ = initial release scale,
    // from mapInputs, default 50 m). Centreline dilution is the volume ratio
    // (σ₀/σ)³. Limits: C → C₀ as t → 0 or D → 0; C → 0 as t → ∞; dilution
    // is monotonic in BOTH t and D (more time or more diffusion → more
    // dilution). The previous exp(−1/Pe) form grew with time and failed both
    // limits.
    const s0 = sigma0 != null && sigma0 > 0 ? sigma0 : 50;
    const dilution = Math.pow(1 + (2 * D * t) / (s0 * s0), -1.5);
    const C = C0 * dilution;
    const sigma = Math.sqrt(2 * D * t);
    const advDist = u * t;
    return {
      result: C, unit: 'µg/m³',
      secondary: [
        { key: 'peclet', value: Pe, unit: '—', label: 'Péclet Number' },
        { key: 'advection_distance', value: advDist, unit: 'm', label: 'Advection Distance x = u·t' },
        { key: 'diffusion_spread', value: sigma, unit: 'm', label: 'Diffusion Spread σ = √(2Dt)' },
      ],
      steps: [
        '── Advection-Diffusion Equation (Bird, Stewart & Lightfoot, 2007, Ch. 4) ──',
        `Wind speed u = ${u.toFixed(2)} m/s, Eddy diffusivity D = ${D.toFixed(2)} m²/s`,
        `Initial concentration C₀ = ${C0.toFixed(2)} µg/m³, Time t = ${t.toFixed(0)} s (${(t / 3600).toFixed(2)} hr), Release scale σ₀ = ${s0.toFixed(0)} m`,
        '',
        'Step 1 — Compute Péclet number:',
        '  Pe = u²t / (4D) — ratio of advective to diffusive transport',
        `  Pe = ${u.toFixed(2)}² × ${t.toFixed(0)} / (4 × ${D.toFixed(2)}) = ${Pe.toFixed(3)}`,
        `  → ${Pe > 10 ? 'Advection-dominated (narrow plume, far downwind)' : Pe > 1 ? 'Mixed regime (comparable advection & diffusion)' : 'Diffusion-dominated (plume spreads in all directions)'}`,
        '',
        'Step 2 — Compute dilution factor (Gaussian puff, σ² = σ₀² + 2Dt):',
        `  dilution = (1 + 2Dt/σ₀²)^{-3/2} = (1 + ${((2 * D * t) / (s0 * s0)).toFixed(3)})^{-1.5} = ${dilution.toExponential(4)}`,
        '',
        'Step 3 — Compute peak concentration:',
        `  C = C₀ × dilution = ${C0.toFixed(2)} × ${dilution.toExponential(4)}`,
        `  C = ${C.toExponential(4)} µg/m³`,
        '',
        'Step 4 — Plume geometry:',
        `  Advection distance: x = u·t = ${u.toFixed(2)} × ${t.toFixed(0)} = ${advDist.toFixed(0)} m (${(advDist / 1000).toFixed(2)} km)`,
        `  Diffusion spread: σ = √(2Dt) = √(2 × ${D.toFixed(2)} × ${t.toFixed(0)}) = ${sigma.toFixed(1)} m (total puff radius ≈ ${Math.sqrt(s0 * s0 + sigma * sigma).toFixed(0)} m)`,
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
    // Spectrum series — E(k) over log-spaced wavenumbers 0.001 → 1000 (30
    // points) using the tool's −5/3 law with the supplied C and ε.
    const spectrumPoints: Array<{ x: number; y: number }> = Array.from({ length: 30 }, (_, i) => {
      const kw = 0.001 * Math.pow(1e6, i / 29);
      const eVal = C * Math.pow(eps, 2 / 3) * Math.pow(kw, -5 / 3);
      return { x: kw, y: Number.isFinite(eVal) ? eVal : Number.NaN };
    });
    return {
      result: E, unit: 'm³/s²',
      secondary: [
        { key: 'eddy_size', value: L, unit: 'm', label: 'Eddy Size L = 2π/k' },
        { key: 'kolmogorov_microscale', value: eta, unit: 'm', label: 'Kolmogorov Microscale η' },
      ],
      series: [{
        label: 'Turbulent energy spectrum E(k)',
        color: '#0072B2',
        points: spectrumPoints,
      }],
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
    const radFrac = ET0 > 0 ? radTerm / (radTerm + aeroTerm) * 100 : 0;
    const aeroFrac = ET0 > 0 ? aeroTerm / (radTerm + aeroTerm) * 100 : 0;
    return {
      result: ET0, unit: 'mm/day',
      secondary: [
        { key: 'radiation_term', value: Number.isFinite(radTerm) ? radTerm : Number.NaN, unit: 'mm/day', label: 'Radiation Term' },
        { key: 'aerodynamic_term', value: Number.isFinite(aeroTerm) ? aeroTerm : Number.NaN, unit: 'mm/day', label: 'Aerodynamic Term' },
        { key: 'rad_fraction', value: Number.isFinite(radFrac) ? radFrac : Number.NaN, unit: '%', label: 'Radiation Contribution' },
        { key: 'aero_fraction', value: Number.isFinite(aeroFrac) ? aeroFrac : Number.NaN, unit: '%', label: 'Aerodynamic Contribution' },
      ],
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
    if (!Number.isFinite(P) || !Number.isFinite(Ia) || !Number.isFinite(S)) {
      return {
        result: Number.NaN, unit: 'mm',
        steps: [
          '── SCS Curve Number (USDA SCS, 1954) ──',
          'Precipitation P, initial abstraction Iₐ, or potential retention S is missing (NaN).',
          'No fabricated substitution — supply all three inputs.',
        ],
      };
    }
    const excess = P - Ia;
    const Q = excess > 0 ? Math.max(0, Math.pow(excess, 2) / (excess + S)) : 0;
    const CN = S > 0 ? 25400 / (S + 254) : 100;
    const runoffRatio = P > 0 ? Q / P : 0;
    const iaRatio = S > 0 ? Ia / S : 0;
    return {
      result: Q, unit: 'mm',
      secondary: [
        { key: 'cn', value: Number.isFinite(CN) ? CN : Number.NaN, unit: '—', label: 'Curve Number' },
        { key: 'runoff_ratio', value: Number.isFinite(runoffRatio) ? runoffRatio : Number.NaN, unit: '—', label: 'Runoff Ratio (Q/P)' },
        { key: 'initial_abstraction_ratio', value: Number.isFinite(iaRatio) ? iaRatio : Number.NaN, unit: '—', label: 'Initial Abstraction Ratio (Iₐ/S)' },
      ],
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
    // Muskingum storage (McCarthy 1938 / Chow 1964): S = K[X·I + (1−X)·O],
    // X = weighting on INFLOW (typical 0–0.3). The previous code had the
    // weights transposed — (1−X)·I + X·O — contradicting its own step text.
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Kn = Number(K), Xn = Number(X), ItN = Number(It), OtN = Number(Ot);
    if (![Kn, Xn, ItN, OtN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm³/s·h',
        steps: [
          '── Muskingum Routing (McCarthy, 1938) ──',
          'S = K × [X·I_t + (1−X)·O_t]',
          '',
          'Inflow I_t / outflow O_t require genuine streamflow. No USGS station',
          'was found near the study point (or inputs are non-finite), so no',
          'fabricated discharge is substituted. Supply K, X, I_t, O_t explicitly',
          'or select a point near a USGS gauge.',
        ],
        secondary: [
          { key: 'outflow_next', value: Number.NaN, unit: 'm³/s', label: 'Outflow Next Time Step O(t+1)' },
          { key: 'coeff_c0', value: Number.NaN, unit: '—', label: 'Routing coefficient C₀' },
          { key: 'coeff_c1', value: Number.NaN, unit: '—', label: 'Routing coefficient C₁' },
          { key: 'coeff_c2', value: Number.NaN, unit: '—', label: 'Routing coefficient C₂' },
        ],
      };
    }
    const weightedStorage = Xn * ItN + (1 - Xn) * OtN;
    const S = Kn * weightedStorage;
    const coeffCheck = Kn * (1 - Xn);
    // Muskingum routing coefficients (Δt = K/2 default, stable: Δt ≤ K(1−X)):
    //   C₀ = (−KX + 0.5Δt)/(K(1−X) + 0.5Δt), C₁ = (KX + 0.5Δt)/den,
    //   C₂ = (K(1−X) − 0.5Δt)/den,  C₀+C₁+C₂ = 1.
    const dt = Kn / 2;
    const den = Kn * (1 - Xn) + 0.5 * dt;
    const c0 = (-Kn * Xn + 0.5 * dt) / den;
    const c1 = (Kn * Xn + 0.5 * dt) / den;
    const c2 = (Kn * (1 - Xn) - 0.5 * dt) / den;
    const outNext = c0 * ItN + c1 * ItN + c2 * OtN;
    // Routed outflow hydrograph over a model-time horizon: O(t+1) = c0·I(t+1)
    // + c1·I(t) + c2·O(t) with the inflow held at ItN (genuine model curve).
    const seriesPoints: Array<{ x: number; y: number }> = [];
    let oPrev = OtN;
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const o = i === 0 ? OtN : c0 * ItN + c1 * ItN + c2 * oPrev;
      oPrev = o;
      if (Number.isFinite(o)) seriesPoints.push({ x: i * dt, y: o });
    }
    return {
      result: S, unit: 'm³/s·h',
      secondary: [
        { key: 'outflow_next', value: Number.isFinite(outNext) ? outNext : Number.NaN, unit: 'm³/s', label: 'Outflow Next Time Step O(t+1)' },
        { key: 'coeff_c0', value: Number.isFinite(c0) ? c0 : Number.NaN, unit: '—', label: 'Routing coefficient C₀' },
        { key: 'coeff_c1', value: Number.isFinite(c1) ? c1 : Number.NaN, unit: '—', label: 'Routing coefficient C₁' },
        { key: 'coeff_c2', value: Number.isFinite(c2) ? c2 : Number.NaN, unit: '—', label: 'Routing coefficient C₂' },
      ],
      series: seriesPoints.length > 0
        ? [{
            label: 'Routed outflow O(t)',
            color: '#0072B2',
            points: seriesPoints,
          }]
        : undefined,
      steps: [
        '── Muskingum Routing (McCarthy, 1938) ──',
        `Storage constant K = ${Kn.toFixed(2)} h, Weighting factor X = ${Xn.toFixed(3)}`,
        `Inflow I_t = ${ItN.toFixed(1)} m³/s, Outflow O_t = ${OtN.toFixed(1)} m³/s`,
        '',
        'Step 1 — Weighted storage:',
        `  X·I_t + (1−X)·O_t = ${Xn.toFixed(3)}×${ItN.toFixed(1)} + (1−${Xn.toFixed(3)})×${OtN.toFixed(1)}`,
        `  = ${Xn * ItN} + ${((1 - Xn) * OtN)} = ${weightedStorage.toFixed(2)}`,
        '',
        'Step 2 — Reach storage:',
        `  S = K × [X·I_t + (1−X)·O_t] = ${Kn.toFixed(2)} × ${weightedStorage.toFixed(2)}`,
        `  S = ${S.toFixed(2)} m³/s·h`,
        '',
        'Step 3 — Routing coefficients (Δt = K/2):',
        `  C₀ = (−KX + 0.5Δt)/D = ${c0.toFixed(4)}`,
        `  C₁ = (KX + 0.5Δt)/D   = ${c1.toFixed(4)}`,
        `  C₂ = (K(1−X) − 0.5Δt)/D = ${c2.toFixed(4)}`,
        `  C₀ + C₁ + C₂ = ${(c0 + c1 + c2).toFixed(4)} (mass conservation)`,
        '',
        'Step 4 — Outflow next step:',
        `  O(t+1) = C₀·I(t+1) + C₁·I(t) + C₂·O(t) = ${outNext.toFixed(2)} m³/s`,
        '',
        'Step 5 — Stability check:',
        `  K×X = ${(Kn * Xn).toFixed(3)},  K×(1−X) = ${coeffCheck.toFixed(3)}`,
        `  ${coeffCheck > 0 ? '✓ Routing coefficient positive (stable)' : '⚠ Check: negative routing coefficient possible'}`,
        '',
        `  └ Interpretation: ${Xn < 0.1 ? 'Near-reservoir storage — strong attenuation' : Xn < 0.3 ? 'Typical natural channel storage' : 'Near-translation — weak attenuation, wave moves through reach with minimal peak reduction'}`
      ]
    };
  },
  14: ({ H0, amps, __officialHeight, __schuremanHeight, __tideStation }) => {
    const ampArr: number[] = Array.isArray(amps) ? amps.filter((a: unknown) => typeof a === 'number' && Number.isFinite(a)) : [];
    if (!Number.isFinite(H0) && ampArr.length === 0) {
      return {
        result: NaN, unit: 'm',
        steps: [
          '── Tidal Harmonic Analysis (Pugh & Woodworth, 2014) ──',
          '',
          'No genuine tidal constituents or datum could be resolved for this',
          'location (no NOAA tide-prediction station within range, or the',
          'CO-OPS API was unreachable). Provide an explicit H₀ and constituent',
          'amplitudes, or choose a coastal study area.',
        ],
      };
    }
    const sumTerms = ampArr.reduce((s: number, a: number) => s + a, 0);
    const sumAbsAmps = ampArr.reduce((s: number, a: number) => s + Math.abs(a), 0);
    const H0v = Number.isFinite(H0) ? H0 : 0;
    const h = H0v + sumTerms;
    const nConstituents = ampArr.length;
    const official = typeof __officialHeight === 'number' && Number.isFinite(__officialHeight) ? __officialHeight : null;
    const station = typeof __tideStation === 'string' ? __tideStation : null;
    const steps = [
      '── Tidal Harmonic Analysis (Pugh & Woodworth, 2014; Schureman, 1958) ──',
      `h(t) = H₀ + Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ)`,
      '',
      `Station: ${station ?? 'not resolved (constituents user-supplied)'}`,
      `Datum constant H₀ (MTL − MLLW) = ${Number.isFinite(H0) ? H0.toFixed(3) + ' m' : 'not available'}`,
      `Number of constituents: ${nConstituents} (each term pre-evaluated with node factor f, equilibrium argument V₀, nodal phase u)`,
      '',
      'Step 1 — Constituent summation (Schureman-corrected terms):',
      `  Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ) = ${sumTerms.toFixed(3)} m`,
      '',
      'Step 2 — Tidal elevation (datum MLLW):',
      `  h(t) = H₀ + Σ… = ${H0v.toFixed(3)} + (${sumTerms.toFixed(3)}) = ${h.toFixed(3)} m`,
    ];
    if (official != null) {
      const diff = h - official;
      steps.push(
        '',
        'Step 3 — Cross-validation vs official NOAA CO-OPS prediction:',
        `  Official (${station}) = ${official.toFixed(3)} m`,
        `  Schureman (this) = ${h.toFixed(3)} m, |Δ| = ${Math.abs(diff).toFixed(3)} m`
      );
    }
    const range = 2 * sumAbsAmps;
    steps.push(
      '',
      `Step ${official != null ? 4 : 3} — Tidal classification:`,
      `  Tidal range ≈ 2·Σ|Aᵢ| = ${range.toFixed(2)} m (approximate, constituents only)`,
      '',
      `  └ Interpretation: ${range < 2 ? 'Microtidal regime (< 2 m)' : range < 4 ? 'Mesotidal regime (2–4 m)' : 'Macrotidal regime (> 4 m)'}${official != null ? ' | height above MLLW datum' : ''}`
    );
    return {
      result: h, unit: 'm',
      secondary: [
        { key: 'tidal_range', value: Number.isFinite(range) ? range : Number.NaN, unit: 'm', label: 'Tidal Range (2·Σ|Aᵢ|)' },
        { key: 'constituent_count', value: Number.isFinite(nConstituents) ? nConstituents : Number.NaN, unit: '—', label: 'Constituent Count' },
        { key: 'datum_offset', value: Number.isFinite(H0v) ? H0v : Number.NaN, unit: 'm', label: 'Datum Offset (H₀)' },
      ],
      steps,
    };
  },
  15: ({ tau, rho, A, f, vTheta: _vTheta }) => {
    if (!Number.isFinite(f) || Math.abs(f) < 1e-7) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Ekman Spiral (Ekman, 1905) ──',
          `Coriolis parameter f = ${f} /s — near zero`,
          '',
          'Ekman surface drift V₀ = τ/√(ρfAᵥ) diverges as f → 0 (equator):',
          'the spiral thickness depends on the Coriolis force, so the steady',
          'Ekman solution is not defined at ~0° latitude. Provide a',
          'non-equatorial study area or an explicit f.',
        ],
      };
    }
    const rhoFAv = rho * Math.abs(f) * A;
    const V0 = tau / Math.sqrt(rhoFAv);
    const De = Math.PI * Math.sqrt(2 * A / Math.abs(f));
    const Ue = tau / (rho * Math.abs(f));
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
    if (!Number.isFinite(f) || Math.abs(f) < 1e-7) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Geostrophic Current (Gill, 1982) ──',
          `Coriolis parameter f = ${f} /s — near zero`,
          '',
          'Geostrophic balance requires the Coriolis force (f·v = (1/ρ)∂p/∂x);',
          'at ~0° latitude f → 0 and the velocity diverges. Supply a',
          'non-equatorial study area or an explicit f.',
        ],
      };
    }
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
  17: ({ Qs, Qb, Qh, Qe, H }) => {
    const has = [Qs, Qb, Qh, Qe].every(Number.isFinite);
    if (!has) {
      return {
        result: NaN, unit: 'W/m²',
        steps: [
          '── Ocean Surface Heat Budget (Gill, 1982, Ch. 3) ──',
          'Q_net = Q_s − Q_b − Q_h − Q_e',
          '',
          'Authentic ERA5 surface energy fluxes are unavailable for this',
          'run (CDS API unreachable or flux request failed). Per the audit',
          'no-fallback rule no static flux constants are substituted.',
          'Provide explicit Qs, Qb, Qh, Qe (W/m²) or run with a working',
          'CDS_API_TOKEN so the genuine ERA5 fluxes can be fetched.',
        ],
      };
    }
    const Qnet = Qs - Qb - Qh - Qe;
    const rho_w = 1025, cp_w = 3990;
    const Hm = Number.isFinite(H) && H > 0 ? H : 50; // Gill mixed-layer slab (m)
    const sstTend = Qnet / (rho_w * cp_w * Hm) * 86400; // °C/day
    const Lv = 2.5e6, rho_w2 = 1000;
    const evapRate = Qe / (rho_w2 * Lv) * 86400 * 1000; // mm/day
    return {
      result: Qnet, unit: 'W/m²',
      secondary: [
        { key: 'sst_tendency', value: Number.isFinite(sstTend) ? sstTend : Number.NaN, unit: '°C/day', label: 'SST Tendency' },
        { key: 'evaporation_rate', value: Number.isFinite(evapRate) ? evapRate : Number.NaN, unit: 'mm/day', label: 'Evaporation Rate' },
      ],
      steps: [
        '── Ocean Surface Heat Budget (Gill, 1982, Ch. 3) ──',
        `Shortwave Q_s = ${Qs.toFixed(1)} W/m², Longwave Q_b = ${Qb.toFixed(1)} W/m² (net upward)`,
        `Sensible Q_h = ${Qh.toFixed(1)} W/m², Latent Q_e = ${Qe.toFixed(1)} W/m² (ocean losses)`,
        '',
        'Step 1 — Net heat flux (positive = ocean gain):',
        `  Q_net = Q_s − Q_b − Q_h − Q_e`,
        `  Q_net = ${Qs.toFixed(1)} − ${Qb.toFixed(1)} − ${Qh.toFixed(1)} − ${Qe.toFixed(1)}`,
        `  Q_net = ${Qnet.toFixed(2)} W/m²`,
        '',
        `Step 2 — SST tendency (mixed layer H=${Hm} m, ρ=1025 kg/m³, c_p=3990 J/kg/K):`,
        `  dSST/dt = Q_net/(ρc_pH) = ${Qnet.toFixed(2)} / (${rho_w} × ${cp_w} × ${Hm})`,
        `  dSST/dt = ${sstTend.toFixed(3)} °C/day`,
        '',
        'Step 3 — Evaporation rate from latent heat:',
        `  E = Q_e/(ρL_v) = ${Qe.toFixed(1)} / (${rho_w2} × ${Lv.toExponential(1)})`,
        `  E = ${evapRate.toFixed(2)} mm/day`,
        '',
        `  └ Interpretation: ${Qnet > 100 ? 'Strong ocean heat gain — rapid SST warming' : Qnet > 0 ? 'Moderate ocean heat gain — SST slowly rising' : Qnet > -100 ? 'Moderate ocean heat loss — SST slowly cooling' : 'Strong ocean heat loss — rapid SST cooling, convective mixing'}`
      ]
    };
  },
  18: ({ Ks, psiW, psi0, dTheta, Ft }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const KsN = Number(Ks), psiWN = Number(psiW), psi0N = Number(psi0), dThetaN = Number(dTheta), FtN = Number(Ft);
    const psiFN = psiWN - psi0N;
    if (!Number.isFinite(KsN) || !Number.isFinite(dThetaN) || !Number.isFinite(FtN)) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
          'f = K_s × (1 + ψ_f·Δθ/F)',
          '',
          'Authentic parameters could not be derived for this run. The tool',
          'needs a genuine ISRIC SoilGrids soil pixel at the location for the',
          'USDA texture class (→ Rawls 1983 / Mays 2005 Table 7.7.2 values for',
          'K_s and ψ_f), plus an initial moisture or cumulative infiltration',
          'depth (GLDAS 0–10 cm moisture, IMERG storm total, or explicit Ft).',
          'No fabricated defaults are substituted.',
          'Provide the study area or explicit Ks/psiW/dTheta/Ft to compute.',
        ],
        secondary: [
          { key: 'wetting_front_depth', value: Number.NaN, unit: 'm', label: 'Wetting Front Depth (F/Δθ)' },
          { key: 'suction_head', value: Number.NaN, unit: 'm', label: 'Effective Suction Head ψ_f' },
          { key: 'ratio', value: Number.NaN, unit: '—', label: 'f/K_s' },
        ],
      };
    }
    if (FtN <= 0 || KsN <= 0 || dThetaN <= 0) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
          'f = K_s × (1 + ψ_f·Δθ/F)',
          '',
          `Invalid inputs: F(t)=${FtN}, K_s=${KsN}, Δθ=${dThetaN}.`,
          'F(t) (cumulative infiltration) must be > 0, K_s > 0, and Δθ > 0.',
          'Cannot compute a finite infiltration rate.',
        ],
        secondary: [
          { key: 'wetting_front_depth', value: Number.NaN, unit: 'm', label: 'Wetting Front Depth (F/Δθ)' },
          { key: 'suction_head', value: Number.NaN, unit: 'm', label: 'Effective Suction Head ψ_f' },
          { key: 'ratio', value: Number.NaN, unit: '—', label: 'f/K_s' },
        ],
      };
    }
    const f = KsN * (1 + psiFN * dThetaN / FtN);
    const L = FtN / dThetaN; // wetting front depth
    return {
      result: f, unit: 'm/s',
      secondary: [
        { key: 'wetting_front_depth', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Wetting Front Depth (F/Δθ)' },
        { key: 'suction_head', value: Number.isFinite(psiFN) ? psiFN : Number.NaN, unit: 'm', label: 'Effective Suction Head ψ_f' },
        { key: 'ratio', value: Number.isFinite(f / KsN) ? f / KsN : Number.NaN, unit: '—', label: 'f/K_s' },
      ],
      steps: [
        '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
        `K_s = ${KsN.toExponential(3)} m/s, ψ_w = ${psiWN.toFixed(2)} m, ψ₀ = ${psi0N.toFixed(2)} m`,
        `Δθ = ${dThetaN.toFixed(3)}, F(t) = ${FtN.toFixed(3)} m`,
        '',
        'Step 1 — Effective suction head:',
        `  ψ_f = ψ_w − ψ₀ = ${psiWN.toFixed(2)} − ${psi0N.toFixed(2)} = ${psiFN.toFixed(2)} m`,
        '',
        'Step 2 — Capillary term:',
        `  ψ_f·Δθ/F = ${psiFN.toFixed(2)} × ${dThetaN.toFixed(3)} / ${FtN.toFixed(3)}`,
        `  = ${(psiFN * dThetaN / FtN).toFixed(3)}`,
        '',
        'Step 3 — Infiltration rate:',
        `  f = K_s × (1 + ψ_f·Δθ/F) = ${KsN.toExponential(3)} × (1 + ${(psiFN * dThetaN / FtN).toFixed(3)})`,
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
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return {
        result: NaN, unit: 'events/yr',
        steps: [
          '── Gutenberg-Richter Law (Gutenberg & Richter, 1944) ──',
          'log₁₀(N) = a − b·M',
          '',
          'No genuine catalog fit is available for this run: the USGS FDSN',
          'query returned no events for the requested window/area (or the',
          'catalog was unreachable), so neither a nor b can be derived.',
          'No fabricated a/b constants are substituted.',
          'Provide explicit a and b, or a location/window with seismicity.',
        ],
      };
    }
    const logN = a - b * M;
    const n = Math.pow(10, logN);
    const T_r = n > 0 ? 1 / n : Infinity;
    const P10 = n > 0 ? 1 - Math.exp(-10 * n) : 0;
    // Bar series — N(M) over magnitude 4 → 9 in 0.5 steps (11 points) using
    // the tool's Gutenberg-Richter relation with the supplied a and b.
    const barPoints: Array<{ x: number; y: number }> = Array.from({ length: 11 }, (_, i) => {
      const mag = 4 + i * 0.5;
      const logN = a - b * mag;
      return { x: mag, y: Number.isFinite(logN) ? Math.pow(10, logN) : Number.NaN };
    });
    return {
      result: n, unit: 'events/yr',
      secondary: [
        { key: 'return_period', value: Number.isFinite(T_r) ? T_r : Number.NaN, unit: 'yr', label: 'Return Period (1/N)' },
      ],
      series: [{
        label: 'Annual frequency N(M)',
        color: '#0072B2',
        points: barPoints,
      }],
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
    if (!Number.isFinite(K) || !Number.isFinite(c) || !Number.isFinite(p) || K <= 0 || c <= 0 || p <= 0) {
      return {
        result: NaN, unit: 'events/day',
        steps: [
          '── Modified Omori Law (Omori, 1894; Utsu, 1961) ──',
          'n(t) = K / (c + t)^p',
          '',
          'No genuine aftershock sequence is available for this run: the USGS',
          'FDSN query returned no usable sequence (or the catalog was',
          'unreachable), so K, c and p cannot be fitted (Ogata 1983 MLE).',
          'No fabricated K/c/p constants are substituted.',
          'Provide explicit K, c, t, p, or a location with an active sequence.',
        ],
      };
    }
    if (t < 0) {
      return {
        result: NaN, unit: 'events/day',
        steps: ['── Modified Omori Law ──', `Invalid elapsed time t=${t}; must be ≥ 0. Cannot compute a decay rate.`],
      };
    }
    const den = Math.pow(c + t, p);
    const n = den > 0 ? K / den : 0;
    const halfLife = c * (Math.pow(2, 1 / p) - 1);
    const cum = Math.abs(p - 1) > 1e-10
      ? K * (Math.pow(c, 1 - p) - Math.pow(c + t, 1 - p)) / (p - 1)
      : K * Math.log(1 + t / c);
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 1; day <= 60; day++) {
      const denom = Math.pow(c + day, p);
      seriesPoints.push({ x: day, y: Number.isFinite(denom) ? K / denom : Number.NaN });
    }
    return {
      result: n, unit: 'events/day',
      secondary: [
        { key: 'cumulative', value: Number.isFinite(cum) ? cum : Number.NaN, unit: 'events', label: 'Cumulative Aftershocks N_cum' },
        { key: 'half_life', value: Number.isFinite(halfLife) ? halfLife : Number.NaN, unit: 'days', label: 'Rate Halving Time t_½' },
      ],
      series: [{
        label: 'Aftershock rate n(t)',
        color: '#0072B2',
        points: seriesPoints,
      }],
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
  21: ({ mag, rrup, rjb, rx, vs30, rake, dip, ztor, width, hypoDepth }) => {
    const req = { mag, rrup, rjb, vs30, rake, dip, ztor, width, hypoDepth };
    for (const [k, v] of Object.entries(req)) {
      if (!Number.isFinite(v)) {
        return {
          result: NaN, unit: 'g',
          steps: [
            '── Campbell–Bozorgnia (2014) NGA-West2 GMPE ──',
            'ln(PGA) = f_mag + f_att + f_flt + f_hng + f_site + f_basin',
            '          + f_dip + f_hyp + f_atten',
            '',
            `Parameter '${k}' is missing. The genuine CB2014 GMPE needs the full`,
            'physical rupture/site input (M, Rrup, Rjb, Rx, Vs30, rake, dip,',
            'ZTOR, width, hypocentral depth). No fabricated substitution.',
          ],
        };
      }
    }
    const T = cb2014Terms({ mag, rrup, rjb, rx, vs30, rake, dip, ztor, width, hypoDepth });
    const pgaG = T.pga;
    const pgaCm = pgaG * 980.665;
    const mmi = pgaG > 0 ? (pgaG < 0.001 ? 1 : 2 * Math.log10(pgaG * 980.665) + 3.5) : 1;
    const lnPGA = Math.log(pgaG);
    const pgaRock = T.pga1100;
    return {
      result: pgaG, unit: 'g',
      secondary: [
        { key: 'mmi', value: Number.isFinite(mmi) ? mmi : Number.NaN, unit: '—', label: 'Modified Mercalli Intensity' },
        { key: 'pga_cm', value: Number.isFinite(pgaCm) ? pgaCm : Number.NaN, unit: 'cm/s²', label: 'PGA (cm/s²)' },
        { key: 'ln_pga', value: Number.isFinite(lnPGA) ? lnPGA : Number.NaN, unit: '—', label: 'ln(PGA)' },
        { key: 'pga_rock', value: Number.isFinite(pgaRock) ? pgaRock : Number.NaN, unit: 'g', label: 'PGA on Rock (Vs=1100)' },
      ],
      steps: [
        '── Campbell–Bozorgnia (2014) NGA-West2 GMPE ──',
        `M = ${mag.toFixed(1)}, Rrup = ${rrup.toFixed(1)} km, Rjb = ${rjb.toFixed(1)} km, Rx = ${rx.toFixed(1)} km`,
        `Vs30 = ${vs30.toFixed(0)} m/s, rake = ${rake.toFixed(0)}°, dip = ${dip.toFixed(0)}°, ZTOR = ${ztor.toFixed(1)} km,`,
        `width = ${width.toFixed(1)} km, hypo-depth = ${hypoDepth.toFixed(1)} km`,
        '',
        'Functional terms (eqs. 2-25 of C&B 2014):',
        `  f_mag (magnitude scaling)      = ${T.fMag.toFixed(4)}`,
        `  f_att (geometric attenuation)  = ${T.fAtt.toFixed(4)}`,
        `  f_flt (style-of-faulting)      = ${T.fFault.toFixed(4)}`,
        `  f_hng (hanging wall)           = ${T.fHNG.toFixed(4)}`,
        `  f_site (nonlinear, Vs30)       = ${T.fSite.toFixed(4)}`,
        `  f_basin (z2.5 from Vs30)       = ${T.fBasin.toFixed(4)}`,
        `  f_dip (fault dip)              = ${T.fDip.toFixed(4)}`,
        `  f_hyp (hypocentral depth)      = ${T.fHyp.toFixed(4)}`,
        `  f_atten (anelastic, Rrup≥80)   = ${T.fAtten.toFixed(4)}`,
        '',
        `  PGA on reference rock (Vs=1100): ${T.pga1100.toFixed(4)} g`,
        `  ln(PGA) = ${T.lnPGA.toFixed(4)}  →  PGA = ${pgaG.toFixed(4)} g = ${(pgaG * 980.665).toFixed(1)} cm/s²`,
        '',
        'Step 3 — MMI intensity proxy:',
        `  Estimated MMI ≈ ${mmi.toFixed(1)} (${mmi < 4 ? 'Light shaking, rarely damaging' : mmi < 6 ? 'Moderate shaking, potential damage to vulnerable structures' : mmi < 8 ? 'Strong shaking, damaging to ordinary buildings' : 'Very strong shaking, widespread damage'})`,
        '',
        `  └ PGA < 0.05 g: weak (MMI ≤ IV); 0.05–0.15 g: moderate (V–VI); 0.15–0.40 g: strong (VII–VIII); >0.40 g: very strong (IX+)`,
      ],
    };
  },
  22: ({ c, sigmaN, tanPhi }) => {
    if (!Number.isFinite(c) || !Number.isFinite(sigmaN) || !Number.isFinite(tanPhi)) {
      return {
        result: NaN, unit: 'kPa',
        steps: [
          '── Mohr–Coulomb Failure Criterion (Coulomb, 1776; Mohr, 1900) ──',
          'τ = c + σₙ·tanφ',
          '',
          'One or more of c / σₙ / tanφ is unavailable: no genuine soil data',
          '(ISRIC SoilGrids texture + bulk density) was retrievable for this',
          'location, so shear-strength parameters cannot be derived.',
          'No fabricated cohesion or friction constants are substituted.',
        ],
      };
    }
    if (sigmaN < 0 || c < 0 || tanPhi < 0) {
      return {
        result: NaN, unit: 'kPa',
        steps: ['── Mohr–Coulomb Failure Criterion ──', `Non-physical inputs (c=${c}, σₙ=${sigmaN}, tanφ=${tanPhi} all require ≥ 0).`],
      };
    }
    const tau = c + sigmaN * tanPhi;
    const phiDeg = Math.atan(tanPhi) * 180 / Math.PI;
    const tanSq = tanPhi * tanPhi;
    const sinPhi = tanPhi / Math.sqrt(1 + tanSq);
    const cosPhi = 1 / Math.sqrt(1 + tanSq);
    const secPhi = 1 / cosPhi;
    // Exact Mohr-circle pole geometry for the stress state on the failure
    // plane with shear τ and normal stress σₙ: the circle centred at
    // (σc, 0) is tangent to the M–C envelope at (σₙ, τ).
    const sigma1 = sigmaN + tau * (tanPhi + secPhi);
    const sigma3 = sigmaN + tau * (tanPhi - secPhi);
    const kp = (1 + sinPhi) / (1 - sinPhi); // Rankine passive earth pressure coefficient
    return {
      result: tau, unit: 'kPa',
      secondary: [
        { key: 'friction_angle', value: Number.isFinite(phiDeg) ? phiDeg : Number.NaN, unit: '°', label: 'Friction Angle φ' },
      ],
      steps: [
        '── Mohr-Coulomb Failure Criterion (Coulomb, 1776; Mohr, 1900) ──',
        `Material: cohesion c = ${c.toFixed(2)} kPa, normal stress σₙ = ${sigmaN.toFixed(3)} kPa`,
        `Friction coefficient tan φ = ${tanPhi.toFixed(4)} (φ = ${phiDeg.toFixed(1)}°)`,
        '',
        'Step 1 — Compute shear strength:',
        `  τ = c + σₙ·tan φ = ${c.toFixed(2)} + ${sigmaN.toFixed(3)} × ${tanPhi.toFixed(4)}`,
        `  τ = ${tau.toFixed(2)} kPa`,
        '',
        'Step 2 — Mohr circle at failure (exact tangency geometry):',
        `  σ₁ = σₙ + τ(tanφ + secφ) = ${sigmaN.toFixed(3)} + ${tau.toFixed(2)} × (${tanPhi.toFixed(4)} + ${secPhi.toFixed(4)}) = ${sigma1.toFixed(2)} kPa`,
        `  σ₃ = σₙ + τ(tanφ − secφ) = ${sigmaN.toFixed(3)} + ${tau.toFixed(2)} × (${tanPhi.toFixed(4)} − ${secPhi.toFixed(4)}) = ${sigma3.toFixed(2)} kPa`,
        `  (circle centred at ${((sigma1 + sigma3) / 2).toFixed(2)} kPa, radius ${((sigma1 - sigma3) / 2).toFixed(2)} kPa, tangent to the envelope)`,
        '',
        'Step 3 — Derived parameters:',
        `  Active earth pressure coefficient K_a = (1−sinφ)/(1+sinφ) = ${(1 / kp).toFixed(3)}`,
        `  Passive earth pressure coefficient K_p = ${kp.toFixed(3)}`,
        `  Failure plane angle: θ_f = 45° + φ/2 = ${(45 + phiDeg / 2).toFixed(1)}° from σ₁ direction`,
        '',
        `  └ Interpretation: ${tau > 100 ? 'High shear strength — intact rock or dense granular soil' : tau > 30 ? 'Moderate strength — typical soil/rock joint' : 'Low strength — soft soil or shallow/low-confinement condition'}`,
        `  └ Effective stress: if pore pressure u is known, σ′ₙ = σₙ − u (Terzaghi principle)`
      ]
    };
  },
  23: ({ M0 }) => {
    if (!Number.isFinite(M0) || M0 <= 0) {
      return {
        result: NaN, unit: 'M_w',
        steps: [
          '── Hanks-Kanamori Moment Magnitude (Hanks & Kanamori, 1979) ──',
          'M_w = (2/3)·log₁₀(M₀) − 10.7  (M₀ in dyne·cm; = (2/3)·log₁₀(M₀) − 6.033 in N·m)',
          '',
          'No genuine seismic moment is available: no USGS moment tensor and',
          'no catalog magnitude exist for this region (or the catalog was',
          'unreachable). No fabricated M₀ is substituted.',
        ],
      };
    }
    const logM0 = Math.log10(M0);
    // Hanks & Kanamori (1979) eq. 15: M_w = (2/3) log10 M0 − 10.7 (dyne·cm).
    // M₀ here is in N·m: 1 N·m = 10⁷ dyne·cm ⇒ −10.7 + (2/3)·7 = −6.0333.
    const Mw = (2 / 3) * (logM0 + 7) - 10.7;
    const A_km2 = Math.pow(10, Mw - 4); // empirical: log₁₀(A_km²) ≈ M_w − 4 (Δσ≈3 MPa)
    const D = M0 / (3e10 * (A_km2 * 1e6)); // slip: M₀ = μ·A·D, μ = 3×10¹⁰ Pa
    const logEs = 1.5 * Mw + 4.8; // Gutenberg-Richter energy relation (J)
    const Es = Math.pow(10, logEs);
    return {
      result: Mw, unit: 'M_w',
      steps: [
        '── Hanks-Kanamori Moment Magnitude (Hanks & Kanamori, 1979) ──',
        `Seismic moment M₀ = ${M0.toExponential(3)} N·m = ${Math.pow(10, logM0 + 7).toExponential(3)} dyne·cm`,
        '',
        'Step 1 — Convert to dyne·cm and log-transform:',
        `  log₁₀(M₀ / dyne·cm) = log₁₀(M₀) + 7 = ${logM0.toFixed(4)} + 7 = ${(logM0 + 7).toFixed(4)}`,
        '',
        'Step 2 — Compute M_w (Hanks & Kanamori 1979, eq. 15):',
        `  M_w = (2/3)·log₁₀(M₀) − 10.7 = (2/3)×${(logM0 + 7).toFixed(4)} − 10.7`,
        `  M_w = ${Mw.toFixed(2)}`,
        '',
        'Step 3 — Derived rupture/source estimates:',
        `  Rupture area: A ≈ 10^(M_w−4) = ${A_km2.toFixed(0)} km² (${(A_km2 * 1e6).toExponential(3)} m²)`,
        `  Avg. slip: D ≈ M₀/(μ·A) = ${D.toFixed(2)} m (μ ≈ 3×10¹⁰ Pa)`,
        `  Seismic energy: E_s ≈ 10^(1.5·M_w+4.8) = ${Es.toExponential(3)} J (Gutenberg-Richter)`,
        '',
        `  └ Magnitude class: ${Mw < 4 ? 'Micro earthquake' : Mw < 5 ? 'Light earthquake' : Mw < 6 ? 'Moderate earthquake' : Mw < 7 ? 'Strong earthquake' : Mw < 8 ? 'Major earthquake' : 'Great earthquake'}`,
        `  └ Energy equivalent: ${(Es / 4.184e9).toFixed(1)} tonnes TNT`
      ]
    };
  },
  24: ({ M0, r }) => {
    if (!Number.isFinite(M0) || !Number.isFinite(r) || M0 <= 0 || r <= 0) {
      return {
        result: NaN, unit: 'Pa',
        steps: [
          '── Brune Stress Drop Model (Brune, 1970) ──',
          'Δσ = (7/16) · M₀/r³',
          '',
          'No genuine source parameters are available: neither a USGS scalar',
          'seismic moment nor a catalog magnitude (to derive the source',
          'radius) exists for this region. No fabricated M₀ or r is',
          'substituted.',
        ],
      };
    }
    const dsig = (7 / 16) * (M0 / Math.pow(r, 3));
    const dsig_MPa = dsig / 1e6;
    const beta = 3500; // shear wave velocity (m/s)
    const fc = 0.49 * beta / r;
    const mu = 3e10; // shear modulus (Pa)
    // Average slip for a circular crack: M₀ = μ·πr²·D and M₀ = (16/7)Δσ·r³
    // ⇒ D = (16/7π)·Δσ·r/μ = M₀/(μ·π·r²).
    const D = M0 / (mu * Math.PI * r * r);
    return {
      result: dsig, unit: 'Pa',
      secondary: [
        { key: 'stress_drop_mpa', value: Number.isFinite(dsig_MPa) ? dsig_MPa : Number.NaN, unit: 'MPa', label: 'Stress Drop (MPa)' },
      ],
      steps: [
        '── Brune Stress Drop Model (Brune, 1970) ──',
        `Seismic moment M₀ = ${M0.toExponential(3)} N·m, Source radius r = ${r.toFixed(0)} m`,
        '',
        'Step 1 — Compute static stress drop:',
        `  Δσ = (7/16) × M₀/r³ = (7/16) × ${M0.toExponential(3)} / (${r.toFixed(0)})³`,
        `  Δσ = ${dsig.toExponential(3)} Pa = ${dsig_MPa.toFixed(3)} MPa`,
        '',
        'Step 2 — Corner frequency:',
        `  f_c = 0.49·β/r = 0.49 × ${beta} / ${r.toFixed(0)} = ${fc.toFixed(3)} Hz`,
        '',
        'Step 3 — Average slip (M₀ = μ·π·r²·D):',
        `  D = M₀/(μ·π·r²) = (16/7π)·Δσ·r/μ = ${D.toFixed(3)} m`,
        '',
        `  └ Stress class: ${dsig_MPa < 0.1 ? 'Low stress drop — slow/tsunami earthquake' : dsig_MPa < 1 ? 'Moderate-to-low stress drop' : dsig_MPa < 10 ? 'Typical crustal earthquake (1–10 MPa)' : 'High stress drop — strong high-frequency shaking'}`,
        `  └ Self-similarity: Δσ ≈ constant across M₀ (Kanamori & Anderson 1975)`,
      ]
    };
  },
  25: ({ Mw }) => {
    if (!Number.isFinite(Mw) || Mw <= 0) {
      return {
        result: NaN, unit: 'km²',
        steps: [
          '── Wells-Coppersmith Rupture Scaling (Wells & Coppersmith, 1994) ──',
          'log₁₀(A) = −3.49 + 0.91·M_w',
          '',
          'No genuine magnitude is available for this region: the USGS',
          'catalog returned no events in the time window. No fabricated',
          'M_w is substituted for the scaling relations.',
        ],
      };
    }
    const logA = -3.49 + 0.91 * Mw;
    const A = Math.pow(10, logA);
    const logSRL = -3.55 + 0.74 * Mw; // surface rupture length (strike-slip)
    const SRL = Math.pow(10, logSRL);
    const logAD = -4.80 + 0.69 * Mw; // average displacement (all types)
    const AD = Math.pow(10, logAD);
    const width = Math.sqrt(A); // approximate: sqrt(A) for ~square rupture
    // Scatter series — surface rupture length vs M_w over M 5 → 8 (10 points)
    // using the tool's Wells-Coppersmith regression.
    const scatterPoints: Array<{ x: number; y: number }> = Array.from({ length: 10 }, (_, i) => {
      const mw = 5 + (i * 3) / 9;
      return { x: mw, y: Math.pow(10, -3.55 + 0.74 * mw) };
    });
    return {
      result: A, unit: 'km²',
      secondary: [
        { key: 'surface_rupture_length', value: Number.isFinite(SRL) ? SRL : Number.NaN, unit: 'km', label: 'Surface Rupture Length (strike-slip)' },
      ],
      series: [{
        label: 'Surface Rupture Length vs M_w',
        color: '#0072B2',
        points: scatterPoints,
      }],
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
        'Step 3 — Average displacement (all fault types):',
        `  log₁₀(AD) = −4.80 + 0.69 × ${Mw.toFixed(1)} = ${logAD.toFixed(4)}`,
        `  AD = ${AD.toFixed(2)} m`,
        '',
        'Step 4 — Rupture aspect ratio:',
        `  Approx. width = √Area = ${width.toFixed(1)} km (depends on seismogenic thickness ~15±5 km)`,
        `  Aspect ratio L/W = ${(SRL / Math.max(width, 0.1)).toFixed(1)}`,
        '',
        `  └ Rupture class: ${A < 100 ? 'Small fault rupture (Mw < 6)' : A < 1000 ? 'Moderate fault rupture (Mw 6–7)' : A < 10000 ? 'Large fault rupture (Mw 7–8)' : 'Very large fault rupture (Mw > 8, subduction zone)'}`,
        `  └ σ(log₁₀A) = 0.24 log units — ±1σ spans a factor of ~1.7 in area`
      ]
    };
  },

  // ── Domain 4: Remote Sensing & Cryosphere ──
  26: ({ NIR, Red }) => {
    if (!Number.isFinite(NIR) || !Number.isFinite(Red) || NIR + Red <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Normalized Difference Vegetation Index (Rouse et al., 1974) ──',
          'NDVI = (NIR − Red) / (NIR + Red)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Rouse (1974) requires actual measured bands.',
        ],
      };
    }
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
    if (!Number.isFinite(Green) || !Number.isFinite(NIR) || Green + NIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── McFeeters NDWI (McFeeters, 1996) ──',
          'NDWI = (Green − NIR) / (Green + NIR)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — McFeeters (1996) requires actual measured bands.',
        ],
      };
    }
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
    if (!Number.isFinite(NIR) || !Number.isFinite(SWIR) || NIR + SWIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Gao NDWI — Vegetation Water Content (Gao, 1996) ──',
          'NDWI = (NIR − SWIR) / (NIR + SWIR)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Gao (1996) requires actual measured bands.',
        ],
      };
    }
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
    if (!Number.isFinite(NIR) || !Number.isFinite(Red) || !Number.isFinite(Blue)) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Enhanced Vegetation Index (Huete et al., 2002) ──',
          'EVI = 2.5·(NIR − Red) / (NIR + 6·Red − 7.5·Blue + 1)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Huete (2002) requires actual measured bands.',
        ],
      };
    }
    const denom = NIR + 6 * Red - 7.5 * Blue + 1;
    if (denom <= 0) {
      return { result: NaN, unit: '—', steps: ['EVI denominator non-positive — non-physical reflectance combination.'] };
    }
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
    if (!Number.isFinite(Green) || !Number.isFinite(SWIR) || Green + SWIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Normalized Difference Snow Index (Hall et al., 1995) ──',
          'NDSI = (Green − SWIR) / (Green + SWIR)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Hall (1995) requires actual measured bands.',
        ],
      };
    }
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
  31: ({ NIR, SWIR, NIR_pre, SWIR_pre }) => {
    if (!Number.isFinite(NIR) || !Number.isFinite(SWIR) || NIR + SWIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Normalized Burn Ratio (Key & Benson, 1999) ──',
          'NBR = (NIR − SWIR2) / (NIR + SWIR2)',
          '',
          'No genuine post-fire surface reflectance is available: no',
          'cloud-free Landsat C2 L2 SR scene was found for this',
          'location/date (and no user-supplied bands). Proxy reflectance',
          'is not substituted.',
        ],
      };
    }
    const nbr = (NIR - SWIR) / (NIR + SWIR);
    const havePre = Number.isFinite(NIR_pre) && Number.isFinite(SWIR_pre) && NIR_pre + SWIR_pre > 0;
    const nbrPre = havePre ? (NIR_pre - SWIR_pre) / (NIR_pre + SWIR_pre) : Number.NaN;
    const dNBR = havePre ? nbrPre - nbr : Number.NaN;
    let severity: string;
    if (!havePre) severity = 'INDETERMINATE — requires genuine pre-fire scene';
    else if (dNBR > 0.66) severity = 'VERY HIGH SEVERITY';
    else if (dNBR > 0.44) severity = 'HIGH SEVERITY';
    else if (dNBR > 0.27) severity = 'MODERATE SEVERITY';
    else if (dNBR > 0.1) severity = 'LOW SEVERITY';
    else severity = 'UNBURNED';
    return {
      result: nbr, unit: '—',
      steps: [
        '── Normalized Burn Ratio (Key & Benson, 1999) ──',
        `Post-fire surface reflectance: NIR = ${NIR.toFixed(3)}, SWIR2 = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute post-fire NBR:',
        `  NBR_post = (NIR − SWIR2) / (NIR + SWIR2) = (${NIR.toFixed(3)} − ${SWIR.toFixed(3)}) / (${NIR.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NBR_post = ${nbr.toFixed(4)}`,
        '',
        havePre ?
          `Step 2 — Pre-fire NBR from supplied pre-fire scene (NIR=${NIR_pre.toFixed(3)}, SWIR2=${SWIR_pre.toFixed(3)}):` :
          'Step 2 — Pre-fire NBR:',
        havePre ?
          `  NBR_pre = (${NIR_pre.toFixed(3)} − ${SWIR_pre.toFixed(3)}) / (${NIR_pre.toFixed(3)} + ${SWIR_pre.toFixed(3)}) = ${nbrPre.toFixed(4)}` :
          '  NBR_pre = NaN — no genuine pre-fire scene supplied; a simulated',
        havePre ? '' : '  pre-fire image would be fabrication (Key & Benson require real pre/post scenes).',
        '',
        'Step 3 — Differenced NBR:',
        havePre ?
          `  dNBR = NBR_pre − NBR_post = ${nbrPre.toFixed(4)} − ${nbr.toFixed(4)} = ${dNBR.toFixed(4)}` :
          '  dNBR = NaN (pre-fire image unavailable — cannot classify severity).',
        '',
        'Step 4 — Burn severity classification (MTBS):',
        `  Severity: ${severity}${havePre ? ` (dNBR = ${dNBR.toFixed(3)})` : ''}`,
        '',
        `  └ dNBR thresholds: <0.1 unburned, 0.1–0.27 low, 0.27–0.44 moderate, 0.44–0.66 high, >0.66 very high (MTBS standard)`,
      ]
    };
  },
  32: ({ A, eps, Tfire, Tbg, firmsFrpTotalW, firmsFrpMaxMW, __firmsDetection, __firmsCount }) => {
    const hasFirms = typeof firmsFrpTotalW === 'number' && Number.isFinite(firmsFrpTotalW) && firmsFrpTotalW > 0;
    const firmsCount = typeof __firmsCount === 'number' ? __firmsCount : 0;
    // Mode A — genuine measured FRP available: the operational Wooster (2005)
    // MIR-radiance FRP distributed by NASA FIRMS IS the Giglio (2006) product;
    // its per-pixel sum within the search region is the genuine FRP.
    const userDozier =
      (typeof Tfire === 'number' && Number.isFinite(Tfire) && Number.isFinite(A) && Number.isFinite(Tbg))
      ? A * eps * SIGMA * (Math.pow(Tfire, 4) - Math.pow(Tbg, 4))
      : Number.NaN;

    if (!hasFirms && !Number.isFinite(userDozier)) {
      return {
        result: NaN, unit: 'W',
        steps: [
          '── Fire Radiative Power (Giglio et al., 2006) ──',
          'Operational FRP: Wooster (2005) MIR-radiance method (per-pixel product)',
          'Definition: FRP = A·ε·σ·(T_fire⁴ − T_bg⁴) (true sub-pixel T_fire required)',
          '',
          'No genuine NASA FIRMS active-fire detection exists within the',
          `search radius${firmsCount > 0 ? '' : ' (0 detections)'}, and no user-supplied`,
          'fire temperature / background temperature was provided.',
          'No fire temperature or FRP is fabricated.',
        ],
      };
    }

    if (hasFirms && !Number.isFinite(userDozier)) {
      const frpMW = (firmsFrpTotalW as number) / 1e6;
      const steps = [
        '── Fire Radiative Power (Giglio et al., 2006) ──',
        ...(typeof __firmsDetection === 'string' ? [`${__firmsDetection}`, ''] : []),
        'Step 1 — Genuine measured FRP (NASA FIRMS, Wooster 2005 method):',
        `  Total measured FRP (all ${firmsCount} fire pixel(s)): ${frpMW.toFixed(1)} MW`,
        `  Max single-pixel measured FRP: ${(firmsFrpMaxMW as number ?? Number.NaN).toFixed(1)} MW`,
        '',
        'Step 2 — Giglio (2006) definition (sub-pixel fire temperature T_f):',
        '  FRP = A·ε·σ·(T_f⁴ − T_bg⁴)',
        '  FIRMS does not deliver the true sub-pixel fire temperature — its',
        `  bright_ti4 is the mixed-pixel MIR brightness (${Number.isFinite(Tfire as number) ? (Tfire as number).toFixed(0) : '–'} K at this pixel),`,
        '  so substituting it into the full-pixel Dozier form is not a valid',
        '  estimate. The measured per-pixel product is reported instead.',
        '',
        'Step 3 — Interpretation:',
        `  ${frpMW < 5 * firmsCount ? 'Small/smoldering fire(s)' : frpMW < 50 * firmsCount ? 'Moderate savanna/grassland fire(s)' : frpMW < 500 * firmsCount ? 'Large fire activity' : 'Extreme fire activity (pyroCb potential)'}`,
        `  Combustion rate est.: ~${(frpMW / 200).toFixed(2)} kg/s (≈4500 kJ/g energy yield)`,
      ];
      return { result: firmsFrpTotalW as number, unit: 'W', steps };
    }

    if (Number.isFinite(userDozier)) {
      // User supplied genuine fire/background temperatures (e.g. field
      // measurements or thermal imaging): evaluate the Giglio/Dozier
      // definition exactly.
      const Tf4 = Math.pow(Tfire as number, 4);
      const Tbg4 = Math.pow(Tbg as number, 4);
      const FRP = userDozier;
      const FRP_MW = FRP / 1e6;
      const TfireC = (Tfire as number) - 273.15;
      return {
        result: FRP, unit: 'W',
        steps: [
          '── Fire Radiative Power (Giglio et al., 2006) ──',
          ...(typeof __firmsDetection === 'string' ? [`${__firmsDetection}`, ''] : []),
          `Pixel area A = ${(A as number).toFixed(0)} m², Emissivity ε = ${(eps as number).toFixed(2)}`,
          `Fire temperature T_fire = ${(Tfire as number).toFixed(0)} K (${TfireC.toFixed(0)} °C)`,
          `Background T_bg = ${(Tbg as number).toFixed(0)} K`,
          '',
          'Step 1 — Stefan-Boltzmann radiance:',
          `  T_fire⁴ = (${(Tfire as number).toFixed(0)})⁴ = ${Tf4.toExponential(3)} K⁴`,
          `  T_bg⁴ = (${(Tbg as number).toFixed(0)})⁴ = ${Tbg4.toExponential(3)} K⁴`,
          '',
          'Step 2 — Compute FRP (Giglio/Dozier):',
          `  FRP = A·ε·σ·(T_f⁴ − T_bg⁴) = ${(A as number).toFixed(0)} × ${(eps as number).toFixed(2)} × ${SIGMA.toExponential(3)} × ${(Tf4 - Tbg4).toExponential(3)}`,
          `  FRP = ${FRP.toExponential(3)} W = ${FRP_MW.toFixed(1)} MW`,
          ...(hasFirms ? ['', `  Cross-check: FIRMS measured FRP = ${(firmsFrpTotalW as number / 1e6).toFixed(1)} MW (${firmsCount} pixel(s))`] : []),
          '',
          'Step 3 — Fire classification:',
          `  ${FRP_MW < 5 ? 'Small/smoldering fire' : FRP_MW < 50 ? 'Moderate savanna/grassland fire' : FRP_MW < 500 ? 'Large forest fire' : 'Extreme fire (pyroCb potential)'}`,
          `  Combustion rate est.: ~${(FRP_MW / 200).toFixed(2)} kg/s (≈4500 kJ/g energy yield)`,
        ]
      };
    }

    return {
      result: NaN, unit: 'W',
      steps: ['FRP cannot be computed: neither a genuine FIRMS detection nor complete user-supplied temperatures are available.'],
    };
  },
  33: ({ Tc, Twet, Tdry }) => {
    if (!Number.isFinite(Tc) || !Number.isFinite(Twet) || !Number.isFinite(Tdry)) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Crop Water Stress Index (Idso et al., 1981) ──',
          'CWSI = (T_c − T_wet) / (T_dry − T_wet)',
          '',
          'One or more baseline temperatures are unavailable:',
          `  T_c = ${Tc}, T_wet = ${Twet}, T_dry = ${Tdry}`,
          '',
          'T_c is the genuine Landsat C2 L2 surface temperature; T_wet is',
          'derived as the wet-bulb temperature (Stull 2011) from genuine',
          'air temperature + RH; but the dry baseline T_dry (non-',
          'transpiring canopy) has no global remote-sensed source and must',
          'be supplied by the user (field measurement or energy-balance',
          'model). No synthetic baseline is substituted.',
        ],
      };
    }
    if (Tdry - Twet <= 0) {
      return { result: NaN, unit: '—', steps: ['CWSI: dry baseline must exceed wet baseline (non-physical inputs).'] };
    }
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
    if (!Number.isFinite(DDF) || !Number.isFinite(Tair) || !Number.isFinite(Tbase)) {
      return {
        result: NaN, unit: 'mm/day',
        steps: [
          '── Degree-Day Snowmelt Model (Hock, 2003) ──',
          'M = DDF × max(0, T_air − T_base)',
          '',
          'The degree-day factor DDF is a site-calibrated parameter with',
          'no global remote-sensed source (Hock 2003: snow 2–5, firn 5–7,',
          'clean ice 7–10, dirty ice 10–15 mm/°C·day). Supply a DDF',
          `calibrated for the site (current: DDF=${DDF}, T_air=${Tair}, T_base=${Tbase}).`,
          'No default factor is substituted — melt cannot be estimated',
          'without it.',
        ],
      };
    }
    const Texcess = Math.max(0, Tair - Tbase);
    const M = DDF * Texcess;
    const cumMelt = M * 10;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    let cum = 0;
    for (let day = 1; day <= 30; day++) {
      cum += M;
      seriesPoints.push({ x: day, y: Number.isFinite(cum) ? cum : Number.NaN });
    }
    let meltClass: string;
    if (M < 5) meltClass = 'Low melt rate';
    else if (M < 15) meltClass = 'Moderate melt';
    else if (M < 30) meltClass = 'Rapid melt — significant runoff';
    else meltClass = 'Extreme melt — rain-on-snow or foghn event possible';
    return {
      result: M, unit: 'mm/day',
      secondary: [
        { key: 'cumulative_melt', value: Number.isFinite(cumMelt) ? cumMelt : Number.NaN, unit: 'mm', label: 'Cumulative Melt (10 days)' },
      ],
      series: [{
        label: 'Cumulative snowmelt',
        color: '#0072B2',
        points: seriesPoints,
      }],
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
    if (!Number.isFinite(C) || !Number.isFinite(Twater) || !Number.isFinite(Tice)) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Passive Microwave Sea Ice Concentration (Comiso, 1986) ──',
          'T_B = (1 − C)·T_water + C·T_ice',
          '',
          'One or more inputs are unavailable:',
          `  C = ${C}, T_water = ${Twater}, T_ice = ${Tice}`,
          '',
          'C (ice concentration) is taken GENUINELY from NSIDC NRT CDR V4',
          '(AMSR2). T_water / T_ice are tie-point brightness temperatures',
          'that depend on sensor, frequency and polarization — they must',
          'be supplied (no single default radiative temperature is',
          'physically defensible, and none is substituted).',
        ],
      };
    }
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
      secondary: [
        { key: 'brightness_kelvin', value: Number.isFinite(tbKelvin) ? tbKelvin : Number.NaN, unit: 'K', label: 'Brightness Temperature (K)' },
      ],
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
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'km',
        secondary: [
          { key: 'bearing', value: Number.NaN, unit: '°', label: 'Initial bearing (NaN)' },
          { key: 'midLat', value: Number.NaN, unit: '°', label: 'Great-circle midpoint latitude (NaN)' },
          { key: 'midLon', value: Number.NaN, unit: '°', label: 'Great-circle midpoint longitude (NaN)' },
        ],
        steps: [
          '── Haversine Formula (Sinnott, 1984) ──',
          'One or both endpoint coordinates are missing / non-finite. '
          + 'Provide two points (lat₁, lon₁) and (lat₂, lon₂), or draw a '
          + 'two-point study area — the great-circle distance is undefined otherwise.',
        ]
      };
    }
    const R = 6371000; // Sinnott (1984): mean Earth radius 6371 km
    const phi1 = lat1 * PI / 180, phi2 = lat2 * PI / 180;
    const dphi = (lat2 - lat1) * PI / 180;
    const dl = (lon2 - lon1) * PI / 180;
    const sinDphi2 = Math.sin(dphi / 2);
    const sinDl2 = Math.sin(dl / 2);
    const a = Math.max(0, Math.min(1, sinDphi2 ** 2 + Math.cos(phi1) * Math.cos(phi2) * sinDl2 ** 2));
    const c = 2 * Math.asin(Math.sqrt(a));
    const d = R * c;
    // Initial bearing
    const y = Math.sin(dl) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
    const bearing = (Math.atan2(y, x) * 180 / PI + 360) % 360;
    // Great-circle midpoint (half-way along the great-circle path)
    const Bx = Math.cos(phi2) * Math.cos(dl);
    const By = Math.cos(phi2) * Math.sin(dl);
    const midLat = Math.atan2(Math.sin(phi1) + Math.sin(phi2),
      Math.sqrt((Math.cos(phi1) + Bx) ** 2 + By ** 2)) * 180 / PI;
    const midLon = (lon1 + Math.atan2(By, Math.cos(phi1) + Bx) * 180 / PI + 540) % 360 - 180;
    const dLatPerDeg = 111.32; // km/° near equator
    const dLonPerDeg = 111.32 * Math.cos((lat1 + lat2) / 2 * PI / 180);
    return {
      result: d / 1000, unit: 'km',
      secondary: [
        { key: 'bearing', value: Number.isFinite(bearing) ? bearing : Number.NaN, unit: '°', label: 'Initial bearing (degrees clockwise from north)' },
        { key: 'midLat', value: Number.isFinite(midLat) ? midLat : Number.NaN, unit: '°', label: 'Great-circle midpoint latitude' },
        { key: 'midLon', value: Number.isFinite(midLon) ? midLon : Number.NaN, unit: '°', label: 'Great-circle midpoint longitude' },
      ],
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
        `  Midpoint: (${midLat.toFixed(4)}°, ${midLon.toFixed(4)}°)`,
        `  1° latitude ≈ ${dLatPerDeg.toFixed(2)} km, 1° longitude ≈ ${dLonPerDeg.toFixed(2)} km at mean latitude`,
        '',
        `  └ Distance class: ${d < 1000 ? 'Very short (< 1 km)' : d < 10000 ? 'Local (< 10 km)' : d < 100000 ? 'Regional (< 100 km)' : d < 1000000 ? 'Sub-continental (< 1000 km)' : 'Continental/global (> 1000 km)'}`,
      ]
    };
  },
  37: ({ obs, tlat, tlon, fitted, unit }) => {
    const observations = (Array.isArray(obs) ? obs as Array<{ lat: number; lon: number; value: number; siteName?: string }> : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), value: Number(o.value), siteName: typeof o.siteName === 'string' ? o.siteName : undefined }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.value));
    const fitModel = fitted && {
      nugget: Number.isFinite(Number(fitted.nugget)) ? Number(fitted.nugget) : 0,
      sill: Number.isFinite(Number(fitted.sill)) ? Number(fitted.sill) : NaN,
      range: Number.isFinite(Number(fitted.range)) && Number(fitted.range) > 0 ? Number(fitted.range) : 1,
      model: fitted.model,
    };
    const outUnit = typeof unit === 'string' && unit ? unit : '—';
    const nanSecondary = [
      { key: 'variance', value: Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Kriging variance (NaN)' },
      { key: 'sd', value: Number.NaN, unit: outUnit, label: 'Kriging standard deviation (NaN)' },
      { key: 'weightsSum', value: Number.NaN, unit: '—', label: 'Sum of kriging weights (NaN)' },
    ];
    if (!observations.length || !Number.isFinite(tlat) || !Number.isFinite(tlon) || !fitModel || !Number.isFinite(fitModel.sill) || !(fitModel.sill > 0)) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Ordinary Kriging (Matheron, 1963) ──',
          `Genuine observations available: ${observations.length}`,
          '',
          'Honest NaN: ordinary kriging requires ≥ 2 real spatial observations '
          + 'plus a fitted semivariogram (sill > 0). The study area returned '
          + 'too few reported stations to build the kriging system — no values '
          + 'are fabricated.',
        ]
      };
    }
    const kr = ordinaryKriging(observations, { lat: tlat, lon: tlon }, fitModel as VariogramModel);
    if (!kr) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Ordinary Kriging (Matheron, 1963) ──',
          `${observations.length} observations loaded`,
          'Honest NaN: the kriging linear system is singular (degenerate '
          + 'configuration — coincident points or zero-variance field) and '
          + 'cannot be solved without regularization.',
        ]
      };
    }
    const { yhat, variance, weights, phi, fitted: fit, nObs } = kr;
    const sd = Math.sqrt(variance);
    const wTop = weights.map((w, i) => ({ w, v: observations[i].value, lat: observations[i].lat, lon: observations[i].lon }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 4);
    return {
      result: yhat, unit: outUnit,
      secondary: [
        { key: 'variance', value: Number.isFinite(variance) ? variance : Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Kriging variance (prediction uncertainty σ²_K)' },
        { key: 'sd', value: Number.isFinite(sd) ? sd : Number.NaN, unit: outUnit, label: 'Kriging standard deviation σ_K' },
        { key: 'weightsSum', value: Number.isFinite(weights.reduce((s, w) => s + w, 0)) ? weights.reduce((s, w) => s + w, 0) : Number.NaN, unit: '—', label: 'Sum of kriging weights (unbiasedness)' },
      ],
      steps: [
        '── Ordinary Kriging (Matheron, 1963) ──',
        `${nObs} genuine observations | target (${tlat.toFixed(3)}, ${tlon.toFixed(3)}) | model: ${fit.model}`,
        '',
        'Step 1 — Fitted semivariogram model:',
        `  γ̂(h) fitted by weighted least squares: ${fit.model}`,
        `  Nugget c₀ = ${fit.nugget.toExponential(3)}, sill = ${fit.sill.toExponential(3)}, range a = ${fit.range.toFixed(2)} km`,
        '',
        'Step 2 — Kriging system solved (partial pivoting Gaussian elimination):',
        `  A·λ = b, Σλᵢ = 1 enforced by Lagrange row (φ = ${phi.toExponential(3)})`,
        `  Dominant weights: ${wTop.map((w) => `λ=${w.w.toFixed(3)} @(${w.lat.toFixed(2)},${w.lon.toFixed(2)}) z=${w.v.toFixed(2)}`).join(', ')}`,
        '',
        'Step 3 — Best Linear Unbiased Prediction:',
        `  ŷ(s₀) = Σλᵢ·z(sᵢ) = ${yhat.toFixed(4)}`,
        '',
        'Step 4 — Kriging variance (prediction uncertainty):',
        `  σ²_K = Σλᵢ·γ(sᵢ−s₀) + φ = ${variance.toExponential(3)}`,
        `  σ_K = ${sd.toFixed(4)}`,
        '',
        `  └ 95% CI: [${(yhat - 1.96 * sd).toFixed(3)}, ${(yhat + 1.96 * sd).toFixed(3)}]`,
        `  └ Weights sum to ${weights.reduce((s, w) => s + w, 0).toFixed(4)} (unbiasedness), kriging variance depends on geometry+variogram, not on z values`,
      ]
    };
  },
  38: ({ obs, tlat, tlon, p, unit }) => {
    const observations = (Array.isArray(obs) ? obs as Array<{ lat: number; lon: number; value: number; siteName?: string }> : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), value: Number(o.value), siteName: typeof o.siteName === 'string' ? o.siteName : undefined }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.value));
    const power = Number.isFinite(p) && p >= 0.5 && p <= 4 ? p : 2;
    const outUnit = typeof unit === 'string' && unit ? unit : '—';
    const nanSecondary = [
      { key: 'nearestKm', value: Number.NaN, unit: 'km', label: 'Distance to nearest observation (NaN)' },
      { key: 'topWeight', value: Number.NaN, unit: '—', label: 'Dominant normalized weight (NaN)' },
    ];
    if (!observations.length || !Number.isFinite(tlat) || !Number.isFinite(tlon)) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Inverse Distance Weighting (Shepard, 1968) ──',
          `Genuine observations available: ${observations.length}`,
          '',
          'Honest NaN: IDW requires at least one real observation in the '
          + 'study area. The station network returned no reporting sites '
          + 'here — no values are fabricated.',
        ]
      };
    }
    const idw = inverseDistanceWeighting(observations, { lat: tlat, lon: tlon }, power);
    if (!idw) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Inverse Distance Weighting (Shepard, 1968) ──',
          `${observations.length} observations loaded`,
          'Honest NaN: degenerate configuration (non-finite distances).',
        ]
      };
    }
    const { yhat, weights, distancesKm, exactAt, nObs } = idw;
    const top = weights.map((w, i) => ({ w, d: distancesKm[i], v: observations[i].value }))
      .map((x, i) => ({ ...x, i })).sort((a, b) => b.w - a.w).slice(0, 4);
    return {
      result: yhat, unit: outUnit,
      secondary: [
        { key: 'nearestKm', value: Number.isFinite(Math.min(...distancesKm)) ? Math.min(...distancesKm) : Number.NaN, unit: 'km', label: 'Distance to nearest observation' },
        { key: 'topWeight', value: Number.isFinite(Math.max(...weights)) ? Math.max(...weights) : Number.NaN, unit: '—', label: 'Dominant normalized weight' },
      ],
      steps: [
        '── Inverse Distance Weighting (Shepard, 1968) ──',
        `${nObs} genuine observations | target (${tlat.toFixed(3)}, ${tlon.toFixed(3)}) | power p = ${power}`,
        '',
        'Step 1 — Distances (haversine, km) and weights:',
        `  wᵢ = 1/dᵢ${power === 2 ? '²' : '^' + power}${exactAt != null ? ` — target coincides with station #${exactAt} (d < 1 m): exact interpolator snap` : ''}`,
        `  Dominant: ${top.map((x) => `w=${x.w.toFixed(3)} d=${x.d.toFixed(1)} km z=${x.v.toFixed(2)}`).join(', ')}`,
        '',
        'Step 2 — Weighted average:',
        `  ŷ = Σ(wᵢ·zᵢ)/Σwᵢ = ${yhat.toFixed(4)}`,
        '',
        'Step 3 — Locality assessment:',
        `  ${top[0].w > 0.5 ? `Close neighbor dominates (${(top[0].w * 100).toFixed(0)} % of weight) — bullseye behaviour per Shepard` : 'Weight distributed across several stations'}`,
        '',
        `  └ IDW is exact at data points and continuous (C⁰), but not differentiable at samples`,
        `  └ No prediction variance (deterministic interpolator — use kriging, Tool 37, for uncertainty)`,
      ]
    };
  },
  39: ({ Q, u, sigmaY, sigmaZ, y, z, H }) => {
    // Pasquill & Smith (1983) Gaussian point-source plume, ground level z:
    // C = Q/(2π·u·σy·σz) · exp(−y²/2σy²) · [exp(−(z−H)²/2σz²) + exp(−(z+H)²/2σz²)]
    const denom = 2 * PI * u * sigmaY * sigmaZ;
    const expY = Math.exp(-(y * y) / (2 * sigmaY * sigmaY));
    const expZ1 = Math.exp(-((z - H) * (z - H)) / (2 * sigmaZ * sigmaZ));
    const expZ2 = Math.exp(-((z + H) * (z + H)) / (2 * sigmaZ * sigmaZ));
    const vert = expZ1 + expZ2;   // ground + (implicit inversion lid) reflection
    const C = (Q / denom) * expY * vert;
    const C_centerline = (Q / denom) * vert; // y = 0
    let stabilityClass: string;
    if (sigmaZ < 10) stabilityClass = 'STABLE (F) — poor vertical dispersion';
    else if (sigmaZ < 30) stabilityClass = 'SLIGHTLY UNSTABLE (C/D) — moderate dispersion';
    else if (sigmaZ < 70) stabilityClass = 'UNSTABLE (B) — good dispersion';
    else stabilityClass = 'VERY UNSTABLE (A) — rapid dispersion';
    return {
      result: C, unit: 'µg/m³',
      secondary: [
        { key: 'centerline', value: Number.isFinite(C_centerline) ? C_centerline : Number.NaN, unit: 'µg/m³', label: 'Centerline Concentration (y=0)' },
      ],
      steps: [
        '── Gaussian Plume Model (Pasquill & Smith, 1983) ──',
        `Source rate Q = ${Q.toExponential(3)} µg/s, Wind speed u = ${u.toFixed(2)} m/s`,
        `Dispersion: σ_y = ${sigmaY.toFixed(1)} m, σ_z = ${sigmaZ.toFixed(1)} m`,
        `Crosswind y = ${y.toFixed(1)} m | receptor height z = ${z.toFixed(1)} m | effective stack height H = ${H.toFixed(1)} m`,
        '',
        'Step 1 — Compute denominator:',
        `  2π·u·σ_y·σ_z = 2π × ${u.toFixed(2)} × ${sigmaY.toFixed(1)} × ${sigmaZ.toFixed(1)} = ${denom.toFixed(1)}`,
        '',
        'Step 2 — Crosswind exponential:',
        `  exp(−y²/(2σ_y²)) = exp(−(${y.toFixed(1)})² / (2×${sigmaY.toFixed(1)}²)) = ${expY.toExponential(4)}`,
        '',
        'Step 3 — Vertical reflection terms (Pasquill & Smith Eq., ground at z):',
        `  exp(−(z−H)²/(2σ_z²)) = exp(−(${(z - H).toFixed(1)})² / (2×${sigmaZ.toFixed(1)}²)) = ${expZ1.toExponential(4)}`,
        `  exp(−(z+H)²/(2σ_z²)) = exp(−(${(z + H).toFixed(1)})² / (2×${sigmaZ.toFixed(1)}²)) = ${expZ2.toExponential(4)}`,
        `  Vertical factor = ${expZ1.toExponential(3)} + ${expZ2.toExponential(3)} = ${vert.toExponential(4)}`,
        '',
        'Step 4 — Concentration:',
        `  C(x,y,z) = (${Q.toExponential(3)} / ${denom.toFixed(1)}) × ${expY.toExponential(4)} × ${vert.toExponential(4)}`,
        `  C = ${C.toExponential(4)} µg/m³`,
        '',
        'Step 5 — Reference values:',
        `  Stability class: ${stabilityClass}`,
        `  Centerline (y=0) concentration: ${C_centerline.toExponential(4)} µg/m³`,
        '',
        `  └ Plume half-width at y = ±${sigmaY.toFixed(1)} m contains ~68% of mass`,
        `  └ Maximum ground-level occurs downwind where σ_z = H/√2 (elevated releases)`,
      ]
    };
  },
   40: ({ mu, beta, x, T }) => {
     if (![mu, beta].every(Number.isFinite) || !(beta > 0)) {
       return {
         result: Number.NaN, unit: '—',
         secondary: [
           { key: 'returnPeriod', value: Number.NaN, unit: 'years', label: 'Return period T = 1/(1−F) (NaN)' },
           { key: 'reducedVariate', value: Number.NaN, unit: '—', label: 'Gumbel reduced variate y (NaN)' },
           { key: 'xReturn100', value: Number.NaN, unit: '—', label: '100-year return level (NaN)' },
         ],
         steps: [
           '── Gumbel (Type I) Extreme Value Distribution (Gumbel, 1958) ──',
           'Honest NaN: Gumbel requires a finite location μ, a finite scale '
           + 'β > 0 and a finite value x — no value is fabricated.',
         ]
       };
     }
     // When a return period T is supplied (e.g. "100 year flood"), the primary
     // result is the T-year return LEVEL x_T = μ − β·ln(−ln(1−1/T)) — the
     // discharge equalled/exceeded once every T years on average. Without T,
     // fall back to the CDF F(x) of the supplied value x (Gumbel 1958).
     const hasT = Number.isFinite(T) && T > 1;
     const isQuantile = hasT && !Number.isFinite(x);
     const xEff = isQuantile ? mu - beta * Math.log(-Math.log(1 - 1 / T)) : x;
     const y = hasT ? (xEff - mu) / beta : (x - mu) / beta;
     const F = hasT ? 1 - 1 / T : Math.exp(-Math.exp(-y));
     const T_out = hasT ? T : 1 / (1 - F + 1e-30);
     const reducedVariate = -Math.log(-Math.log(F));
     const xReturn100 = mu - beta * Math.log(-Math.log(1 - 1 / 100));
     // Distribution series — Gumbel PDF f(x) over x ∈ [μ−3β, μ+3β] (40 points)
     // using the tool's location μ and scale β.
     const pdfPoints: Array<{ x: number; y: number }> = Array.from({ length: 40 }, (_, i) => {
       const xv = (mu - 3 * beta) + (i * 6 * beta) / 39;
       const yv = (xv - mu) / beta;
       const pdf = (1 / beta) * Math.exp(-yv - Math.exp(-yv));
       return { x: xv, y: Number.isFinite(pdf) ? pdf : Number.NaN };
     });
     const result = hasT ? xEff : F;
     return {
       result, unit: hasT ? 'm³/s' : '—',
       secondary: [
         { key: 'returnPeriod', value: Number.isFinite(T_out) ? T_out : Number.NaN, unit: 'years', label: 'Return period T = 1/(1−F) of the supplied x' },
         { key: 'reducedVariate', value: Number.isFinite(reducedVariate) ? reducedVariate : Number.NaN, unit: '—', label: 'Gumbel reduced variate y = −ln(−ln F)' },
         { key: 'xReturn100', value: Number.isFinite(xReturn100) ? xReturn100 : Number.NaN, unit: 'm³/s', label: '100-year return level μ − β·ln(−ln(1−1/100))' },
       ],
       series: [{
         label: 'Gumbel PDF f(x)',
         color: '#0072B2',
         points: pdfPoints,
       }],
       steps: [
         '── Gumbel (Type I) Extreme Value Distribution (Gumbel, 1958) ──',
         `Location μ = ${mu.toFixed(2)}, Scale β = ${beta.toFixed(2)}`,
         hasT ? `Return period T = ${T.toFixed(0)} years` : `Value x = ${x.toFixed(2)}`,
         '',
         'Step 1 — Reduced variate:',
         `  y = (x − μ) / β = (${(xEff ?? x).toFixed(2)} − ${mu.toFixed(2)}) / ${beta.toFixed(2)} = ${y.toFixed(4)}`,
         '',
         'Step 2 — Return level (quantile):',
         `  x_T = μ − β·ln(−ln(1−1/T)) = ${mu.toFixed(2)} − ${beta.toFixed(2)}·ln(−ln(1−1/${(hasT ? T : 100).toFixed(0)}))`,
         `  x_T = ${(xEff ?? x).toFixed(2)} ${hasT ? 'm³/s' : ''}`,
         '',
         'Step 3 — Return period:',
         `  T = 1 / (1 − F) = ${T_out.toFixed(1)} years`,
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
    // Pickands (1975) GPD for threshold exceedances. x is the excess
    // above threshold (x ≥ 0). The ξ = 0 Fréchet limit is the exponential
    // G(x) = 1 − exp(−x/β); for ξ < 0 the support is bounded by −β/ξ.
    if (![xi, beta, x].every(Number.isFinite) || !(beta > 0)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'exceedProb', value: Number.NaN, unit: '—', label: 'Exceedance probability 1−G (NaN)' },
          { key: 'tailIndex', value: Number.NaN, unit: '—', label: 'Tail index α = 1/ξ (NaN)' },
          { key: 'meanExcess', value: Number.NaN, unit: '—', label: 'Mean excess e = β/(1−ξ) (NaN)' },
          { key: 'returnLevel1pct', value: Number.NaN, unit: '—', label: 'Return level for 1% exceedance (NaN)' },
        ],
        steps: ['── Generalized Pareto Distribution (Pickands, 1975) ──', 'Honest NaN: non-finite parameter or non-positive scale β supplied.']
      };
    }
    let G: number;
    if (x <= 0) {
      G = 0; // exceedances below the threshold: CDF = 0 (support starts at 0)
    } else if (Math.abs(xi) < 1e-9) {
      G = 1 - Math.exp(-x / beta);   // ξ → 0 limit (Gumbel domain)
    } else {
      const inner = 1 + (xi * x) / beta;
      G = inner > 0 ? 1 - Math.pow(inner, -1 / xi) : 1;  // ξ<0: bounded at −β/ξ
    }
    const inner = 1 + (xi * x) / beta;
    const tailIndex = xi > 0 ? 1 / xi : Infinity;
    const meanExcess = xi < 1 ? beta / (1 - xi) : Infinity;
    const exceedProb = 1 - G;
    const pExceed = 0.01; // 1-in-100 exceedance return level
    const returnLevel1pct = Math.abs(xi) < 1e-9
      ? -beta * Math.log(pExceed)
      : (beta / xi) * (Math.pow(pExceed, -xi) - 1);
    const xiNote = xi < -1e-9 ? 'Weibull domain (bounded upper tail at −β/ξ)' : Math.abs(xi) < 1e-9 ? 'Gumbel domain (exponential tail, ξ=0 limit)' : xi < 0.3 ? 'Fréchet domain (heavy tail, moderate)' : 'Fréchet domain (heavy tail)';
    // Distribution series — GPD PDF g(x) over x ∈ [0, 10] (40 points) using
    // the tool's shape ξ and scale β.
    const pdfPoints: Array<{ x: number; y: number }> = Array.from({ length: 40 }, (_, i) => {
      const xv = (i * 10) / 39;
      let pdf: number;
      if (Math.abs(xi) < 1e-9) {
        pdf = (1 / beta) * Math.exp(-xv / beta);
      } else {
        const inner = 1 + (xi * xv) / beta;
        pdf = inner > 0 ? (1 / beta) * Math.pow(inner, -1 / xi - 1) : 0;
      }
      return { x: xv, y: Number.isFinite(pdf) ? pdf : Number.NaN };
    });
    return {
      result: G, unit: '—',
      secondary: [
        { key: 'exceedProb', value: Number.isFinite(exceedProb) ? exceedProb : Number.NaN, unit: '—', label: 'Exceedance probability P(X > x) = 1 − G' },
        { key: 'tailIndex', value: Number.isFinite(tailIndex) ? tailIndex : Number.NaN, unit: '—', label: 'Tail index α = 1/ξ (∞ = exponential tail)' },
        { key: 'meanExcess', value: Number.isFinite(meanExcess) ? meanExcess : Number.NaN, unit: '—', label: 'Mean excess e = β/(1−ξ)' },
        { key: 'returnLevel1pct', value: Number.isFinite(returnLevel1pct) ? returnLevel1pct : Number.NaN, unit: '—', label: 'Return level for a 1% exceedance (1-in-100 event)' },
      ],
      series: [{
        label: 'GPD PDF g(x)',
        color: '#0072B2',
        points: pdfPoints,
      }],
      steps: [
        '── Generalized Pareto Distribution (Pickands, 1975) ──',
        `Shape ξ = ${xi.toFixed(3)}, Scale β = ${beta.toFixed(2)}`,
        `Excess above threshold x = ${x.toFixed(2)} (support x ≥ 0)`,
        '',
        'Step 1 — Check domain:',
        `  1 + ξ·x/β = 1 + (${xi.toFixed(3)} × ${x.toFixed(2)}) / ${beta.toFixed(2)} = ${inner.toFixed(4)}`,
        `  ${inner > 0 || Math.abs(xi) < 1e-9 ? '✓ Within domain: valid GPD evaluation' : 'Beyond bounded support (ξ<0): G = 1'}`,
        '',
        'Step 2 — GPD CDF:',
        Math.abs(xi) < 1e-9
          ? `  G(x) = 1 − exp(−x/β)  [ξ = 0 exponential limit]  = ${G.toFixed(6)}`
          : `  G(x) = 1 − (1 + ξ·x/β)^(−1/ξ)  = ${G.toFixed(6)}`,
        '',
        'Step 3 — Tail diagnostics:',
        `  ξ = ${xi.toFixed(3)} → ${xiNote}`,
        `  Tail index α = 1/ξ = ${tailIndex === Infinity ? '∞ (exponential tail)' : tailIndex.toFixed(2)}`,
        `  Mean excess e(u) = β/(1−ξ) = ${meanExcess === Infinity ? '∞ (undefined for ξ ≥ 1)' : meanExcess.toFixed(2)}`,
        '',
        `  └ Exceedance probability P(X > x) = ${((1 - G) * 100).toFixed(2)}%`,
      ]
    };
  },
  42: ({ obs, K, unit }) => {
    // Matheron (1963) EXPERIMENTAL semivariogram on genuine observations:
    // γ̂(h_k) = (1/(2·N(h_k)))·Σ_{pairs, d≈h_k}[z(sᵢ) − z(sⱼ)]².
    // All N(N−1)/2 station pairs are binned into K lag classes over [0, 0.6·d_max];
    // the primary result is γ̂ at the median non-empty lag class. No synthetic
    // sample series — real station coordinates and values only.
    const observations = (Array.isArray(obs) ? obs as Array<{ lat: number; lon: number; value: number; siteName?: string }> : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), value: Number(o.value), siteName: typeof o.siteName === 'string' ? o.siteName : undefined }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.value));
    const nLags = Number.isFinite(K) && K >= 3 && K <= 40 ? Math.floor(K) : 10;
    const n = observations.length;
    const outUnit = typeof unit === 'string' && unit ? unit : '—';
    const nanSecondary = [
      { key: 'sillEstimate', value: Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Sill estimate (max γ̂) (NaN)' },
      { key: 'nuggetEstimate', value: Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Near-origin nugget-like γ̂ (NaN)' },
      { key: 'nPairs', value: Number.NaN, unit: '—', label: 'Station pairs binned (NaN)' },
      { key: 'lagsUsed', value: Number.NaN, unit: '—', label: 'Non-empty lag classes (NaN)' },
    ];
    if (n < 4) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Matheron Semivariogram (Matheron, 1963) ──',
          `Genuine observations available: ${n}`,
          '',
          'Honest NaN: the experimental semivariogram needs all N(N−1)/2 '
          + 'station pairs; the USGS network returned fewer than 4 reporting '
          + 'stations here — no values are fabricated.',
        ]
      };
    }
    const pairs: Array<{ h: number; dz2: number }> = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pairs.push({
          h: pairDistanceKm(observations[i].lat, observations[i].lon, observations[j].lat, observations[j].lon),
          dz2: (observations[i].value - observations[j].value) ** 2,
        });
      }
    }
    const hMax = Math.max(...pairs.map((p) => p.h));
    const cap = hMax * 0.6; // standard: only use lags up to ~60% of max separation
    const gamma: number[] = new Array(nLags).fill(NaN);
    const counts: number[] = new Array(nLags).fill(0);
    const lagCenters: number[] = new Array(nLags).fill(0);
    for (let k = 0; k < nLags; k++) {
      const lo = (cap * k) / nLags, hi = (cap * (k + 1)) / nLags;
      lagCenters[k] = (lo + hi) / 2;
      let sumSq = 0;
      for (const p of pairs) {
        if (p.h > lo && p.h <= hi) { sumSq += p.dz2; counts[k]++; }
      }
      if (counts[k] > 0) gamma[k] = sumSq / (2 * counts[k]);   // Matheron 1963 Eq.
    }
    const finite = gamma.filter((g) => Number.isFinite(g));
    if (!finite.length) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Matheron Semivariogram (Matheron, 1963) ──',
          `${n} observations, ${pairs.length} pairs, lag cap = ${cap.toFixed(1)} km`,
          'Honest NaN: no pairs fall within the lag classes (network too '
          + 'coarse for the default bin count) — no values are fabricated.',
        ]
      };
    }
    // Primary output: γ̂ at the median non-empty lag class.
    const medianIdx = gamma.indexOf(finite[Math.floor(finite.length / 2)]);
    const gMed = gamma[medianIdx];
    const gMax = Math.max(...finite);
    // Nugget/sill diagnostics from the binned curve.
    const sillEst = gMax;
    const nuggetEst = gamma[0] ?? NaN; // γ̂ of the first (nearest) lag
    // Scatter series — experimental semivariogram γ̂(h) from the tool's own
    // binned Matheron estimator (lag centers with non-empty classes).
    const varioPoints: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < nLags; k++) {
      if (Number.isFinite(gamma[k])) varioPoints.push({ x: lagCenters[k], y: gamma[k] });
    }
    return {
      result: gMed, unit: outUnit,
      secondary: [
        { key: 'sillEstimate', value: Number.isFinite(sillEst) ? sillEst : Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Sill estimate (max γ̂ over non-empty lags)' },
        { key: 'nuggetEstimate', value: Number.isFinite(nuggetEst) ? nuggetEst : Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Near-origin γ̂ (nugget-like discontinuity)' },
        { key: 'nPairs', value: counts.reduce((s, c) => s + c, 0), unit: '—', label: 'Station pairs binned into lag classes' },
        { key: 'lagsUsed', value: finite.length, unit: '—', label: 'Non-empty lag classes used' },
      ],
      series: [{
        label: 'Experimental semivariogram γ(h)',
        color: '#0072B2',
        points: varioPoints,
      }],
      steps: [
        '── Matheron Semivariogram (Matheron, 1963) ──',
        `${n} genuine observations | ${pairs.length} pairs | ${nLags} lag classes to ${cap.toFixed(1)} km`,
        '',
        'Step 1 — All-point pairs and squared differences:',
        `  For every pair (i,j): distance d_ij (haversine), Δz² = [z(sᵢ)−z(sⱼ)]²`,
        '',
        'Step 2 — Bin pairs and compute γ̂(h_k) = ΣΔz²/(2·N(h_k)):',
        gamma.map((g, k) => counts[k] > 0
          ? `  lag ${lagCenters[k].toFixed(2)} km: γ̂ = ${g.toFixed(3)} (N=${counts[k]} pairs)`
          : `  lag ${lagCenters[k].toFixed(2)} km: — (empty)`).join('\n'),
        '',
        'Step 3 — Spatial structure summary:',
        `  γ̂ (median non-empty lag) = ${gMed.toFixed(4)} ${typeof unit === 'string' && unit ? '²' : ''}`,
        `  Sill estimate (max γ̂) = ${sillEst.toFixed(3)}${Number.isFinite(nuggetEst) ? ` | near-origin γ̂ = ${nuggetEst.toFixed(3)} (nugget-like)` : ''}`,
        '',
        `  └ γ(0)=0 by definition; discontinuity at the origin is the nugget effect c₀`,
        `  └ Fit spherical / exponential / Gaussian models to get range, sill, nugget (Tools 37/38 use the fitted fit)`,
        `  └ Directional variograms needed if the process is anisotropic`,
      ]
    };
  },

  // ── Domain 6: Soil Science & Land Surface ──
  43: ({ thetaR, thetaS, alpha, n, psi, __vgSource }) => {
    const anyMissing = [thetaR, thetaS, alpha, n, psi].some((x) => !Number.isFinite(x));
    const vgSrc = typeof __vgSource === 'string' ? __vgSource : 'user-supplied / default';
    if (anyMissing || !(n > 1)) {
      return {
        result: Number.NaN, unit: 'm³/m³',
        secondary: [
          { key: 'effective_saturation', value: Number.NaN, unit: '—', label: 'Effective Saturation S_e' },
          { key: 'theta_s', value: Number.isFinite(thetaS) ? thetaS : Number.NaN, unit: 'm³/m³', label: 'Saturated Water Content θ_s' },
        ],
        steps: [
          '── Van Genuchten Water Retention (van Genuchten, 1980) ──',
          `Parameters (α, n: Carsel & Parr 1988 by USDA texture — ${vgSrc}):`,
          `  θ_r = ${Number.isFinite(thetaR) ? thetaR.toFixed(3) : 'NaN'}, θ_s = ${Number.isFinite(thetaS) ? thetaS.toFixed(3) : 'NaN'}, α = ${Number.isFinite(alpha) ? alpha.toExponential(3) : 'NaN'} /cm, n = ${Number.isFinite(n) ? n.toFixed(3) : 'NaN'}`,
          '',
          `⚠ Cannot compute — ${n > 1 ? 'a required input is unavailable (NaN).' : 'n must be > 1 (m = 1 − 1/n must be positive) for the van Genuchten model.'} Supply the retention parameters or a study point from which they can be derived.`,
        ],
      };
    }
    const m = 1 - 1 / n;
    const aPsi = alpha * Math.abs(psi);
    const term = Math.pow(1 + Math.pow(aPsi, n), m);
    const theta = thetaR + (thetaS - thetaR) / term;
    const Se = term > 0 ? 1 / term : 0;
    const psi_kPa = Math.abs(psi) * 0.0980665; // 1 cm H₂O = 0.0980665 kPa
    // Mualem (1976) relative hydraulic conductivity with tortuosity L = 0.5:
    //   K/K_s = S_e^0.5 · [1 − (1 − S_e^(1/m))^m]²
    const kRel = Math.pow(Se, 0.5) * Math.pow(1 - Math.pow(1 - Math.pow(Se, 1 / m), m), 2);
    // Profile series — θ(ψ) over a log-spaced matric-potential sweep
    // (|ψ| = 0.1 … 1000 cm) spanning wet through air-dry conditions.
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const psiAbsSweep = Math.pow(10, -1 + (i / 40) * 4);
      const termSweep = Math.pow(1 + Math.pow(alpha * psiAbsSweep, n), m);
      const thetaSweep = thetaR + (thetaS - thetaR) / termSweep;
      seriesPoints.push({ x: -psiAbsSweep, y: Number.isFinite(thetaSweep) ? thetaSweep : Number.NaN });
    }
    return {
      result: theta, unit: 'm³/m³',
      secondary: [
        { key: 'effective_saturation', value: Number.isFinite(Se) ? Se : Number.NaN, unit: '—', label: 'Effective Saturation S_e' },
        { key: 'theta_s', value: Number.isFinite(thetaS) ? thetaS : Number.NaN, unit: 'm³/m³', label: 'Saturated Water Content θ_s' },
        { key: 'alpha', value: Number.isFinite(alpha) ? alpha : Number.NaN, unit: '/cm', label: 'Retention Shape Parameter α' },
        { key: 'relative_conductivity', value: Number.isFinite(kRel) ? kRel : Number.NaN, unit: '—', label: 'Rel. Hydraulic Conductivity K/K_s (Mualem)' },
      ],
      series: [{
        label: 'θ(ψ) van Genuchten',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Van Genuchten Water Retention (van Genuchten, 1980) ──',
        `Parameters (α, n: Carsel & Parr 1988 by USDA texture — ${vgSrc}):`,
        `  θ_r = ${thetaR.toFixed(3)}, θ_s = ${thetaS.toFixed(3)}, α = ${alpha.toExponential(3)} /cm, n = ${n.toFixed(3)}, m = 1 − 1/n = ${m.toFixed(4)}`,
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
        `  Mualem K/K_s = ${kRel.toExponential(3)} (tortuosity 0.5, i.e. S_e^0.5·[1 − (1 − S_e^(1/m))^m]²)`,
        '',
        `  └ Plant-available water: ${theta < thetaR + 0.05 ? 'Wilting point conditions' : theta < thetaS * 0.6 ? 'Field capacity to wilting — available water present' : 'Above field capacity — drainage occurring'}`,
      ]
    };
  },
  44: ({ psib, psi, lambda, thetaR, thetaS }) => {
    const anyMissing = [psib, psi, lambda, thetaR, thetaS].some((x) => !Number.isFinite(x));
    if (anyMissing) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'theta', value: Number.NaN, unit: 'm³/m³', label: 'Volumetric Water Content θ' },
          { key: 'relative_conductivity', value: Number.NaN, unit: '—', label: 'Rel. Conductivity K/K_s' },
        ],
        steps: [
          '── Brooks-Corey Water Retention (Brooks & Corey, 1964) ──',
          `ψ_b = ${Number.isFinite(psib) ? psib.toFixed(2) : 'NaN'} cm, ψ = ${Number.isFinite(psi) ? psi.toFixed(2) : 'NaN'} cm, λ = ${Number.isFinite(lambda) ? lambda.toFixed(2) : 'NaN'}, θ_r = ${Number.isFinite(thetaR) ? thetaR.toFixed(3) : 'NaN'}, θ_s = ${Number.isFinite(thetaS) ? thetaS.toFixed(3) : 'NaN'}`,
          '',
          '⚠ Cannot compute — a required input is unavailable (NaN). Supply ψ_b, ψ, λ, θ_r and θ_s or a study point from which they can be derived.',
        ],
      };
    }
    // Brooks & Corey (1964) Hydrology Papers No. 3. Effective saturation:
    //   S_e = (|ψ_b|/|ψ|)^λ  for |ψ| > |ψ_b| (draining)
    //   S_e = 1              for |ψ| ≤ |ψ_b| (saturated, air-entry not exceeded)
    // Relative conductivity K/K_s = S_e^((3λ+2)/λ) = S_e^(3 + 2/λ).
    // Air-entry pore radius from Young-Laplace: r_max = 2σcosθ/(ρg|ψ_b|).
    const psiAbs = Math.abs(psi);
    const psibAbs = Math.abs(psib);
    const saturated = psiAbs <= psibAbs;
    const Se = saturated ? 1 : Math.pow(psibAbs / psiAbs, lambda);
    const theta = thetaR + (thetaS - thetaR) * Se;
    const cExp = 3 + 2 / lambda;
    const kRel = Math.pow(Se, cExp);
    // Young-Laplace: σ = 72.75e-3 N/m (20 °C), contact angle ~ 0, ρ = 998.2
    const rMaxM = 2 * 72.75e-3 / (998.2 * 9.80665 * (psibAbs / 100));
    const rMaxUm = rMaxM * 1e6;
    const logSe = Math.log10(Math.max(Se, 1e-12));
    // Profile series — θ(ψ) over a log-spaced matric-potential sweep
    // (|ψ| = 0.1 … 1000 cm) spanning wet through air-dry conditions.
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const psiAbsSweep = Math.pow(10, -1 + (i / 40) * 4);
      const sweepSaturated = psiAbsSweep <= psibAbs;
      const sweepSe = sweepSaturated ? 1 : Math.pow(psibAbs / psiAbsSweep, lambda);
      const thetaSweep = thetaR + (thetaS - thetaR) * sweepSe;
      seriesPoints.push({ x: -psiAbsSweep, y: Number.isFinite(thetaSweep) ? thetaSweep : Number.NaN });
    }
    return {
      result: Se, unit: '—',
      secondary: [
        { key: 'effective_saturation', value: Number.isFinite(Se) ? Se : Number.NaN, unit: '—', label: 'Effective Saturation S_e' },
        { key: 'theta', value: Number.isFinite(theta) ? theta : Number.NaN, unit: 'm³/m³', label: 'Volumetric Water Content θ' },
        { key: 'bubbling_pressure', value: Number.isFinite(psibAbs) ? psibAbs : Number.NaN, unit: 'cm', label: 'Bubbling Pressure |ψ_b|' },
        { key: 'relative_conductivity', value: Number.isFinite(kRel) ? kRel : Number.NaN, unit: '—', label: 'Rel. Conductivity K/K_s' },
      ],
      series: [{
        label: 'θ(ψ) Brooks-Corey',
        color: '#D55E00',
        points: seriesPoints,
      }],
      steps: [
        '── Brooks-Corey Water Retention (Brooks & Corey, 1964) ──',
        `Bubbling pressure ψ_b = ${psib.toFixed(2)} cm, Matric potential ψ = ${psi.toFixed(2)} cm`,
        `Pore-size index λ = ${lambda.toFixed(2)} (user-supplied; fit by log-log regression of S_e vs ψ)`,
        '',
        'Step 1 — Saturation check (paper definition):',
        `  |ψ| = ${psiAbs.toFixed(2)} cm ${saturated ? '≤' : '>'} |ψ_b| = ${psibAbs.toFixed(2)} cm → ${saturated ? 'S_e = 1 (soil saturated, air-entry not exceeded)' : 'draining regime'}`,
        '',
        'Step 2 — Effective saturation:',
        saturated
          ? '  S_e = 1 (by definition for |ψ| ≤ |ψ_b|)'
          : `  S_e = (|ψ_b|/|ψ|)^λ = (${psibAbs.toFixed(2)} / ${psiAbs.toFixed(2)})^${lambda.toFixed(2)} = ${Se.toFixed(4)}`,
        '',
        'Step 3 — Pore-size distribution:',
        `  log₁₀(S_e) = ${logSe.toFixed(3)} (slope on log-log retention plot = −λ = −${lambda.toFixed(2)})`,
        `  ${lambda < 1 ? 'Wide pore-size distribution (clay-like)' : lambda > 2 ? 'Narrow pore-size distribution (sand-like)' : 'Moderate pore-size distribution'}`,
        '',
        'Step 4 — Volumetric water content:',
        `  θ = θ_r + (θ_s − θ_r)·S_e = ${thetaR.toFixed(3)} + (${thetaS.toFixed(3)} − ${thetaR.toFixed(3)}) × ${Se.toFixed(4)} = ${theta.toFixed(4)} m³/m³`,
        '',
        'Step 5 — Brooks-Corey unsaturated conductivity and air-entry pore:',
        `  K/K_s = S_e^((3λ+2)/λ) = ${Se.toFixed(4)}^${cExp.toFixed(2)} = ${kRel.toFixed(4)}`,
        `  Air-entry pore radius (Young-Laplace): r_max = 2σ/(ρg|ψ_b|) = ${rMaxUm.toFixed(1)} µm`,
        '',
        `  └ Entry pressure head: |ψ_b| = ${psibAbs.toFixed(1)} cm — drainage of the largest pores begins once |ψ| exceeds |ψ_b|`,
        `  └ Fit ψ_b and λ from measured retention data via log(S_e) = λ·log(|ψ_b|) − λ·log(|ψ|) linear regression`,
      ]
    };
  },
  45: ({ R, K, LS, C, P }) => {
    const steps: string[] = [];
    const anyMissing = [R, K, LS, C, P].some((x) => !Number.isFinite(x));
    if (anyMissing) {
      steps.push('── Universal Soil Loss Equation (Wischmeier & Smith, 1978) ──');
      steps.push('A = R × K × LS × C × P');
      steps.push('');
      steps.push('⚠ Cannot compute: one or more factors are unavailable (NaN).');
      steps.push(`  R = ${Number.isFinite(R) ? R.toFixed(1) : 'NaN — no GHCN rainfall erosivity (supply measured R)'}`);
      steps.push(`  K = ${Number.isFinite(K) ? K.toFixed(3) : 'NaN — no genuine soil texture (supply measured K)'}`);
      steps.push(`  LS = ${Number.isFinite(LS) ? LS.toFixed(2) : 'NaN — no genuine terrain slope (supply measured LS)'}`);
      steps.push(`  C = ${Number.isFinite(C) ? C.toFixed(2) : 'NaN — no genuine land cover (supply measured C)'}`);
      steps.push(`  P = ${Number.isFinite(P) ? P.toFixed(2) : 'NaN — 1 if no conservation practice (supply measured P)'}`);
      return { result: Number.NaN, unit: 't/ha/yr', steps };
    }
    const A = R * K * LS * C * P;
    // 1 metric tonne (t) = 1 megagram (Mg) by definition, so A (t/ha/yr)
    // equals A (Mg/ha/yr) — no unit conversion required.
    const T = 11; // typical soil loss tolerance in t/ha/yr (varies 2–20)
    const excess = A - T;
    return {
      result: A, unit: 't/ha/yr',
      secondary: [
        { key: 'tolerance', value: Number.isFinite(T) ? T : Number.NaN, unit: 't/ha/yr', label: 'Soil Loss Tolerance' },
        { key: 'excess_above_tolerance', value: Number.isFinite(excess) ? excess : Number.NaN, unit: 't/ha/yr', label: 'Excess Above Tolerance' },
      ],
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
        `  A = ${A.toFixed(2)} t/ha/yr (≡ ${A.toFixed(2)} Mg/ha/yr; 1 t = 1 Mg)`,
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
    if ([Rbase, Q10, T, Tbase].some((x) => !Number.isFinite(x))) {
      return {
        result: Number.NaN, unit: 'µmol CO₂/m²/s',
        steps: [
          '── Q₁₀ Temperature Coefficient Model (van\'t Hoff, 1898) ──',
          'R_s = R_base × Q₁₀^((T − T_base)/10)',
          '',
          '⚠ Cannot compute — an input is unavailable (NaN):',
          `  R_base = ${Number.isFinite(Rbase) ? Rbase.toFixed(3) : 'NaN — supply chamber-measured basal respiration'}`,
          `  Q₁₀   = ${Number.isFinite(Q10) ? Q10.toFixed(2) : 'NaN — supply site Q₁₀ (global mean ≈ 2)'}`,
          `  T     = ${Number.isFinite(T) ? T.toFixed(1) : 'NaN — no genuine temperature source; supply soil/air T'}`,
          `  T_base = ${Number.isFinite(Tbase) ? Tbase.toFixed(1) : 'NaN'}`,
        ],
      };
    }
    const exp10 = (T - Tbase) / 10;
    const Rs = Rbase * Math.pow(Q10, exp10);
    const Ea = Math.log(Q10) * 8.314e-3 * Math.pow(T + 273.15, 2) / 10; // kJ/mol
    const annualFlux = Rs * 12.01 * 86400 * 365 / 1e6; // gC/m²/yr
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let tC = -10; tC <= 50; tC++) {
      const r = Rbase * Math.pow(Q10, (tC - Tbase) / 10);
      seriesPoints.push({ x: tC, y: Number.isFinite(r) ? r : Number.NaN });
    }
    return {
      result: Rs, unit: 'µmol CO₂/m²/s',
      secondary: [
        { key: 'activation_energy', value: Number.isFinite(Ea) ? Ea : Number.NaN, unit: 'kJ/mol', label: 'Activation Energy E_a' },
        { key: 'annual_carbon_flux', value: Number.isFinite(annualFlux) ? annualFlux : Number.NaN, unit: 'gC/m²/yr', label: 'Annual Carbon Flux' },
      ],
      series: [{
        label: 'Respiration R_s(T)',
        color: '#009E73',
        points: seriesPoints,
      }],
      steps: [
        '── Q₁₀ Temperature Coefficient Model (van\'t Hoff, 1898; Arrhenius concept) ──',
        `Basal respiration R_base = ${Rbase.toFixed(3)} µmol CO₂/m²/s at ${Tbase.toFixed(1)} °C, current T = ${T.toFixed(1)} °C`,
        `Q₁₀ = ${Q10.toFixed(2)}`,
        '',
        'Step 1 — Compute temperature difference:',
        `  (T − T_base) / 10 = (${T.toFixed(1)} − ${Tbase.toFixed(1)}) / 10 = ${exp10.toFixed(2)} decades`,
        '',
        'Step 2 — Compute temperature response:',
        `  R_s = R_base × Q₁₀^{(T − T_base)/10}`,
        `  R_s = ${Rbase.toFixed(3)} × ${Q10.toFixed(2)}^{${exp10.toFixed(2)}}`,
        `  R_s = ${Rs.toFixed(4)} µmol CO₂/m²/s`,
        '',
        'Step 3 — Sensitivity:',
        `  ${Q10 < 1.5 ? 'Low temperature sensitivity (e.g. saturated/ cold-adapted soils)' : Q10 < 2.5 ? 'Typical soil respiration sensitivity (most ecosystems)' : Q10 < 4 ? 'High sensitivity (e.g. tropical peat, high-latitude organic soils)' : 'Very high sensitivity — potential for strong carbon-climate feedback'}`,
        '',
        `  └ Q₁₀ = ${Q10.toFixed(2)}: rate increases ×${Q10.toFixed(2)} per 10 °C warming`,
        `  └ Note: Q₁₀ often decreases with increasing temperature (apparent vs intrinsic Q₁₀)`,
      ]
    };
  },
  47: ({ sandFrac, omPct, rhoB, theta, __thetaSource }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const sandFracN = Number(sandFrac), omPctN = Number(omPct), rhoBN = Number(rhoB), thetaN = Number(theta);
    // de Vries (1963) "Thermal properties of soils", in van Wijk (ed.)
    // Physics of Plant Environment — transcribed verbatim from Farouki
    // (1981) CRREL Monograph 81-1 §7.6 (public-domain).
    const inputs47: Array<[string, number, string]> = [
      ['sand', sandFracN, 'NaN — no genuine ISRIC soil pixel; supply sand fraction (0–1)'],
      ['OM%', omPctN, 'NaN — no genuine ISRIC organic matter; supply OM %'],
      ['ρ_b', rhoBN, 'NaN — no genuine ISRIC bulk density; supply ρ_b (kg/dm³)'],
      ['θ', thetaN, 'NaN — no genuine GLDAS soil moisture; supply θ (m³/m³)'],
    ];
    if (inputs47.some(([, v]) => !Number.isFinite(v))) {
      return {
        result: Number.NaN, unit: 'W/m·K',
        secondary: [
          { key: 'thermal_diffusivity', value: Number.NaN, unit: 'm²/s', label: 'Thermal Diffusivity (λ/C)' },
          { key: 'heat_capacity', value: Number.NaN, unit: 'MJ/m³·K', label: 'Volumetric Heat Capacity' },
        ],
        steps: [
          '── de Vries Soil Thermal Conductivity Model (de Vries, 1963) ──',
          'λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ), kᵢ = (1/3)·[2/(1+(λᵢ/λ_f−1)·g_a) + 1/(1+(λᵢ/λ_f−1)·g_c)]',
          '',
          '⚠ Cannot compute — a genuine input is unavailable (NaN):',
          ...inputs47.map(([label, v, msg]) =>
            `  ${label.padEnd(6)} = ${Number.isFinite(v) ? v.toFixed(3) : msg}`),
          '',
          'No static substitute is used for missing genuine data (audit rule).',
        ],
      };
    }
    // Constituent thermal conductivities, W/m·K — Farouki Table 2 (after
    // van Wijk 1963), 20 °C: quartz 8.4, other soil minerals 2.9, soil
    // organic matter 0.25, water 0.6, air 0.026. Volumetric heat capacity
    // cal/cm³·°C: minerals 0.46, organic matter 0.60, water 1.00, air 0.00029.
    // Solid densities g/cm³: minerals (quartz) 2.65, organic matter 1.3.
    const LAMQ = 8.4, LAMO = 2.9, LAMOM = 0.25, LAMW = 0.6, LAMA = 0.026;
    const CV = 4.186e6; // J/m³·K per cal/cm³·°C
    // de Vries weighting factors (Farouki §7.6): oblate spheroids with
    // g_a = g_b = 0.125, g_c = 0.75 (de Vries 1952a fit); the continuous
    // phase has k = 1. Water-continuous when θ above the minimum at which
    // water may still be regarded as continuous (de Vries 1963: xw = 0.03
    // coarse soils, 0.05–0.10 fine soils — 0.05 used here); air-continuous
    // below, with the de Vries "adjusted" dry correction +25 % (the
    // calculation otherwise comes out 25 % too low for dry soils).
    const kw = (lamI: number, lamF: number, ga = 0.125, gc = 0.75): number => {
      const r = lamI / lamF - 1;
      return (1 / 3) * (2 / (1 + r * ga) + 1 / (1 + r * gc));
    };
    // Phase volume fractions from genuine ρ_b and OM% (van Bemmelen
    // OC→OM already applied upstream in mapInputs).
    const fOm = omPctN / 100;
    const rho = rhoBN * 1000; // kg/m³
    const xMin = rho * (1 - fOm) / 2650;
    const xOm = rho * fOm / 1300;
    // Quartz content: ISRIC exposes no quartz band — the sand fraction is
    // the standard available proxy for the quartz fraction of the mineral
    // solids (Johansen 1975 convention, cited throughout Farouki §7).
    const q = Math.max(0, Math.min(1, sandFracN));
    const xQ = xMin * q, xO = xMin * (1 - q);
    const phi = Math.max(0, 1 - xQ - xO - xOm);
    const xw = Math.max(0, Math.min(thetaN, phi));
    const xa = Math.max(0, phi - xw);
    const coarse = q >= 0.85;
    const thetaCut = coarse ? 0.03 : 0.05;
    const wet = xw >= thetaCut;

    const kQ = kw(LAMQ, wet ? LAMW : LAMA);
    const kO = kw(LAMO, wet ? LAMW : LAMA);
    const kOm = kw(LAMOM, wet ? LAMW : LAMA);
    let lam: number;
    let regime: string;
    if (wet) {
      // Moist soil: solids + air are two components dispersed in a
      // continuous water medium (Farouki eq for unsaturated soil).
      // Effective air-phase conductivity includes apparent moisture/vapour
      // migration: k_a = 0.0615 + 1.96·xw (mcal/cm·s·°C), pores saturated
      // with vapour for xw ≥ 0.09 → constant there (Farouki §7.6);
      // ×0.4186 → W/m·K.
      const mcal = 0.0615 + 1.96 * Math.min(xw, 0.09);
      const kaEff = mcal * 0.4186;
      // Air-pore shape factors — Farouki §7.6 approximate procedure:
      // 0.09 < xw < φ: g_a linear from 0.333 (sphere) to 0.035 as xw → 0,
      //   g_a = 0.333 − (x_a/φ)·(0.333 − 0.035);
      // xw < 0.09 (pores not saturated with vapour):
      //   g_a = 0.013 + 0.944·xw;  g_c = 1 − 2·g_a.
      const gaAir = xw >= 0.09 && phi > 0
        ? 0.333 - (xa / phi) * (0.333 - 0.035)
        : 0.013 + 0.944 * xw;
      const kA = kw(kaEff, LAMW, gaAir, 1 - 2 * gaAir);
      lam = (kQ * xQ * LAMQ + kO * xO * LAMO + kOm * xOm * LAMOM
        + 1 * xw * LAMW + kA * xa * kaEff)
        / (kQ * xQ + kO * xO + kOm * xOm + 1 * xw + kA * xa);
      regime = `water-continuous (θ ≥ ${thetaCut}${coarse ? ', coarse soil' : ''})`;
    } else {
      // Dry soil: air is the continuous phase.
      const kWet = xw > 0 ? kw(LAMW, LAMA) : 0;
      lam = ((kQ * xQ * LAMQ + kO * xO * LAMO + kOm * xOm * LAMOM
        + kWet * xw * LAMW + 1 * xa * LAMA)
        / (kQ * xQ + kO * xO + kOm * xOm + kWet * xw + 1 * xa)) * 1.25;
      regime = `air-continuous (θ < ${thetaCut}) + de Vries dry-soil +25 % adjustment`;
    }
    // Volumetric heat capacity C = Σ x_i·c_i (Farouki Table 2 c_i).
    const C = (xMin * 0.46 + xOm * 0.60 + xw * 1.00 + xa * 0.00029) * CV;
    const alpha = lam / C;
    return {
      result: lam, unit: 'W/m·K',
      secondary: [
        { key: 'thermal_diffusivity', value: Number.isFinite(alpha) ? alpha : Number.NaN, unit: 'm²/s', label: 'Thermal Diffusivity (λ/C)' },
        { key: 'heat_capacity', value: Number.isFinite(C) ? C / 1e6 : Number.NaN, unit: 'MJ/m³·K', label: 'Volumetric Heat Capacity' },
      ],
      steps: [
        '── de Vries Soil Thermal Conductivity Model (de Vries, 1963) ──',
        'λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ) with de Vries spheroid weighting factors',
        `Inputs: sand fraction q = ${q.toFixed(3)} (quartz proxy, Johansen 1975), OM = ${omPctN.toFixed(2)} %, ρ_b = ${rhoBN.toFixed(3)} kg/dm³, θ = ${thetaN.toFixed(3)} m³/m³`,
        ...(typeof __thetaSource === 'string' ? [`Provenance: ${__thetaSource}`] : []),
        '',
        'Step 1 — Volume fractions (from genuine ρ_b, OM; minerals 2.65 g/cm³, OM 1.3 g/cm³):',
        `  x_quartz = ${xQ.toFixed(4)}, x_other-min = ${xO.toFixed(4)}, x_organic = ${xOm.toFixed(4)}`,
        `  porosity φ = ${phi.toFixed(4)}, x_water = ${xw.toFixed(4)}, x_air = ${xa.toFixed(4)}`,
        '',
        `Step 2 — Continuous phase: ${regime}`,
        '',
        'Step 3 — de Vries weighting factors (g_a=0.125, g_c=0.75; k=1 for the continuous phase):',
        `  k_q = ${kQ.toFixed(4)}, k_other = ${kO.toFixed(4)}, k_om = ${kOm.toFixed(4)}`,
        '  Constituents λ (W/m·K): quartz 8.4, other minerals 2.9, organic 0.25, water 0.6, air 0.026',
        '',
        'Step 4 — Effective conductivity λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ):',
        `  λ = ${lam.toFixed(4)} W/m·K`,
        '',
        'Step 5 — Volumetric heat capacity & thermal diffusivity (Table 2 c_i):',
        `  C = Σxᵢ·cᵢ = ${(C / 1e6).toFixed(3)} MJ/m³/K,  α = λ/C = ${(alpha * 1e6).toFixed(3)}×10⁻⁶ m²/s`,
        '',
        `  └ ${lam > 1.5 ? 'Mineral-dominated conduction (wet sand/gravel regime)' : lam > 0.5 ? 'Typical moist mineral soil' : lam > 0.15 ? 'Dry soil, air-continuous insulation' : 'Organic/peat or very dry soil — strong insulation'}`,
        '  Accuracy expectation (Farouki §7.13): predictions within ±25 % of measurement; best agreement at degree of saturation 0.1–0.2.',
      ]
    };
  },
  48: ({ kappa, ustar, z, L, z0M, __lSource, __ustarSource, __z0Source }) => {
    if (!Number.isFinite(L) || !Number.isFinite(kappa) || !Number.isFinite(z)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'obukhov_length', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Obukhov Length L' },
          { key: 'stability_parameter', value: Number.NaN, unit: '—', label: 'Stability Parameter ζ = z/L' },
        ],
        steps: [
          '── Monin-Obukhov Similarity (Monin & Obukhov, 1954; Högström, 1988) ──',
          'φ_m(ζ) = (κz/u_*)·∂ū/∂z, ζ = z/L, L = −u_*³·θ̄ᵥ/(κ·g·w\u0304θ̄ᵥ₀)',
          '',
          '  ⚠ Cannot compute — a genuine input is unavailable (NaN):',
          ...(!Number.isFinite(L) ? [`    L (Obukhov length) = NaN — ${typeof __lSource === 'string' && __lSource ? __lSource : 'no genuine u_* and sensible heat flux to derive it from; supply L (and u_*) from tower/eddy-covariance data, or provide a study point so they can be derived from genuine ERA5 reanalysis'}`] : []),
          ...(!Number.isFinite(kappa) ? [`    κ (von Kármán constant) = NaN — supply 0.40 (Högström 1988)`] : []),
          ...(!Number.isFinite(z) ? [`    z (measurement height) = NaN — supply the reference height (default 10 m)`] : []),
        ],
      };
    }
    const zetaRaw = z / L;
    const zeta = Math.max(-2, Math.min(1, zetaRaw));
    const outOfRange = Math.abs(zeta - zetaRaw) > 1e-12;
    // Högström (1988) BLME 42:55–78 flux–profile functions as tabulated by
    // Foken (2006) Eqs 21–22 (κ = 0.40, φ_h(0) = 0.95):
    //   unstable (−2 < ζ < 0): φ_m = (1 − 19.3ζ)^(−1/4), φ_h = 0.95(1 − 11.6ζ)^(−1/2)
    //   stable   (0 < ζ < 1):  φ_m = 1 + 6ζ,            φ_h = 0.95 + 7.8ζ
    const phiM = zeta >= 0
      ? 1 + 6 * zeta
      : Math.pow(1 - 19.3 * zeta, -0.25);
    const phiH = zeta >= 0
      ? 0.95 + 7.8 * zeta
      : 0.95 * Math.pow(1 - 11.6 * zeta, -0.5);
    // Integrated stability corrections — exact integrals of the Högström
    // (1988) forms, evaluated by quadrature against scipy.integrate to
    // ≤1e-5 before adoption:
    //   psiM = ∫₀^ζ (1−φ_m)/x dx  → u(z)−u(z₀) = (u*/κ)·[ln(z/z₀) − ψ_m]
    //     unstable: u = (1−19.3ζ)^¼ → 2ln((1+u)/2) + ln((1+u²)/2) − 2arctan u + π/2
    //     stable:   φ_m − 1 = 6x → ψ_m = −6ζ
    //   psiH = ∫₀^ζ (φ_h−φ_h(0))/x dx (φ_h(0) = 0.95 ≠ 1 — the (1−φ_h)/x
    //     form diverges at 0; the Högström heat profile is instead
    //     θ(z)−θ(z₀) = (θ*/κ)·[0.95·ln(z/z₀) + ψ_h]):
    //     unstable: v = (1−11.6ζ)^½ → ψ_h = −0.95·2ln((1+v)/2)
    //     stable:   φ_h − 0.95 = 7.8x → ψ_h = +7.8ζ
    let psiM: number, psiH: number;
    if (zeta < 0) {
      const uq = Math.pow(1 - 19.3 * zeta, 0.25);
      psiM = 2 * Math.log((1 + uq) / 2) + Math.log((1 + uq * uq) / 2) - 2 * Math.atan(uq) + Math.PI / 2;
      const vh = Math.pow(1 - 11.6 * zeta, 0.5);
      psiH = -0.95 * 2 * Math.log((1 + vh) / 2);
    } else {
      psiM = -6 * zeta;
      psiH = 7.8 * zeta;
    }
    // Gradient Richardson number — exact identity in MOST: Ri = ζ·φ_h/φ_m²
    const Ri = (zeta * phiH) / (phiM * phiM);
    const regime = zeta <= -1 ? 'VERY STRONGLY UNSTABLE — free convection dominates'
      : zeta < -0.01 ? 'UNSTABLE (convective) — buoyant production of turbulence'
      : zeta <= 0.01 ? 'NEAR-NEUTRAL — mechanical turbulence dominates'
      : zeta < 1 ? 'STABLE (stratified) — buoyancy suppresses turbulence'
      : 'VERY STABLE — weak/intermittent turbulence';
    // Aerodynamic resistance to momentum (catalogue secondary output):
    // r_a = [ln(z/z₀) − ψ_m(ζ)]/(κ·u_*); z₀ from land cover unless overridden
    const uNum = Number(ustar);
    let ra = Number.NaN;
    let raSteps: string[] = [];
    if (Number.isFinite(uNum) && uNum > 1e-4 && Number.isFinite(Number(z0M)) && Number(z0M) > 0 && z > Number(z0M)) {
      ra = (Math.log(z / Number(z0M)) - psiM) / (kappa * uNum);
      raSteps = [
        '',
        'Step 4 — Integrated stability corrections & aerodynamic resistance:',
        ...((typeof __z0Source === 'string' && __z0Source) ? [`  Provenance: ${__z0Source}`] : []),
        `  ψ_m(ζ) = ${psiM.toFixed(4)}, ψ_h(ζ) = ${psiH.toFixed(4)} (exact integrals of the Högström forms)`,
        `  r_a = [ln(z/z₀) − ψ_m]/(κ·u_*) = [ln(${z.toFixed(1)}/${Number(z0M).toFixed(3)}) − (${psiM.toFixed(4)})]/(${kappa.toFixed(2)}×${uNum.toFixed(3)}) = ${ra.toFixed(2)} s/m`,
      ];
    }
    const classCode = zeta <= -1 ? 1 : zeta < -0.01 ? 2 : zeta <= 0.01 ? 3 : zeta < 1 ? 4 : 5;
    // Profile series — with genuine u_* and z₀, a MOST wind-speed profile
    // u(z) = (u_*/κ)·[ln(z/z₀) − ψ_m(ζ)] across heights; otherwise fall back
    // to the φ_m(ζ) universal function across the validated stability range.
    const seriesPoints: Array<{ x: number; y: number }> = [];
    if (Number.isFinite(uNum) && uNum > 1e-4 && Number.isFinite(Number(z0M)) && Number(z0M) > 0) {
      const zBottom = Number(z0M) * 2, zTop = 200;
      for (let i = 0; i <= 40; i++) {
        const h = zBottom * Math.pow(zTop / zBottom, i / 40);
        const uAtH = (uNum / kappa) * (Math.log(h / Number(z0M)) - psiM);
        seriesPoints.push({ x: h, y: Number.isFinite(uAtH) ? uAtH : Number.NaN });
      }
    } else {
      for (let i = 0; i <= 40; i++) {
        const zetaS = -2 + (i / 40) * 3;
        const phiS = zetaS >= 0 ? 1 + 6 * zetaS : Math.pow(1 - 19.3 * zetaS, -0.25);
        seriesPoints.push({ x: zetaS, y: Number.isFinite(phiS) ? phiS : Number.NaN });
      }
    }
    return {
      result: phiM, unit: '—',
      secondary: [
        { key: 'obukhov_length', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Obukhov Length L' },
        { key: 'stability_parameter', value: Number.isFinite(zeta) ? zeta : Number.NaN, unit: '—', label: 'Stability Parameter ζ = z/L' },
        { key: 'stability_class', value: Number.isFinite(classCode) ? classCode : Number.NaN, unit: '—', label: 'Stability Class Code (1 very unstable → 5 very stable)' },
        { key: 'richardson_number', value: Number.isFinite(Ri) ? Ri : Number.NaN, unit: '—', label: 'Gradient Richardson Number Ri' },
        { key: 'phi_h', value: Number.isFinite(phiH) ? phiH : Number.NaN, unit: '—', label: 'Dimensionless Temperature Gradient φ_h' },
        { key: 'aerodynamic_resistance', value: Number.isFinite(ra) ? ra : Number.NaN, unit: 's/m', label: 'Aerodynamic Resistance r_a' },
      ],
      series: [{
        label: Number.isFinite(uNum) && uNum > 1e-4 && Number.isFinite(Number(z0M)) && Number(z0M) > 0 ? 'u(z) MOST profile' : 'φ_m(ζ) universal function',
        color: '#CC79A7',
        points: seriesPoints,
      }],
      steps: [
        '── Monin-Obukhov Similarity (Monin & Obukhov, 1954; Högström, 1988) ──',
        'φ_m(ζ) = (κz/u_*)·∂ū/∂z, φ_h(ζ) = (κz/θ_*)·∂θ̄/∂z, ζ = z/L',
        `Inputs: κ = ${kappa.toFixed(2)}, z = ${z.toFixed(1)} m, L = ${L.toFixed(2)} m${Number.isFinite(uNum) ? `, u_* = ${uNum.toFixed(3)} m/s` : ''}, ζ = z/L = ${zetaRaw.toFixed(4)}`,
        ...(typeof __lSource === 'string' && __lSource ? [`Provenance: ${__lSource}`] : []),
        ...((typeof __ustarSource === 'string' && __ustarSource) ? [`Provenance: ${__ustarSource}`] : []),
        '',
        'Step 1 — Stability classification:',
        `  ζ = ${zeta.toFixed(4)} → ${regime}`,
        ...(outOfRange ? [`  ⚠ ζ = ${zetaRaw.toFixed(3)} outside the Högström (1988) validated range (−2 < ζ < 1) — functions evaluated at the bound ${zeta.toFixed(1)}`] : []),
        '',
        'Step 2 — Högström (1988) flux-profile functions (κ = 0.40, φ_h(0) = 0.95):',
        '  unstable (−2 < ζ < 0): φ_m = (1 − 19.3ζ)^(−1/4), φ_h = 0.95·(1 − 11.6ζ)^(−1/2)',
        '  stable   (0 < ζ < 1):  φ_m = 1 + 6ζ,             φ_h = 0.95 + 7.8ζ',
        `  φ_m(ζ) = ${phiM.toFixed(4)}  (dimensionless wind shear)`,
        `  φ_h(ζ) = ${phiH.toFixed(4)}  (dimensionless temperature gradient)`,
        `  Ri = ζ·φ_h/φ_m² = ${Ri.toFixed(4)}  (exact MOST identity)`,
        '',
        'Step 3 — Consequence for the mean profile:',
        `  ∂ū/∂z = (u_*/κz)·φ_m — ${zeta < 0 ? 'shallower than the neutral log profile (enhanced mixing)' : zeta === 0 ? 'pure logarithmic profile' : 'steeper than the neutral log profile (mixing suppressed)'}`,
        ...raSteps,
        '',
        `  └ Result: φ_m = ${phiM.toFixed(4)} ${zeta < 0 ? '(< 1 → unstable, efficient turbulent exchange)' : zeta === 0 ? '(= 1, neutral)' : '(> 1 → stable, mixing suppressed)'}`,
      ],
    };
  },
  49: ({ ustar, z, z0, rho, __ustarSource, __z0Source }) => {
    const kappa = 0.4;
    if (!Number.isFinite(ustar) || !Number.isFinite(z0) || z0 <= 0 || z <= z0 || ustar <= 0) {
      return {
        result: Number.NaN, unit: 'm/s',
        secondary: [
          { key: 'friction_velocity', value: Number.isFinite(ustar) ? ustar : Number.NaN, unit: 'm/s', label: 'Friction Velocity u_*' },
          { key: 'roughness_reynolds', value: Number.NaN, unit: '—', label: 'Roughness Reynolds Number Re_*' },
        ],
        steps: [
          '── Logarithmic Wind Profile (Stull 1988 Ch. 4; Prandtl log law, 1932) ──',
          'u(z) = (u_*/κ) · ln(z/z₀),  κ = 0.4, neutral stratification',
          '',
          '  ⚠ Cannot compute — a genuine input is unavailable or inconsistent:',
          ...(!Number.isFinite(ustar) || ustar <= 0 ? [`    u_* = ${Number.isFinite(ustar) ? (ustar <= 0 ? '≤ 0' : ustar) : 'NaN'} — ${typeof __ustarSource === 'string' ? __ustarSource : 'no genuine friction velocity; supply u_* or a study point'}`] : []),
          ...(!Number.isFinite(z0) || z0 <= 0 ? [`    z₀ = ${Number.isFinite(z0) ? z0 : 'NaN'} — ${typeof __z0Source === 'string' ? __z0Source : 'no genuine roughness length'}`] : []),
          ...(Number.isFinite(z0) && z0 > 0 && z <= z0 ? [`    z = ${z} m ≤ z₀ = ${z0.toFixed(3)} m — outside the log-law domain (needs z ≫ z₀)`] : []),
        ],
      };
    }
    const u = (ustar / kappa) * Math.log(z / z0);
    const logTerm = Math.log(z / z0);
    const z0class = z0 < 0.001 ? 'SMOOTH (water/ice/flat bare soil)' : z0 <= 0.05 ? 'LOW GRASS / SHORT CROP' : z0 < 0.3 ? 'TALL CROP / SCRUB' : z0 < 1 ? 'FOREST / URBAN' : 'COMPLEX TERRAIN';
    // Catalogue secondary outputs — computed here honestly:
    //  C_d(z) = (κ/ln(z/z₀))²  (drag coefficient at height z, neutral)
    //  P(z)   = ½·ρ·u³         (wind power density; ρ from genuine ambient
    //          pressure/temperature state when available — no static 1.2)
    //  Re_*   = u_*·z₀/ν        (roughness Reynolds number; ν air at ~15 °C)
    const Cd = (kappa / logTerm) ** 2;
    const nuAir = 1.46e-5; // m²/s kinematic viscosity of air (~15 °C)
    const ReStar = (ustar * z0) / nuAir;
    let P = Number.NaN;
    let powerSteps: string[] = [];
    if (Number.isFinite(rho) && rho > 0.1) {
      P = 0.5 * rho * u ** 3;
      powerSteps = [
        '',
        'Step 4 — Secondary outputs (drag coefficient, wind power density):',
        `  C_d(z) = (κ/ln(z/z₀))² = (${kappa}/${logTerm.toFixed(4)})² = ${(Cd).toExponential(3)}`,
        `  P(z) = ½·ρ·u³ = ½ × ${rho.toFixed(3)} kg/m³ × (${u.toFixed(3)})³ = ${P.toFixed(1)} W/m²  (ρ from genuine ambient state)`,
      ];
    }
    // Profile series — u(z) across heights from 2·z₀ to 200 m (log spacing).
    const seriesPoints: Array<{ x: number; y: number }> = [];
    const zBottom = z0 * 2, zTop = 200;
    for (let i = 0; i <= 40; i++) {
      const h = zBottom * Math.pow(zTop / zBottom, i / 40);
      const uH = (ustar / kappa) * Math.log(h / z0);
      seriesPoints.push({ x: h, y: Number.isFinite(uH) ? uH : Number.NaN });
    }
    return {
      result: u, unit: 'm/s',
      secondary: [
        { key: 'friction_velocity', value: Number.isFinite(ustar) ? ustar : Number.NaN, unit: 'm/s', label: 'Friction Velocity u_*' },
        { key: 'roughness_reynolds', value: Number.isFinite(ReStar) ? ReStar : Number.NaN, unit: '—', label: 'Roughness Reynolds Number Re_*' },
        { key: 'drag_coefficient', value: Number.isFinite(Cd) ? Cd : Number.NaN, unit: '—', label: 'Drag Coefficient C_d(z)' },
        ...(Number.isFinite(P) ? [{ key: 'wind_power_density', value: P, unit: 'W/m²', label: 'Wind Power Density P(z)' }] : []),
      ],
      series: [{
        label: 'u(z) log wind',
        color: '#E69F00',
        points: seriesPoints,
      }],
      steps: [
        '── Logarithmic Wind Profile (Stull 1988 Ch. 4; Prandtl log law, 1932) ──',
        'Neutral surface layer: τ = ρ·u_*² constant, K_m = κ·u_*·z → ∂ū/∂z = u_*/(κz)',
        `Inputs: u_* = ${ustar.toFixed(3)} m/s, z = ${z.toFixed(1)} m, z₀ = ${z0.toFixed(4)} m, κ = ${kappa}`,
        ...(typeof __ustarSource === 'string' ? [`Provenance: ${__ustarSource}`] : []),
        ...(typeof __z0Source === 'string' ? [`Provenance: ${__z0Source}`] : []),
        '',
        'Step 1 — Compute log ratio:',
        `  ln(z/z₀) = ln(${z.toFixed(1)} / ${z0.toFixed(4)}) = ${logTerm.toFixed(4)}`,
        '',
        'Step 2 — Compute wind speed:',
        `  u(z) = (u_*/κ) × ln(z/z₀) = (${ustar.toFixed(3)}/${kappa}) × ${logTerm.toFixed(4)}`,
        `  u(${z.toFixed(1)} m) = ${u.toFixed(3)} m/s (${(u * 3.6).toFixed(2)} km/h)`,
        '',
        'Step 3 — Surface classification:',
        `  z₀ = ${z0.toFixed(4)} m → ${z0class}`,
        ...powerSteps,
        '',
        '  └ Neutral stability assumed — stable/unstable conditions require MO correction via ψ_m(ζ) (tool 48)',
        '  └ Valid within the constant-flux layer: z ≫ z₀ (typically z ≥ 5×z₀) and z ≲ 0.1·z_i',
      ]
    };
  },
  50: ({ g0, a1, A, hs, cs }) => {
    if (![g0, a1, A, hs, cs].every(Number.isFinite)) {
      return {
        result: NaN, unit: 'mmol/m²s',
        secondary: [
          { key: 'assimilation', value: Number.isFinite(A) ? A : Number.NaN, unit: 'µmol/m²s', label: 'Net Carbon Assimilation A' },
          { key: 'intercellular_co2', value: Number.NaN, unit: 'ppm', label: 'Intercellular CO₂ c_i' },
          { key: 'transpiration', value: Number.NaN, unit: 'mmol/m²s', label: 'Transpiration E' },
        ],
        steps: [
          '── Ball-Berry Stomatal Conductance Model (Ball et al., 1987; Leuning, 1995) ──',
          'Honest NaN — a required genuine input could not be resolved.',
          `  g₀ = ${g0} mmol/m²s (auto 0 — paper intercept ≈ origin)`,
          `  a₁ = ${a1} (auto 9.31 — paper Fig. 1B Glycine max fit)`,
          `  A = ${A} µmol CO₂/m²s (auto MODIS MOD17A2H GPP via ORNL DAAC)`,
          `  h_s = ${hs} (auto ERA5 2 m relative humidity / 100)`,
          `  c_s = ${cs} µmol/mol (auto NOAA GML global monthly mean)`,
          '',
          'No static constant is substituted for any missing genuine source —',
          'supply explicit leaf-level measurements (e.g. cuvette A and c_s) to',
          'override, or retry when the remote source is reachable.',
        ],
      };
    }
    // Ball-Berry: g [mol/m²s] = g₀/1000 + a₁·A·h_s/c_s (A·h_s/c_s has
    // µmol·µmol⁻¹·mol = mol dimensions; g₀ input is mmol). Report mmol/m²s.
    const gMol = g0 / 1000 + a1 * A * hs / cs;
    const gs = gMol * 1000;
    // Secondary outputs (catalogue): E = g·D/P (mole-fraction gradient,
    // g in mol/m²s, D and P in kPa) and WUE = A/E. Reference D = 1.2 kPa,
    // P = 101.3 kPa when the caller does not supply a live state.
    const D = 1.2, P = 101.3;
    const E = gMol * D / P;                    // mol/m²s
    const Emmol = E * 1000;                    // mmol/m²s
    const WUE = A / Emmol;                     // µmol/mmol
    // Intercellular CO₂ via Fick's first law, g_c(CO₂) = g_s/1.6 (CO₂
    // diffuses slower than H₂O): A = g_c·(c_s − c_i) → c_i = c_s − 1.6·A/g_s.
    const ci = gMol > 0 ? cs - (1.6 * A) / gMol : Number.NaN;
    return {
      result: gs, unit: 'mmol/m²s',
      secondary: [
        { key: 'assimilation', value: Number.isFinite(A) ? A : Number.NaN, unit: 'µmol/m²s', label: 'Net Carbon Assimilation A' },
        { key: 'intercellular_co2', value: Number.isFinite(ci) ? ci : Number.NaN, unit: 'ppm', label: 'Intercellular CO₂ c_i (Fick, g_c = g_s/1.6)' },
        { key: 'transpiration', value: Number.isFinite(Emmol) ? Emmol : Number.NaN, unit: 'mmol/m²s', label: 'Transpiration E' },
        { key: 'water_use_efficiency', value: Number.isFinite(WUE) ? WUE : Number.NaN, unit: 'µmol/mmol', label: 'Water-Use Efficiency A/E' },
      ],
      steps: [
        '── Ball-Berry Stomatal Conductance Model (Ball et al., 1987; Leuning, 1995) ──',
        `Residual stomatal conductance g₀ = ${g0.toFixed(3)} mmol/m²s`,
        `Slope parameter a₁ = ${a1.toFixed(3)} (Ball-Berry) / g₁ (Leuning)`,
        `Assimilation rate A = ${A.toFixed(2)} µmol CO₂/m²s`,
        `Humidity at leaf surface h_s = ${hs.toFixed(2)} (fractional relative humidity)`,
        `CO₂ concentration at leaf surface c_s = ${cs.toFixed(1)} ppm`,
        '',
        'Step 1 — Compute Ball-Berry index:',
        `  Ball index = A × h_s / c_s = ${A.toFixed(2)} × ${hs.toFixed(2)} / ${cs.toFixed(1)} = ${(A * hs / cs).toFixed(4)} (mol m⁻² s⁻¹)`,
        '',
        'Step 2 — Compute stomatal conductance:',
        `  g [mol/m²s] = g₀/1000 + a₁ × A × h_s / c_s`,
        `  g = ${(g0 / 1000).toFixed(4)} + ${a1.toFixed(3)} × ${(A * hs / cs).toFixed(4)} = ${gMol.toFixed(4)} mol/m²s`,
        `  g_s = ${gs.toFixed(2)} mmol/m²s (×1000)`,
        '',
        'Step 3 — Secondary outputs:',
        `  Transpiration E = g·D/P = ${gMol.toFixed(4)} × ${D} / ${P} = ${Emmol.toFixed(2)} mmol/m²s (reference D = ${D} kPa, P = ${P} kPa)`,
        `  WUE = A/E = ${A.toFixed(2)} / ${Emmol.toFixed(2)} = ${WUE.toFixed(2)} µmol/mmol`,
        `  Intercellular CO₂ c_i = c_s − 1.6·A/g_s = ${cs.toFixed(1)} − 1.6×${A.toFixed(2)}/${gMol.toFixed(4)} = ${Number.isFinite(ci) ? ci.toFixed(1) : 'NaN'} ppm (g_c = g_s/1.6)`,
        '',
        'Step 4 — Physiological interpretation:',
        `  ${gs < 50 ? 'Near-closed stomata — water conservation or stress response' : gs < 150 ? 'Moderate conductance — suboptimal conditions' : gs < 400 ? 'Typical midday conductance for C₃ plants' : 'High conductance — optimal conditions, high GPP potential'}`,
      ]
    };
  },

};
