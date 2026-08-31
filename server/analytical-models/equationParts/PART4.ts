/**
 * PART4 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import { G_GRAV, gamma } from '../equationShared';
import type { ComputeFn } from '../equationShared';

export const PART4: Record<number, ComputeFn> = {

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
    const cN = Number(c);
    const AN = Number(A);
    const hN = Number(h);
    if (!Number.isFinite(cN) || !Number.isFinite(AN) || !Number.isFinite(hN) || AN <= 0) {
      return {
        result: Number.NaN, unit: 'km',
        secondary: [
          { key: 'hack_exponent', value: Number.isFinite(hN) ? hN : Number.NaN, unit: '—', label: 'Hack exponent h (typically 0.55–0.7)' },
          { key: 'coefficient', value: Number.isFinite(cN) ? cN : Number.NaN, unit: 'km^(1−h)', label: 'Scaling coefficient c' },
        ],
        steps: [
          '── Hack\'s Law (Hack, 1957) ──',
          'One or more inputs are non-finite, or A ≤ 0 — cannot compute.',
          'Supply c (coefficient), A (km²), h (Hack exponent).',
        ],
      };
    }
    const L = cN * Math.pow(AN, hN);
    return {
      result: L, unit: 'km',
      secondary: [
        { key: 'hack_exponent', value: hN, unit: '—', label: 'Hack exponent h (typically 0.55–0.7)' },
        { key: 'coefficient', value: cN, unit: 'km^(1−h)', label: 'Scaling coefficient c' },
      ],
      // Scatter series (tool vizType 'scatter'): L vs drainage area A over
      // 1–10000 km² (15 log-spaced points) from the tool's own power law
      // L = c·A^h (linear on a log-log plot).
      series: [{
        label: `Hack's law L = ${cN.toFixed(3)}·A^${hN.toFixed(3)}`,
        color: '#0072B2',
        points: Array.from({ length: 15 }, (_, i) => {
          const A = Math.pow(10000, i / 14); // 1 → 10000 km², log-spaced
          const Lval = cN * Math.pow(A, hN);
          return { x: A, y: Number.isFinite(Lval) ? Lval : Number.NaN };
        }),
      }],
      steps: [
        '── Hack\'s Law (Hack, 1957) ──',
        `Coefficient c = ${cN.toFixed(3)}, Drainage area A = ${AN.toFixed(1)} km²`,
        `Scaling exponent h = ${hN.toFixed(3)} (Hack exponent, typically 0.55–0.7)`,
        '',
        'Step 1 — Compute main channel length:',
        `  L = c × A^h = ${cN.toFixed(3)} × ${AN.toFixed(1)}^{${hN.toFixed(3)}}`,
        `  L = ${L.toFixed(2)} km`,
        '',
        'Step 2 — Hack exponent interpretation:',
        `  h = ${hN.toFixed(3)} → ${hN < 0.55 ? 'Low exponent — compact drainage basin' : hN < 0.7 ? 'Typical exponent — self-similar network' : 'High exponent — elongated basin'}`,
        '',
        `  └ Hack's Law implies log(L) ∝ h·log(A); linear on log-log plot`,
        `  └ c depends on network geometry: ${cN < 1 ? 'low coefficient ~ dendritic network on low slope' : cN > 3 ? 'high coefficient ~ strongly elongated' : 'moderate coefficient'}`,
      ]
    };
  },
  83: ({ L1, s1, L2, s2 }) => {
    // Richardson (1961) two-point fractal dimension:
    //   L(s) = c · s^(1-D)  ⇒  D = 1 − ln(L₁/L₂) / ln(s₁/s₂)
    // Two measurements at different ruler scales (s₁, L₁) and (s₂, L₂)
    // eliminate the unknown constant c.
    const L1N = Number(L1), s1N = Number(s1), L2N = Number(L2), s2N = Number(s2);
    if (!Number.isFinite(L1N) || !Number.isFinite(s1N) || !Number.isFinite(L2N) || !Number.isFinite(s2N) || L1N <= 0 || s1N <= 0 || L2N <= 0 || s2N <= 0) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'hurst_exponent', value: Number.NaN, unit: '—', label: 'Hurst exponent H = 2 − D (persistence measure)' },
          { key: 'complexity_class', value: Number.NaN, unit: '—', label: 'N/A' },
        ],
        steps: [
          '── Richardson Fractal Dimension (Richardson 1961; Mandelbrot 1967) ──',
          'One or more inputs are non-finite or non-positive — cannot compute.',
          'Supply two (length L, ruler scale s) measurement pairs with L, s > 0.',
        ],
      };
    }
    const lnRatioL = Math.log(L1N / L2N);
    const lnRatioS = Math.log(s1N / s2N);
    const D = (Math.abs(lnRatioS) < 1e-12)
      ? Number.NaN
      : 1 - lnRatioL / lnRatioS;
    const Hurst = Number.isFinite(D) ? 2 - D : Number.NaN;
    const complexityClass = Number.isFinite(D)
      ? D < 1.1 ? 'Low — smooth, depositional coast (barrier islands, sandy beaches)'
        : D < 1.3 ? 'Moderate — typical embayed coast (Atlantic-style irregular shoreline)'
        : D < 1.5 ? 'High — rough, indented coast (ria coast, highly irregular)'
        : 'Very high — fjord coast or strongly space-filling boundary'
      : null;
    return {
      result: D, unit: '—',
      secondary: [
        { key: 'hurst_exponent', value: Hurst, unit: '—', label: 'Hurst exponent H = 2 − D (persistence measure)' },
        { key: 'complexity_class', value: Number.isFinite(D) ? D : Number.NaN, unit: '—', label: complexityClass ?? 'N/A' },
      ],
      steps: [
        '── Richardson Fractal Dimension (Richardson 1961; Mandelbrot 1967) ──',
        `Measurement 1: L₁ = ${L1N.toFixed(1)} km at ruler scale s₁ = ${s1N.toFixed(1)} km`,
        `Measurement 2: L₂ = ${L2N.toFixed(1)} km at ruler scale s₂ = ${s2N.toFixed(1)} km`,
        '',
        'Step 1 — Richardson power law: L(s) = c · s^(1−D)',
        '  Taking logs of two measurements eliminates the unknown c:',
        `  D = 1 − ln(L₁/L₂) / ln(s₁/s₂)`,
        '',
        'Step 2 — Compute log ratios:',
        `  ln(L₁/L₂) = ln(${L1N.toFixed(1)}/${L2N.toFixed(1)}) = ${lnRatioL.toFixed(4)}`,
        `  ln(s₁/s₂) = ln(${s1N.toFixed(1)}/${s2N.toFixed(1)}) = ${lnRatioS.toFixed(4)}`,
        '',
        'Step 3 — Fractal dimension:',
        `  D = 1 − ${lnRatioL.toFixed(4)} / ${lnRatioS.toFixed(4)} = ${Number.isFinite(D) ? D.toFixed(4) : 'N/A'}`,
        '',
        'Step 4 — Interpretation:',
        `  ${complexityClass ?? 'N/A (degenerate: s₁ ≈ s₂)'}`,
        `  Hurst exponent H = 2 − D = ${Number.isFinite(Hurst) ? Hurst.toFixed(4) : 'N/A'}`,
        '',
        '  └ Theoretical range: 1 ≤ D ≤ 2; D = 1 for straight line, D = 2 for space-filling',
        '  └ Richardson (1961) data: South Africa D≈1.02, Australia D≈1.13, Britain D≈1.24, Norway D≈1.52',
      ]
    };
  },
  84: ({ cprime, gammaz, z: _z, cosB, u, phiP: _phiP, tanphi, sinB, cosB2 }) => {
    // Infinite-slope factor of safety (Taylor 1948; Duncan & Wright 2005):
    //   FS = [c' + (γz·cos²β − u)·tanφ'] / (γz·sinβ·cosβ)
    // The normal-stress term uses cos²β (the cosB2 parameter), not cosβ.
    const cprimeN = Number(cprime), gammazN = Number(gammaz), cosBN = Number(cosB), uN = Number(u), tanphiN = Number(tanphi), sinBN = Number(sinB), cosB2N = Number(cosB2);
    if (!Number.isFinite(cprimeN) || !Number.isFinite(gammazN) || !Number.isFinite(cosBN) || !Number.isFinite(uN) || !Number.isFinite(tanphiN) || !Number.isFinite(sinBN) || !Number.isFinite(cosB2N)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'friction_angle', value: Number.isFinite(tanphiN) ? Math.atan(tanphiN) * 180 / Math.PI : Number.NaN, unit: '°', label: 'Effective friction angle φ′ = atan(tanφ′)' },
          { key: 'normal_stress', value: (Number.isFinite(gammazN) && Number.isFinite(cosB2N) && Number.isFinite(uN)) ? gammazN * cosB2N - uN : Number.NaN, unit: 'kPa', label: 'Effective normal stress σ′_n = γz·cos²β − u' },
        ],
        steps: [
          '── Infinite Slope Stability (Taylor, 1948; Duncan & Wright, 2005) ──',
          'One or more inputs are non-finite — cannot compute.',
          'Supply c′, γz, cosβ, cos²β, sinβ, u, tanφ′.',
        ],
      };
    }
    const num = cprimeN + (gammazN * cosB2N - uN) * tanphiN;
    const den = gammazN * sinBN * cosBN;
    const FS = den !== 0 ? num / den : Infinity;
    const normalStress = gammazN * cosB2N - uN;
    return {
      result: FS, unit: '—',
      secondary: [
        { key: 'friction_angle', value: Math.atan(tanphiN) * 180 / Math.PI, unit: '°', label: 'Effective friction angle φ′ = atan(tanφ′)' },
        { key: 'normal_stress', value: normalStress, unit: 'kPa', label: 'Effective normal stress σ′_n = γz·cos²β − u' },
      ],
      steps: [
        '── Infinite Slope Stability (Taylor, 1948; Duncan & Wright, 2005) ──',
        `Effective cohesion c' = ${cprimeN.toFixed(2)} kPa`,
        `Soil unit weight γz = ${gammazN.toFixed(2)} kN/m³, cosβ = ${cosBN.toFixed(4)}`,
        `Pore pressure u = ${uN.toFixed(2)} kPa, tanφ' = ${tanphiN.toFixed(4)}`,
        `sinβ = ${sinBN.toFixed(4)}, cos²β = ${cosB2N.toFixed(4)}`,
        '',
        'Step 1 — Compute resisting (shear strength) term:',
        `  numerator = c' + (γz·cos²β − u)·tanφ'`,
        `  = ${cprimeN.toFixed(2)} + (${gammazN.toFixed(2)}×${cosB2N.toFixed(4)} − ${uN.toFixed(2)})×${tanphiN.toFixed(4)}`,
        `  = ${num.toFixed(4)} kPa`,
        '',
        'Step 2 — Compute driving (shear stress) term:',
        `  denominator = γz·sinβ·cosβ = ${gammazN.toFixed(2)} × ${sinBN.toFixed(4)} × ${cosBN.toFixed(4)}`,
        `  = ${den.toFixed(4)} kPa`,
        '',
        'Step 3 — Factor of Safety:',
        `  FS = ${num.toFixed(4)} / ${den.toFixed(4)} = ${Number.isFinite(FS) ? FS.toFixed(3) : 'N/A'}`,
        '',
        'Step 4 — Stability classification:',
        `  ${FS >= 1.5 ? 'STABLE — adequate factor of safety' : FS >= 1.25 ? 'MARGINALLY STABLE — monitor / minor remediation' : FS >= 1.0 ? 'NEARLY FAILING — requires detailed investigation' : 'FAILURE (FS < 1) — slope instable, remediation required'}`,
        '',
        `  └ Critical slip surface assumed planar and parallel to slope (infinite slope assumption valid when depth << length)`,
      ]
    };
  },
  85: ({ mu, sigmaN, xi, rho, velocity }) => {
    // Voellmy (1955) friction model for rapid granular flows:
    //   τ = μ·σ_n + ρ·g·u²/ξ
    // τ_C = μ·σ_n (dry Coulomb)  +  τ_t = ρ·g·u²/ξ (turbulent drag)
    const muN = Number(mu), sigmaNN = Number(sigmaN), xiN = Number(xi), rhoN = Number(rho), velocityN = Number(velocity);
    if (!Number.isFinite(muN) || !Number.isFinite(sigmaNN) || !Number.isFinite(xiN) || !Number.isFinite(rhoN) || !Number.isFinite(velocityN) || xiN === 0) {
      return {
        result: Number.NaN, unit: 'Pa',
        secondary: [
          { key: 'coulomb_friction', value: Number.NaN, unit: 'Pa', label: 'Coulomb term τ_C = μσ_n' },
          { key: 'turbulent_drag', value: Number.NaN, unit: 'Pa', label: 'Turbulent term τ_t = ρgu²/ξ' },
          { key: 'fraction_turbulent', value: Number.NaN, unit: '—', label: 'Fraction from turbulent term' },
          { key: 'apparent_friction', value: Number.NaN, unit: '—', label: 'Apparent friction μ_app = μ + ρgu²/(ξσ_n)' },
          { key: 'normal_stress', value: Number.isFinite(sigmaNN) ? sigmaNN : Number.NaN, unit: 'Pa', label: 'Normal stress σ_n' },
        ],
        steps: [
          '── Voellmy Friction Model (Voellmy 1955; Savage & Hutter 1989) ──',
          'One or more inputs are non-finite, or ξ = 0 — cannot compute.',
          'Supply μ, σ_n, ξ, ρ, u.',
        ],
      };
    }
    const g = G_GRAV;
    const tauC = muN * sigmaNN;
    const tauT = (rhoN * g * velocityN * velocityN) / xiN;
    const tau = tauC + tauT;
    const fraction_turbulent = tau > 0 ? tauT / tau : 0;
    const mu_app = sigmaNN > 0 ? muN + (rhoN * g * velocityN * velocityN) / (xiN * sigmaNN) : muN;
    return {
      result: tau, unit: 'Pa',
      secondary: [
        { key: 'coulomb_friction', value: tauC, unit: 'Pa', label: 'Coulomb term τ_C = μσ_n' },
        { key: 'turbulent_drag', value: tauT, unit: 'Pa', label: 'Turbulent term τ_t = ρgu²/ξ' },
        { key: 'fraction_turbulent', value: fraction_turbulent, unit: '—', label: 'Fraction from turbulent term' },
        { key: 'apparent_friction', value: mu_app, unit: '—', label: 'Apparent friction μ_app = μ + ρgu²/(ξσ_n)' },
        { key: 'normal_stress', value: sigmaNN, unit: 'Pa', label: 'Normal stress σ_n' },
      ],
      steps: [
        '── Voellmy Friction Model (Voellmy 1955; Savage & Hutter 1989) ──',
        `Coulomb friction μ = ${muN.toFixed(4)}, Normal stress σ_n = ${sigmaNN.toFixed(2)} Pa`,
        `Flow velocity u = ${velocityN.toFixed(2)} m/s, Density ρ = ${rhoN.toFixed(0)} kg/m³`,
        `Turbulence parameter ξ = ${xiN.toFixed(1)} m/s²`,
        '',
        'Step 1 — Coulomb friction term:',
        `  τ_C = μ × σ_n = ${muN.toFixed(4)} × ${sigmaNN.toFixed(2)} = ${tauC.toFixed(2)} Pa`,
        '',
        'Step 2 — Turbulent drag term:',
        `  τ_t = ρ·g·u²/ξ = ${rhoN.toFixed(0)} × ${g.toFixed(2)} × ${velocityN.toFixed(2)}² / ${xiN.toFixed(1)} = ${tauT.toFixed(2)} Pa`,
        '',
        'Step 3 — Total shear stress:',
        `  τ = τ_C + τ_t = ${tauC.toFixed(2)} + ${tauT.toFixed(2)} = ${tau.toFixed(2)} Pa`,
        `  Apparent friction μ_app = ${mu_app.toFixed(4)} (effective μ at velocity ${velocityN.toFixed(1)} m/s)`,
        `  Turbulent fraction: ${(fraction_turbulent * 100).toFixed(1)}%`,
        '',
        'Step 4 — Interpretation:',
        `  ${velocityN < 1 ? 'Low velocity — Coulomb friction dominates (>99% of τ)' : velocityN < 10 ? 'Moderate velocity — both terms contribute' : 'High velocity — turbulent drag dominates (avalanche/debris-flow regime)'}`,
        `  Steady uniform flow: u_eq = √(ξ·h·(sinβ − μ·cosβ))`,
        `  Friction angle φ = atan(μ) = ${(Math.atan(muN) * 180 / Math.PI).toFixed(1)}°`,
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
    // Meyer (1915) mass-transfer evaporation:
    //   E = K_m · (e_w − e_a) · (1 + u/16)
    // Wind function (1 + u/16) — the classic Meyer wind correction.
    const KmN = Number(Km), ewN = Number(ew), eaN = Number(ea), uN = Number(u);
    if (!Number.isFinite(KmN) || !Number.isFinite(ewN) || !Number.isFinite(eaN) || !Number.isFinite(uN)) {
      return {
        result: Number.NaN, unit: 'mm/day',
        secondary: [
          { key: 'vapor_pressure_deficit', value: (Number.isFinite(ewN) && Number.isFinite(eaN)) ? ewN - eaN : Number.NaN, unit: 'kPa', label: 'Vapour pressure deficit (e_w − e_a)' },
          { key: 'wind_factor', value: Number.isFinite(uN) ? 1 + uN / 16 : Number.NaN, unit: '—', label: 'Wind function (1 + u/16)' },
        ],
        steps: [
          '── Lake Evaporation (Meyer, 1915) ──',
          'One or more inputs are non-finite — cannot compute.',
          'Supply K_m, e_w, e_a, u.',
        ],
      };
    }
    const vpDeficit = ewN - eaN;
    const windFactor = 1 + uN / 16;
    const E = KmN * vpDeficit * windFactor;
    return {
      result: E, unit: 'mm/day',
      secondary: [
        { key: 'vapor_pressure_deficit', value: vpDeficit, unit: 'kPa', label: 'Vapour pressure deficit (e_w − e_a)' },
        { key: 'wind_factor', value: windFactor, unit: '—', label: 'Wind function (1 + u/16)' },
      ],
      steps: [
        '── Lake Evaporation (Meyer, 1915) ──',
        `Mass transfer coefficient K_m = ${KmN.toFixed(4)} mm/day·kPa`,
        `Saturation vapour pressure e_w = ${ewN.toFixed(2)} kPa`,
        `Actual vapour pressure e_a = ${eaN.toFixed(2)} kPa`,
        `Wind speed at 2 m height u = ${uN.toFixed(1)} m/s`,
        '',
        'Step 1 — Vapour pressure deficit:',
        `  e_w − e_a = ${ewN.toFixed(2)} − ${eaN.toFixed(2)} = ${vpDeficit.toFixed(2)} kPa`,
        '',
        'Step 2 — Wind function:',
        `  (1 + u/16) = (1 + ${uN.toFixed(1)}/16) = ${windFactor.toFixed(3)}`,
        '',
        'Step 3 — Compute evaporation:',
        `  E = K_m × (e_w−e_a) × (1+u/16)`,
        `  E = ${KmN.toFixed(4)} × ${vpDeficit.toFixed(2)} × ${windFactor.toFixed(3)}`,
        `  E = ${E.toFixed(2)} mm/day`,
        '',
        `  └ ${E > 6 ? 'Very high evaporation — arid/warm, open water' : E > 3 ? 'High evaporation — summer conditions' : E > 1 ? 'Moderate evaporation — typical temperate lake' : 'Low evaporation — cool/humid conditions'}`,
        `  └ Equivalent energy flux: LE = ρ·L_v·E = ${(1000 * 2.45e6 * E / 1000 / 86400).toFixed(0)} W/m²`,
      ]
    };
  },
  89: ({ A: _A, z, rms, rhoProfile, dzProfile, zProfile, areaProfile }) => {
    // Schmidt (1928) lake stability:
    //   S = (g/A₀)·∫ A(z)·(z − z_v)·ρ(z) dz        (full depth integral)
    //   S ≈ g·rms(Δρ)·z_v                          (one-layer proxy)
    // When a layered density profile is supplied (rhoProfile + dzProfile
    // arrays), the depth integral is summed directly over the layers.
    const A = Number(_A);
    const zN = Number(z);
    const rmsN = Number(rms);
    const hasLayers = Array.isArray(rhoProfile) && Array.isArray(dzProfile)
      && rhoProfile.length === dzProfile.length && rhoProfile.length >= 1
      && rhoProfile.every((r: unknown) => Number.isFinite(Number(r)))
      && dzProfile.every((d: unknown) => Number.isFinite(Number(d)) && Number(d) > 0);

    if (hasLayers) {
      const rhoN = (rhoProfile as unknown[]).map((r) => Number(r));
      const dzN = (dzProfile as unknown[]).map((d) => Number(d));
      const n = rhoN.length;
      const zMid: number[] = Array.isArray(zProfile) && zProfile.length === n
        ? (zProfile as unknown[]).map((zp) => Number(zp))
        : (() => {
            const mids: number[] = [];
            let cum = 0;
            for (let i = 0; i < n; i++) { mids.push(cum + dzN[i] / 2); cum += dzN[i]; }
            return mids;
          })();
      const A0 = Number.isFinite(A) && A > 0 ? A : 1;
      const A_i: number[] = Array.isArray(areaProfile) && areaProfile.length === n
        ? (areaProfile as unknown[]).map((a) => Number(a))
        : Array(n).fill(A0);
      let volSum = 0, zVol = 0;
      for (let i = 0; i < n; i++) { volSum += A_i[i] * dzN[i]; zVol += zMid[i] * A_i[i] * dzN[i]; }
      const z_v = volSum > 0 ? zVol / volSum : Number.NaN;
      let S = 0;
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(z_v)) S += (zMid[i] - z_v) * rhoN[i] * A_i[i] * dzN[i];
      }
      S = Number.isFinite(S) ? (G_GRAV / A0) * S : Number.NaN;
      let thermoIdx = 0, maxGrad = -Infinity;
      for (let i = 0; i < n - 1; i++) {
        const grad = Math.abs(rhoN[i + 1] - rhoN[i]) / Math.max(dzN[i + 1], dzN[i], 1e-9);
        if (grad > maxGrad) { maxGrad = grad; thermoIdx = i; }
      }
      const thermocline = n > 1 ? (zMid[thermoIdx] + zMid[thermoIdx + 1]) / 2 : z_v;
      const seriesPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) seriesPoints.push({ x: zMid[i], y: Number.isFinite(rhoN[i]) ? rhoN[i] : Number.NaN });
      const cumPoints: Array<{ x: number; y: number }> = [];
      let cum = 0;
      for (let i = 0; i < n; i++) {
        cum += Number.isFinite(z_v) ? (G_GRAV / A0) * (zMid[i] - z_v) * rhoN[i] * A_i[i] * dzN[i] : Number.NaN;
        cumPoints.push({ x: zMid[i], y: cum });
      }
      return {
        result: S, unit: 'J/m²',
        secondary: [
          { key: 'lake_area', value: Number.isFinite(A0) ? A0 : Number.NaN, unit: 'm²', label: 'Lake surface area A₀' },
          { key: 'thermocline_depth', value: Number.isFinite(thermocline) ? thermocline : Number.NaN, unit: 'm', label: 'Thermocline depth (max density gradient)' },
          { key: 'center_volume_depth', value: Number.isFinite(z_v) ? z_v : Number.NaN, unit: 'm', label: 'Depth to centre of volume z_v' },
        ],
        series: [
          { label: 'Density profile ρ(z)', color: '#0072B2', points: seriesPoints },
          { label: 'Cumulative stability S(z)', color: '#009E73', points: cumPoints },
        ],
        steps: [
          '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
          `Layered density profile: ${n} layers (A₀ = ${A0.toFixed(0)} m²)`,
          '',
          'Step 1 — Depth to centre of volume:',
          `  z_v = Σ z_i·A_i·Δz_i / Σ A_i·Δz_i = ${Number.isFinite(z_v) ? z_v.toFixed(2) : 'N/A'} m`,
          '',
          'Step 2 — Sum the depth integral:',
          `  S = (g/A₀)·Σ (z_i − z_v)·ρ_i·A_i·Δz_i`,
          `  S = ${Number.isFinite(S) ? S.toFixed(1) : 'N/A'} J/m²`,
          '',
          'Step 3 — Thermocline location:',
          `  Max density gradient at z ≈ ${Number.isFinite(thermocline) ? thermocline.toFixed(1) : 'N/A'} m`,
          '',
          `  └ ${S > 500 ? 'Strongly stratified — resistant to mixing (deep temperate lake in summer)' : S > 100 ? 'Moderately stratified — seasonal thermocline present' : S > 20 ? 'Weakly stratified — polymictic or frequent turnover' : 'Near-mixed — continuous vertical exchange (shallow/polymictic)'}`,
          `  └ Required wind work to completely mix lake: W ≈ S × A₀ (total energy in J)`,
        ],
      };
    }

    if (!Number.isFinite(zN) || !Number.isFinite(rmsN) || zN <= 0) {
      return {
        result: Number.NaN, unit: 'J/m²',
        secondary: [
          { key: 'lake_area', value: Number.isFinite(A) ? A : Number.NaN, unit: 'm²', label: 'Lake surface area A₀' },
          { key: 'thermocline_depth', value: Number.isFinite(zN) ? zN : Number.NaN, unit: 'm', label: 'Thermocline depth (one-layer proxy: z_v)' },
        ],
        steps: [
          '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
          'One or more inputs are non-finite, or z ≤ 0 — cannot compute.',
          'Supply A (m²), z_v (m), rms(Δρ) (kg/m³), or a layered density profile (rhoProfile + dzProfile).',
        ],
      };
    }
    const S = G_GRAV * rmsN * zN;
    const cumPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const zPrime = (zN * i) / 40;
      cumPoints.push({ x: zPrime, y: G_GRAV * rmsN * zPrime });
    }
    return {
      result: S, unit: 'J/m²',
      secondary: [
        { key: 'lake_area', value: Number.isFinite(A) ? A : Number.NaN, unit: 'm²', label: 'Lake surface area A₀' },
        { key: 'thermocline_depth', value: Number.isFinite(zN) ? zN : Number.NaN, unit: 'm', label: 'Thermocline depth (one-layer proxy: z_v)' },
      ],
      series: [{
        label: 'Cumulative stability S(z)',
        color: '#009E73',
        points: cumPoints,
      }],
      steps: [
        '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
        `Lake surface area A = ${Number.isFinite(A) ? A.toFixed(0) : 'N/A'} m²`,
        `Depth to centre of volume z_v = ${zN.toFixed(1)} m`,
        `Root-mean-square density difference rms(Δρ) = ${rmsN.toExponential(3)} kg/m³`,
        '',
        'Step 1 — Compute stability:',
        `  S = g × A₀⁻¹ × ∫A(z)·(ρ_z−ρ_m)·(z−z_v)dz`,
        `  S ≈ g × rms(Δρ) × z_v (simplified one-layer proxy)`,
        `  S = ${G_GRAV.toFixed(3)} × ${rmsN.toExponential(3)} × ${zN.toFixed(1)}`,
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
      // Defensive numeric coercion: inputs can arrive as JSON strings from the
      // USGS-driven context engine (Nash's Q₀ is a discharge-derived volume).
      const nn = Number(n);
      const Kn = Number(K);
      const tn = Number(t);
      const Q0n = Number(Q0);
      if (!Number.isFinite(nn) || !Number.isFinite(Kn) || !Number.isFinite(tn) || !Number.isFinite(Q0n)) {
        return {
          result: Number.NaN, unit: 'm³/s',
          steps: ['── Nash Cascade Unit Hydrograph (Nash, 1957) ──',
            `One or more inputs are non-finite — cannot compute.`,
            `Supply n, K, t, Q₀ explicitly or ensure USGS data is available.`,
          ],
          secondary: [
            { key: 'time_to_peak', value: Number.NaN, unit: 'h', label: 'Time to Peak t_p' },
            { key: 'peak_outflow', value: Number.NaN, unit: 'm³/s', label: 'Peak Outflow q_p' },
            { key: 'peak_factor', value: Number.NaN, unit: '—', label: 'Dimensionless Peak Factor (q_p·K/Q₀)' },
          ],
        };
      }
      const K_n1 = Math.pow(Kn, nn - 1);
      // Γ(n) = (n−1)! for integer n; Lanczos gamma for non-integer n (the
      // frontend's methodology allows n = 1.5–2.5 for flashy catchments).
      const fact = gamma(nn);
      const q = (Math.pow(tn, nn - 1) / (K_n1 * fact)) * (1 / Kn) * Math.exp(-tn / Kn) * Q0n;
      const t_p = (nn - 1) * Kn;
      const peakFactor = t_p > 0 && nn > 1
        ? Math.pow(nn - 1, nn - 1) * Math.exp(-(nn - 1)) / gamma(nn)
        : 1;
      const q_peak = Q0n * peakFactor / Kn;
      // Full IUH hydrograph series: sample q(t) from t=0 to t_end
      const tEnd = Math.max(tn * 1.5, 5 * t_p, 5 * Kn);
      const steps = 80;
      const seriesPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const ti = (tEnd * i) / steps;
        const qi = (Math.pow(ti, nn - 1) / (Math.pow(Kn, nn - 1) * gamma(nn))) * (1 / Kn) * Math.exp(-ti / Kn) * Q0n;
        if (Number.isFinite(qi)) seriesPoints.push({ x: ti, y: qi });
      }
      return {
        result: q, unit: 'm³/s',
        series: seriesPoints.length > 0
          ? [{
              label: 'Nash IUH (outflow)',
              color: '#0072B2',
              points: seriesPoints,
            }]
          : undefined,
        secondary: [
          { key: 'time_to_peak', value: Number.isFinite(t_p) ? t_p : Number.NaN, unit: 'h', label: 'Time to Peak t_p' },
          { key: 'peak_outflow', value: Number.isFinite(q_peak) ? q_peak : Number.NaN, unit: 'm³/s', label: 'Peak Outflow q_p' },
          { key: 'peak_factor', value: Number.isFinite(peakFactor) ? peakFactor : Number.NaN, unit: '—', label: 'Dimensionless Peak Factor (q_p·K/Q₀)' },
        ],
        steps: [
          '── Nash Cascade Unit Hydrograph (Nash, 1957) ──',
          `Number of linear reservoirs n = ${nn.toFixed(1)}, Storage coefficient K = ${Kn.toFixed(2)} h`,
          `Time t = ${tn.toFixed(1)} h, Total inflow volume Q₀ = ${Q0n.toFixed(1)} m³/s·h`,
          '',
          'Step 1 — Gamma-distribution coefficients:',
          `  Γ(n) = gamma(${nn.toFixed(1)}) = ${fact.toExponential(2)}`,
          `  K^(n−1) = (${Kn.toFixed(2)})^(${nn.toFixed(1)}−1) = ${K_n1.toExponential(3)}`,
          '',
          'Step 2 — Compute IUH ordinate:',
          `  q(t) = t^(n−1) / (K^(n−1)·Γ(n)) · (1/K) · exp(−t/K) · Q₀`,
          `  q(${tn.toFixed(1)} h) = ${q.toExponential(3)} m³/s`,
          '',
          'Step 3 — Hydrograph timing:',
          `  Time to peak: t_p = (n−1)·K = ${t_p.toFixed(1)} h`,
          `  Peak outflow: q_p = ${q_peak.toExponential(3)} m³/s`,
          `  Dimensionless peak factor (q_p·K/Q₀) = ${peakFactor.toFixed(4)}`,
          '',
          `  └ Nash model: n reservoirs in series; higher n → more peaked, delayed response`,
          `  └ Quickflow only — baseflow must be added separately for total streamflow`,
        ]
      };
    },

  // ── Domain 14: Cryosphere & Volcanology ──
  91: ({ accum, DDF, Tpos, days: _days }) => {
    // Braithwaite & Olesen (1989) PDD model:
    // Ablation = DDF × T_pos  (T_pos is already the sum of positive degree-days)
    const ablation = DDF * Tpos;
    const Bn = accum - ablation;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 0; day <= 365; day += 5) {
      const frac = day / 365;
      const cumAbl = DDF * Tpos * frac;
      const cumBal = accum - cumAbl;
      seriesPoints.push({ x: day, y: Number.isFinite(cumBal) ? cumBal : Number.NaN });
    }
    return {
      result: Bn, unit: 'm w.e.',
      secondary: [
        { key: 'total_ablation', value: Number.isFinite(ablation) ? ablation : Number.NaN, unit: 'm w.e.', label: 'Total Ablation' },
      ],
      series: [{
        label: 'Cumulative mass balance',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Glacier Surface Mass Balance — PDD Model (Braithwaite & Olesen 1989; Cogley et al. 2011) ──',
        `Annual accumulation = ${accum.toFixed(2)} m w.e.`,
        `Degree-Day Factor DDF = ${DDF.toFixed(3)} m w.e./°C·day`,
        `Positive degree-days T_pos = ${Tpos.toFixed(1)} °C·day (sum over melt season)`,
        '',
        'Step 1 — Compute total ablation:',
        `  Ablation = DDF × T_pos = ${DDF.toFixed(3)} × ${Tpos.toFixed(1)}`,
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
  92: ({ K, DIFI, L }) => {
    // Stefan (1891): ALT = sqrt(2·K·DIFI_s / L)
    // DIFI is in °C·day; convert to °C·s by × 86400
    const DIFI_s = DIFI * 86400;
    const ALT = Math.sqrt((2 * K * DIFI_s) / (L || 1));
    return {
      result: ALT, unit: 'm',
      secondary: [
        { key: 'thawing_index', value: Number.isFinite(DIFI) ? DIFI : Number.NaN, unit: '°C·day', label: 'Thawing Index (DIFI)' },
      ],
      // Timeseries series (tool vizType 'timeseries'): active-layer thickness
      // ALT(DIFI) = √(2·K·DIFI·86400/L) over 0–5000 °C·day (20 points) from
      // the tool's own Stefan solution.
      series: [{
        label: 'Stefan active-layer thickness ALT(DIFI) = √(2·K·DIFI·86400/L)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const difi = i * (5000 / 19);
          const alt = Math.sqrt((2 * K * difi * 86400) / (L || 1));
          return { x: difi, y: Number.isFinite(alt) ? alt : Number.NaN };
        }),
      }],
      steps: [
        '── Stefan Active Layer Thickness (Stefan, 1891; Romanovsky & Osterkamp, 1997) ──',
        `Thermal conductivity K = ${K.toFixed(2)} W/m·K`,
        `Thawing index DIFI = ${DIFI.toFixed(0)} °C·day`,
        `  → DIFI_s = ${DIFI.toFixed(0)} × 86400 = ${DIFI_s.toFixed(0)} °C·s`,
        `Volumetric latent heat of fusion L = ${L.toExponential(2)} J/m³`,
        '',
        'Step 1 — Compute 2K·DIFI_s:',
        `  2K·DIFI_s = 2 × ${K.toFixed(2)} × ${DIFI_s.toFixed(0)} = ${(2 * K * DIFI_s).toExponential(3)}`,
        '',
        'Step 2 — Compute ALT:',
        `  ALT = √(2K·DIFI_s / L)`,
        `  ALT = √(${(2 * K * DIFI_s).toExponential(3)} / ${L.toExponential(2)})`,
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
    const closeoffTime = drho !== 0 ? (830 - rhoF) / Math.abs(drho) : Number.NaN;
    return {
      result: drho, unit: 'kg/m³/yr',
      secondary: [
        { key: 'closeoff_time', value: Number.isFinite(closeoffTime) ? closeoffTime : Number.NaN, unit: 'yr', label: 'Pore Close-Off Time' },
      ],
      // Timeseries series (tool vizType 'timeseries'): firn density ρ(t) over
      // 0–100 yr (20 points) from the tool's own exponential densification
      // ρ(t) = ρ_i − (ρ_i − ρ_f)·e^(−k·b·t).
      series: [{
        label: 'Firn density ρ(t) = ρ_i − (ρ_i−ρ_f)·e^(−k·b·t)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const t = i * (100 / 19);
          const rhoT = rhoI - (rhoI - rhoF) * Math.exp(-k * b * t);
          return { x: t, y: Number.isFinite(rhoT) ? rhoT : Number.NaN };
        }),
      }],
      steps: [
        '── Dry Snow Densification (Herron & Langway, 1980; Arthern et al., 2010) ──',
        `Rate constant k = ${k.toExponential(2)} /yr`,
        `Accumulation rate b = ${b.toFixed(2)} kg/m²/yr`,
        `Initial snow density ρ_i = ${rhoI.toFixed(1)} kg/m³`,
        `Final firn density ρ_f = ${rhoF.toFixed(1)} kg/m³`,
        '',
        'Step 1 — Compute density gradient:',
        `  ρ_i − ρ_f = ${rhoI.toFixed(1)} − ${rhoF.toFixed(1)} = ${(rhoI - rhoF).toFixed(1)} kg/m³`,
        '',
        'Step 2 — Densification rate:',
        `  dρ/dt = k × b × (ρ_i − ρ_f)`,
        `  dρ/dt = ${k.toExponential(2)} × ${b.toFixed(2)} × ${(rhoI - rhoF).toFixed(1)}`,
        `  dρ/dt = ${drho.toExponential(2)} kg/m³/yr`,
        '',
        'Step 3 — Timescale to closure (pore close-off at ρ ≈ 830 kg/m³):',
        `  Δt ≈ (830 − ${rhoF.toFixed(0)}) / |dρ/dt| = ${drho !== 0 ? ((830 - rhoF) / Math.abs(drho)).toFixed(2) : '∞'} years`,
        '',
        `  └ ${drho > 0 ? 'Compaction progressing — air volume decreasing' : 'No densification — pore space saturated or equilibrium'}`,
        `  └ Main stages: (1) settling (ρ < 550), (2) densification (550–830), (3) ice bubble closure (>830 kg/m³)`,
      ]
    };
  },
94: ({ VEI }) => {
     if (!Number.isFinite(VEI)) {
       return {
         result: Number.NaN, unit: 'km³',
         steps: ['── Volcanic Explosivity Index to Volume (Newhall & Self, 1982) ──',
           'VEI input is missing or NaN — no fabricated volume is substituted.',
         ],
       };
     }
     const logV = VEI - 5; // Newhall & Self (1982) Table 1: VEI = ⌊log₁₀(V km³)⌋ + 5
     const V_km3 = Math.pow(10, logV);
     const V_m3 = V_km3 * 1e9;
     return {
       result: V_km3, unit: 'km³',
       secondary: [
         { key: 'volume_m3', value: V_m3, unit: 'm³', label: 'Erupted Volume (m³)' },
         { key: 'magnitude_class', value: VEI, unit: '—', label: 'VEI Magnitude Class' },
       ],
       steps: [
         '── Volcanic Explosivity Index to Volume (Newhall & Self, 1982) ──',
         `Volcanic Explosivity Index VEI = ${VEI.toFixed(0)} (0–8 scale)`,
         '',
         'Step 1 — Compute log₁₀(volume in km³):',
         `  log₁₀(V) = VEI − 5 = ${VEI.toFixed(0)} − 5`,
         `  log₁₀(V) = ${logV.toFixed(3)}`,
         '',
         'Step 2 — Exponentiate:',
         `  V = 10^${logV.toFixed(3)} = ${V_km3.toExponential(3)} km³ (${V_km3.toFixed(2)} km³)`,
         `  V = ${V_m3.toExponential(3)} m³`,
         '',
         'Step 3 — Eruption classification:',
         `  VEI ${VEI.toFixed(0)}: ${VEI <= 1 ? 'Gentle/Hawaiian effusive' : VEI <= 2 ? 'Strombolian' : VEI <= 3 ? 'Vulcanian' : VEI <= 4 ? 'Plinian (Pompeii-type)' : VEI <= 5 ? 'Plinian (sub-Plinian)' : VEI <= 6 ? 'Ultra-Plinian (e.g. Pinatubo 1991, 5 km³)' : VEI <= 7 ? 'Super-colossal (e.g. Tambora 1815, 50 km³)' : 'Ultra-colossal / supervolcanic (e.g. Toba 74 ka, >1000 km³)'}`,
         '',
         `  └ Newhall & Self (1982): V = 10^(0.98·VEI − 1) km³. Classic VEI table: VEI 3 → 10⁷–10⁸ m³, VEI 6 → 10¹⁰–10¹¹ m³.`,
       ]
     };
   },
95: ({ Qdot, rhoAir, alpha }) => {
     // Mastin et al. (2009) eq 1: Ṁ = 140 × H^4.14 (Ṁ in kg/s, H in km)
     // Inverted: H = (Ṁ / 140)^(1/4.14)
     // Catalogue input Q_dot is heat output in MW → convert to mass eruption rate
     const inputsOk = [Qdot, rhoAir, alpha].every(Number.isFinite);
     const cp_air = 1004;  // J/(kg·K)
     const T_amb = 300;    // K (ambient)
     const MER = (Qdot * 1e6) / (cp_air * T_amb);  // MW → kg/s (mass eruption rate)
     const hMastin = Math.pow(MER / 140, 1 / 4.14);

     // Morton-Taylor-Turner (1956) theoretical check:
     // H = 5.0 × (F₀ / N³)^(1/4), F₀ = g × (Δρ/ρ₀) × MER / ρ₀
     const g = 9.81;
     const N = 0.012;          // Brunt-Väisälä frequency (s⁻¹) — standard troposphere
     const drho_rho = 0.65;    // fractional density contrast (hot plume vs ambient)
     const F0 = g * drho_rho * MER / rhoAir;
     const H_mtt_m = 5.0 * Math.pow(F0 / (N * N * N), 0.25);
     const hMtt = H_mtt_m / 1000;

     // Use Mastin as primary (empirically calibrated for volcanoes)
     const h = hMastin;

     if (!inputsOk) {
       return {
         result: Number.NaN, unit: 'km',
         steps: ['── Volcanic Plume Height (Mastin et al. 2009; Morton-Taylor-Turner 1956) ──',
           'One or more inputs (Q̇, ρ_air, α) are missing or NaN — no fabricated plume height is substituted.',
         ],
       };
     }

     return {
        result: h, unit: 'km',
        secondary: [
          { key: 'buoyancy_flux', value: Number.isFinite(F0) ? F0 : Number.NaN, unit: 'm⁴/s³', label: 'Buoyancy Flux F₀' },
          { key: 'plume_rise_mtt', value: Number.isFinite(hMtt) ? hMtt : Number.NaN, unit: 'km', label: 'MTT Plume Rise Height' },
          { key: 'mass_eruption_rate', value: Number.isFinite(MER) ? MER : Number.NaN, unit: 'kg/s', label: 'Mass Eruption Rate Ṁ' },
        ],
        // Profile series (tool vizType 'profile'): buoyant plume rise z vs
        // downwind distance x (0–500 m, 20 points) from the tool's own MTT
        // buoyant-plume quantities. Bent-over plume trajectory
        // z(x) = 1.6·F₀^(1/3)·x^(2/3)/u, with the crosswind back-computed so
        // the plume reaches its MTT terminal rise H_MTT at x = 500 m, i.e.
        // z(x) = H_MTT·(x/500)^(2/3). Honest NaN when the MTT height is NaN.
        series: [{
          label: 'Buoyant plume rise z(x) (MTT, bent-over to H_MTT)',
          color: '#0072B2',
          points: Array.from({ length: 20 }, (_, i) => {
            const x = i * (500 / 19);
            const z = Number.isFinite(hMtt) && hMtt > 0 ? hMtt * 1000 * Math.pow(x / 500, 2 / 3) : Number.NaN;
            return { x, y: Number.isFinite(z) ? z : Number.NaN };
          }),
        }],
        steps: [
         '── Volcanic Plume Height (Mastin et al. 2009; Morton-Taylor-Turner 1956) ──',
         `Heat output Q̇ = ${Qdot.toExponential(2)} MW`,
         `Mass eruption rate Ṁ = Q̇/(cp·T_amb) = ${MER.toExponential(2)} kg/s`,
         `Ambient air density ρ_air = ${rhoAir.toFixed(3)} kg/m³`,
         `Entrainment coefficient α = ${alpha.toFixed(3)}`,
         '',
         'Step 1 — Mastin et al. (2009) eq 1 (inverted):',
         `  Ṁ = 140 × H^4.14  →  H = (Ṁ/140)^(1/4.14)`,
         `  H = (${MER.toExponential(2)} / 140)^(1/4.14) = ${hMastin.toFixed(2)} km`,
         '',
         'Step 2 — MTT theoretical check:',
         `  F₀ = g × (Δρ/ρ₀) × Ṁ / ρ_air = ${F0.toExponential(3)} m⁴/s³`,
         `  H_MTT = 5.0 × (F₀ / N³)^(1/4) = ${hMtt.toFixed(2)} km`,
         `  ${h > 0 && Math.abs(h - hMtt) / h < 0.5 ? '✓ Mastin and MTT agree within 50%' : '⚠ Mastin and MTT differ — Mastin preferred for volcanic plumes'}`,
         '',
         'Step 3 — Plume classification:',
         `  ${h < 1 ? 'Weak/ash-poor puffing (<1 km)' : h < 5 ? 'Low-level plume — local ashfall, aviation risk below FL200' : h < 10 ? 'Moderate plume — regional ashfall, FL200-FL350 aviation risk' : h < 20 ? 'Strong/Plinian plume (>10 km) — widespread ash, high-risk aviation' : 'Ultra-Plinian / co-ignimbrite plume (>20 km) — stratospheric injection, global dispersal'}`,
         '',
         `  └ Mastin calibrated for Ṁ = 10³–10⁹ kg/s. MTT assumes steady plume, no crosswind. Column collapse when vent too narrow.`,
       ]
     };
   },

};
