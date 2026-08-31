/**
 * PART5 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import { G_GRAV, PI, SIGMA } from '../equationShared';
import type { ComputeFn } from '../equationShared';

export const PART5: Record<number, ComputeFn> = {

  // ── Part V · Domain 15: Climate Dynamics ──
  96: ({ C, T: _T, Q, alpha, I, D, divDT }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Cn = Number(C), Qn = Number(Q), alphan = Number(alpha), In = Number(I), Dn = Number(D), divDTn = Number(divDT);
    const absorbed = Qn * (1 - alphan);
    const diffusion = Dn * divDTn;
    const net = absorbed - In + diffusion;
    const SEC_PER_YEAR = 3.15576e7;  // 365.25 × 24 × 3600
    const dT = net / (Cn || 1) * SEC_PER_YEAR;  // W/m² ÷ (J/m²K) × s/yr = K/yr
    if (![Cn, Qn, alphan, In, Dn, divDTn].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'K/yr',
        steps: ['── EBM — Energy Balance Model (Budyko, 1969; Sellers, 1969) ──',
          '∂T/∂t = [Q(1−α) − I + div(D∇T)] / C × s/yr',
          '', 'One or more inputs are missing — no fabricated energy balance is substituted.'],
      };
    }
    return {
      result: dT, unit: 'K/yr',
      secondary: [
        { key: 'absorbed_sw', value: Number.isFinite(absorbed) ? absorbed : Number.NaN, unit: 'W/m²', label: 'Absorbed Solar Q(1−α)' },
        { key: 'net_balance', value: Number.isFinite(net) ? net : Number.NaN, unit: 'W/m²', label: 'Net TOA Balance' },
      ],
      // Timeseries (vizType 'timeseries'): temperature evolution over 100 years
      // under the tool's own net balance, ΔT(t) = (net/C)·t·s/yr.
      series: [{
        label: 'Temperature change ΔT(t)',
        color: '#0072B2',
        points: Array.from({ length: 41 }, (_, i) => {
          const t = i * 2.5; // years
          const dTt = Number.isFinite(net) ? net / (Cn || 1) * SEC_PER_YEAR * t : Number.NaN;
          return { x: t, y: Number.isFinite(dTt) ? dTt : Number.NaN };
        }),
      }],
      steps: [
        '── EBM — Energy Balance Model (Budyko, 1969; Sellers, 1969) ──',
        `Heat capacity C = ${Cn.toExponential(3)} J/m²K, Solar constant Q = ${Qn.toFixed(0)} W/m²`,
        `Albedo α = ${alphan.toFixed(3)}, OLR I = ${In.toFixed(2)} W/m², Diffusion D = ${Dn.toExponential(3)}, div(D∇T) = ${divDTn.toExponential(3)}`,
        '',
        'Step 1 — Absorbed solar radiation:',
        `  Q(1−α) = ${Qn.toFixed(0)} × (1 − ${alphan.toFixed(3)}) = ${absorbed.toFixed(3)} W/m²`,
        '',
        'Step 2 — Net energy budget:',
        `  Q(1−α) − I + div(D∇T) = ${absorbed.toFixed(3)} − ${In.toFixed(3)} + ${diffusion.toExponential(3)}`,
        `  = ${net.toExponential(4)} W/m²`,
        '',
        'Step 3 — Temperature tendency:',
        `  ∂T/∂t = net / C × 3.156×10⁷ s/yr`,
        `  ∂T/∂t = (${net.toExponential(4)} / ${Cn.toExponential(3)}) × 3.156×10⁷ = ${dT.toExponential(4)} K/yr`,
        '',
        `  └ Interpretation: ${dT > 0 ? 'WARMING — positive energy imbalance' : dT < 0 ? 'COOLING — negative energy imbalance' : 'STEADY STATE — net zero imbalance'}`,
      ]
    };
  },
97: ({ dF, lambda0, f }) => {
     // Standard feedback framework (Roe 2009): ΔT = ΔF / (λ₀ − f)
     // λ₀ = Planck response (~3.2 W/m²K), f = net non-Planck feedbacks
     const dFn = Number(dF), lambda0n = Number(lambda0), fn = Number(f);
     if (![dFn, lambda0n, fn].every(Number.isFinite)) {
       return {
         result: Number.NaN, unit: 'K',
         steps: ['── Climate Sensitivity — Feedback Analysis (Hansen et al., 1984; Roe, 2009) ──',
           'One or more inputs (ΔF, λ₀, f) are missing or NaN — no fabricated sensitivity is substituted.',
         ],
       };
     }
     const den = lambda0n - fn;
     const lambda = den !== 0 ? 1 / den : Number.NaN;
     const dT = lambda * dFn;
     const gain = den !== 0 ? lambda0n / den : Number.NaN;
     return {
       result: dT, unit: 'K',
       secondary: [
         { key: 'lambda', value: Number.isFinite(lambda) ? lambda : Number.NaN, unit: 'K/(W/m²)', label: 'Climate Sensitivity Parameter λ' },
         { key: 'forcing', value: dFn, unit: 'W/m²', label: 'Radiative Forcing ΔF' },
         { key: 'gain', value: Number.isFinite(gain) ? gain : Number.NaN, unit: '—', label: 'Feedback Gain G' },
         { key: 'net_feedback', value: fn, unit: 'W/m²K', label: 'Net Non-Planck Feedback f' },
       ],
       steps: [
         '── Climate Sensitivity — Feedback Analysis (Hansen et al., 1984; Roe, 2009) ──',
         `Radiative forcing ΔF = ${dFn.toFixed(2)} W/m²`,
         `Planck response λ₀ = ${lambda0n.toFixed(4)} W/m²K`,
         `Net non-Planck feedbacks f = ${fn.toFixed(4)} W/m²K (WV + LR + cloud + albedo)`,
         '',
         'Step 1 — Compute effective climate sensitivity parameter:',
         `  λ = 1 / (λ₀ − f) = 1 / (${lambda0n.toFixed(4)} − ${fn.toFixed(4)}) = 1 / ${den.toFixed(4)}`,
         `  λ = ${Number.isFinite(lambda) ? lambda.toFixed(4) : 'NaN (runaway)'} K/(W/m²)`,
         '',
         'Step 2 — Compute equilibrium temperature change:',
         `  ΔT = λ × ΔF = ${Number.isFinite(lambda) ? lambda.toFixed(4) : 'NaN'} × ${dFn.toFixed(2)}`,
         `  ΔT = ${Number.isFinite(dT) ? dT.toFixed(2) : 'NaN'} K`,
         '',
         'Step 3 — Gain factor:',
         `  Gain G = λ₀ / (λ₀ − f) = ${Number.isFinite(gain) ? gain.toFixed(2) : 'NaN'}`,
         `  ${Math.abs(fn) < 0.1 ? 'Weak feedback regime' : fn > 0 ? 'POSITIVE FEEDBACK AMPLIFICATION (G > 1)' : 'NEGATIVE FEEDBACK DAMPENING (G < 1)'}`,
         '',
         `  └ Interpretation: ${!Number.isFinite(dT) ? 'RUNAWAY — feedback exceeds Planck damping' : dT < 1.5 ? 'Low sensitivity — likely aerosol or cloud damping' : dT < 3 ? 'Moderate sensitivity — within IPCC likely range (2–4.5 K)' : dT < 6 ? 'High sensitivity — strong positive feedbacks' : 'Very high sensitivity — model-dependent, potential tipping cascade'}`,
       ]
     };
   },
98: ({ dRdT, T }) => {
     const Tn = Number(T);
     const dRdTn = Number(dRdT);
     // Planck feedback λ_P = −4εσT³ (magnitude 4σT³ for a blackbody). If a
     // temperature T is supplied, compute λ_P = 4σT³ directly (the analytic
     // derivative of σT⁴); otherwise fall back to a supplied dRdT value.
     if (Number.isFinite(Tn) && Tn > 0) {
       const lambdaP = 4 * SIGMA * Math.pow(Tn, 3);
       const T3 = Math.pow(Tn, 3);
       return {
         result: lambdaP, unit: 'W/m²K',
         secondary: [
           { key: 'T_used', value: Tn, unit: 'K', label: 'Blackbody Temperature T' },
           { key: 'T3_factor', value: Number.isFinite(T3) ? T3 : Number.NaN, unit: 'K³', label: 'T³ Factor' },
         ],
         steps: [
           '── Planck Feedback (Manabe & Wetherald, 1967) ──',
           `Temperature T = ${Tn.toFixed(1)} K, emissivity ε = 1 (blackbody)`,
           '',
           'Step 1 — Compute Planck response:',
           `  λ_P = d(εσT⁴)/dT = 4εσT³ = 4 × ${SIGMA.toExponential(3)} × ${Tn.toFixed(1)}³`,
           `  λ_P = ${lambdaP.toFixed(3)} W/m²K`,
           '',
           'Step 2 — Planck timescale:',
           `  Effective damping: τ = C/λ_P ≈ ${(1e8 / lambdaP).toExponential(1)} s (for C ≈ 10⁸ J/m²K column)`,
           '',
           `  └ λ_P = ${lambdaP.toFixed(2)} W/m²K: ${lambdaP < 3 ? 'Below Stefan-Boltzmann (4σT³ ~ 3.8) — possible non-Planck masking' : lambdaP < 4 ? 'Within expected Stefan-Boltzmann range' : 'Above S-B expectation — additional negative feedback'}`,
         ]
       };
     }
     if (Number.isFinite(dRdTn) && dRdTn > 0) {
       return {
         result: dRdTn, unit: 'W/m²K',
         secondary: [
           { key: 'T_used', value: Number.NaN, unit: 'K', label: 'Blackbody Temperature T' },
           { key: 'T3_factor', value: Number.NaN, unit: 'K³', label: 'T³ Factor' },
         ],
         steps: [
           '── Planck Feedback (Manabe & Wetherald, 1967) ──',
           'Planck feedback parameter λ_P = ∂R/∂T (OLR sensitivity to surface temperature)',
           '',
           'Step 1 — Compute Planck response:',
           `  λ_P = d(σT⁴)/dT = 4σT³ ≈ 3.2–3.8 W/m²K at terrestrial temperatures`,
           `  λ_P = ${dRdTn.toFixed(3)} W/m²K (supplied directly)`,
           '',
           'Step 2 — Planck timescale:',
           `  Effective damping: τ = C/λ_P ≈ ${(1e8 / dRdTn).toExponential(1)} s (for C ≈ 10⁸ J/m²K column)`,
           '',
           `  └ λ_P = ${dRdTn.toFixed(2)} W/m²K: ${dRdTn < 3 ? 'Below Stefan-Boltzmann (4σT³ ~ 3.8) — possible non-Planck masking' : dRdTn < 4 ? 'Within expected Stefan-Boltzmann range' : 'Above S-B expectation — additional negative feedback'}`,
         ]
       };
     }
     return {
       result: Number.NaN, unit: 'W/m²K',
       steps: ['── Planck Feedback (Manabe & Wetherald, 1967) ──',
         'Temperature T (or a pre-computed ∂R/∂T) is missing or invalid — no fabricated Planck response is substituted.',
       ],
     };
   },
99: ({ k: _k, beta, kx, ky }) => {
     const K2 = kx * kx + ky * ky;
     // Barotropic Rossby dispersion (Rossby 1939): ω = −β·k_x/(k_x²+k_y²)
     const omega = -beta * kx / K2;
     // Zonal phase speed c_x = ω/k_x = −β/K²
     const zonalPhaseSpeed = K2 > 0 ? -beta / K2 : Number.NaN;
     // Zonal group velocity c_gx = ∂ω/∂k_x = β(k_x²−k_y²)/(k_x²+k_y²)²
     const groupVelX = beta * (kx * kx - ky * ky) / (K2 * K2);
     // Barotropic Rossby radius of deformation L_R = sqrt(gH)/f₀; derive
     // f₀ from β (β = 2Ω·cosφ/a → f₀ = 2Ω·sinφ) with H = 10 km scale height.
     const OMEGA_E = 7.292115e-5;
     const aEarth = 6371000;
     const cosPhi = aEarth * beta / (2 * OMEGA_E);
     const fDerived = (cosPhi < 1 && cosPhi > -1) ? 2 * OMEGA_E * Math.sqrt(1 - cosPhi * cosPhi) : Number.NaN;
     const rossbyRadius = (Number.isFinite(fDerived) && fDerived > 0)
       ? Math.sqrt(G_GRAV * 10000) / fDerived : Number.NaN;

     const inputsOk = [beta, kx, ky].every(Number.isFinite);
     if (!inputsOk || K2 === 0) {
       return {
         result: Number.NaN, unit: 'rad/s',
         steps: ['── Rossby Wave Dispersion Relation (Rossby, 1939; Haurwitz, 1940) ──',
           inputsOk ? 'Degenerate wavenumber (k_x = k_y = 0) — dispersion relation undefined.' : 'One or more inputs (β, k_x, k_y) are missing or NaN — no fabricated frequency is substituted.',
         ],
       };
     }

// Spectrum series: ω(k_x) at fixed k_y across a decade around the input k_x
      // (30 log-spaced points) from the tool's own Rossby dispersion
      // ω = −β·k_x/(k_x²+k_y²). For the canonical k_x = 1e-6 the sweep spans
      // 1e-7 → 1e-5 /m.
      const seriesPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 30; i++) {
        const frac = i / (30 - 1);
        const kxSweep = kx * Math.pow(0.1, 1 - frac) * Math.pow(10, frac); // kx/10 → kx×10
        const K2Sweep = kxSweep * kxSweep + ky * ky;
        seriesPoints.push({ x: kxSweep, y: -beta * kxSweep / K2Sweep });
      }

     return {
       result: omega, unit: 'rad/s',
       secondary: [
         { key: 'zonal_phase_speed', value: Number.isFinite(zonalPhaseSpeed) ? zonalPhaseSpeed : Number.NaN, unit: 'm/s', label: 'Zonal Phase Speed c_x' },
         { key: 'group_velocity_x', value: Number.isFinite(groupVelX) ? groupVelX : Number.NaN, unit: 'm/s', label: 'Zonal Group Velocity c_gx' },
         { key: 'rossby_radius', value: Number.isFinite(rossbyRadius) ? rossbyRadius : Number.NaN, unit: 'm', label: 'Barotropic Rossby Radius L_R' },
       ],
       series: [{ label: 'ω vs k_x (fixed k_y)', points: seriesPoints, color: '#0072B2' }],
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
         `  ω = −β·k_x / K² = −(${beta.toExponential(3)}) × ${kx.toExponential(3)} / ${K2.toExponential(4)}`,
         `  ω = ${omega.toExponential(4)} rad/s`,
         '',
         'Step 3 — Phase speed and direction:',
         `  c_x = −β / K² = ${zonalPhaseSpeed.toExponential(3)} m/s (${zonalPhaseSpeed >= 0 ? 'eastward' : 'westward'})`,
         `  c_gx = β·(k_x²−k_y²)/K⁴ = ${groupVelX.toExponential(3)} m/s (${groupVelX >= 0 ? 'eastward energy' : 'westward energy'})`,
         '',
         `  └ ${ky > 0 ? 'Southward phase propagation (k_y > 0)' : 'Northward phase propagation (k_y < 0)'}`,
         `  └ Group velocity: c_gx = β·(k_x²−k_y²)/(k_x²+k_y²)² (eastward energy transport for long waves)`,
       ]
     };
   },
100: ({ dpdy, f, N, dudy }) => {
     const inputsOk = [dpdy, f, N, dudy].every(Number.isFinite);
     const cond = dpdy < 0;
     // Eady growth rate from provided f, N, dudy (secondary diagnostic)
     // f, N, dudy are all in /s → σ is in /s; multiply by 86400 for /day
     const sigmaEady_s = (f > 0 && N > 0) ? 0.31 * (f / N) * Math.abs(dudy) : 0;
     const sigmaEady = sigmaEady_s * 86400; // /day
     const eFoldDays = sigmaEady > 0 ? 1 / sigmaEady : Infinity;
     return {
       result: Number.isFinite(dpdy) ? (cond ? 1 : 0) : Number.NaN, unit: '—',
       secondary: [
         { key: 'qy_gradient', value: Number.isFinite(dpdy) ? dpdy : Number.NaN, unit: '/m·s', label: 'Meridional QGPV Gradient ∂q/∂y' },
         { key: 'instability_verdict', value: Number.isFinite(dpdy) ? (cond ? 1 : 0) : Number.NaN, unit: '—', label: 'Unstable (1) / Stable (0)' },
         { key: 'eady_growth_rate', value: inputsOk ? sigmaEady : Number.NaN, unit: '/day', label: 'Eady Growth Rate σ' },
         { key: 'e_folding_days', value: Number.isFinite(eFoldDays) && sigmaEady > 0 ? eFoldDays : Number.NaN, unit: 'days', label: 'E-folding Time' },
       ],
       steps: [
         '── Charney-Stern Necessary Condition for Baroclinic Instability (Charney & Stern 1962) ──',
         inputsOk ? '' : 'One or more inputs are missing or NaN — diagnostic may be incomplete.',
         '',
         'Step 1 — Meridional QGPV gradient:',
         `  ∂q/∂y = ${Number.isFinite(dpdy) ? dpdy.toExponential(4) : 'NaN'} /m·s`,
         `  Full form: ∂q/∂y = β − ∂²ū/∂y² + (f²/N²)·(∂/∂p)(∂ū/∂p)`,
         '',
         'Step 2 — Evaluate necessary condition:',
         `  ∂q/∂y = ${Number.isFinite(dpdy) ? dpdy.toExponential(4) : 'NaN'} ${Number.isFinite(dpdy) && cond ? '< 0 → TRUE: sign reversal present — necessary condition for baroclinic instability SATISFIED' : Number.isFinite(dpdy) && !cond ? '≥ 0 → FALSE: ∂q/∂y ≥ 0 — flow is baroclinically stable (Arnold 1st theorem)' : '—'}`,
         '',
         'Step 3 — Context:',
         `  ${Number.isFinite(dpdy) && cond ? 'PV gradient reversal — wave energy extraction from mean flow is possible' : Number.isFinite(dpdy) ? 'No PV gradient reversal — no baroclinic instability possible' : 'Cannot assess without ∂q/∂y'}`,
         '',
         'Step 4 — Eady growth rate (if f, N, ∂u/∂y provided):',
         `  f = ${Number.isFinite(f) ? f.toExponential(4) : 'NaN'} /s, N = ${Number.isFinite(N) ? N.toExponential(4) : 'NaN'} /s, |∂u/∂y| = ${Number.isFinite(dudy) ? Math.abs(dudy).toExponential(4) : 'NaN'} /s`,
         `  σ_Eady = 0.31 × (f/N) × |∂u/∂y| = ${sigmaEady.toExponential(4)} /day`,
         `  e-folding time: τ = ${Number.isFinite(eFoldDays) && eFoldDays < 100 ? eFoldDays.toFixed(1) + ' days' : '∞ (inactive)'}`,
         '',
         `  └ Charney-Stern (1962): necessary condition — ∂q/∂y must change sign in the domain`,
         `  └ Sufficient condition also requires boundary PV gradients of opposite sign (full theorem)`,
       ]
     };
   },
101: ({ f, N, dudy }) => {
     // Eady (1949): σ = 0.31 × (f/N) × |∂u/∂z|, all inputs in /s → σ in /s
     // Convert to /day for display: × 86400
     const inputsOk = [f, N, dudy].every(Number.isFinite);
     const sigma_s = (f > 0 && N > 0) ? 0.31 * (f / N) * Math.abs(dudy) : 0;
     const sigma = sigma_s * 86400; // /day
     const eFoldDays = sigma > 0 ? 1 / sigma : Infinity;
     const periodDays = sigma > 0 ? (2 * Math.PI) / sigma : Infinity;
     if (!inputsOk) {
       return {
         result: Number.NaN, unit: '/day',
         steps: ['── Eady Baroclinic Growth Rate (Eady 1949; coefficient 0.3098 from eigenvalue analysis) ──',
           'One or more inputs (f, N, ∂u/∂z) are missing or NaN — no fabricated growth rate is substituted.',
         ],
       };
     }
     return {
       result: sigma, unit: '/day',
       secondary: [
         { key: 'growth_rate_s', value: Number.isFinite(sigma_s) ? sigma_s : Number.NaN, unit: '/s', label: 'Growth Rate σ (per second)' },
         { key: 'e_folding_days', value: Number.isFinite(eFoldDays) ? eFoldDays : Number.NaN, unit: 'days', label: 'E-folding Time τ_e' },
         { key: 'period_days', value: Number.isFinite(periodDays) ? periodDays : Number.NaN, unit: 'days', label: 'Most Unstable Wave Period' },
       ],
       steps: [
         '── Eady Baroclinic Growth Rate (Eady 1949; coefficient 0.3098 from eigenvalue analysis) ──',
         `Coriolis parameter f = ${f.toFixed(6)} /s`,
         `Brunt-Väisälä frequency N = ${N.toExponential(4)} /s`,
         `Vertical wind shear ∂u/∂z = ${dudy.toExponential(4)} /s`,
         '',
         'Step 1 — Compute Eady growth rate:',
         `  σ_Eady = 0.31 × (f/N) × |∂u/∂z|`,
         `  = 0.31 × (${f.toFixed(6)} / ${N.toExponential(4)}) × ${Math.abs(dudy).toExponential(4)}`,
         `  = ${sigma_s.toExponential(4)} /s × 86400 = ${sigma.toExponential(4)} /day`,
         '',
         'Step 2 — Growth timescales:',
         `  e-folding time: τ_e = 1/σ = ${eFoldDays < 1 ? (eFoldDays * 24).toFixed(1) + ' h' : eFoldDays.toFixed(1) + ' days'}`,
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
     const pvAnomaly = q - f;
     const inputsOk = [f, dpy, dpp].every(Number.isFinite);
     return {
       result: Number.isFinite(q) ? q : Number.NaN, unit: '/s',
       secondary: [
         { key: 'pv_anomaly', value: Number.isFinite(pvAnomaly) ? pvAnomaly : Number.NaN, unit: '/s', label: 'PV Anomaly q − f' },
         { key: 'stretching', value: Number.isFinite(stretching) ? stretching : Number.NaN, unit: '/s', label: 'Stretching Term' },
         { key: 'planetary_vorticity', value: Number.isFinite(f) ? f : Number.NaN, unit: '/s', label: 'Planetary Vorticity f' },
         { key: 'relative_vorticity', value: Number.isFinite(relVort) ? relVort : Number.NaN, unit: '/s', label: 'Relative Vorticity ∇²ψ' },
       ],
       steps: [
         '── Quasi-Geostrophic Potential Vorticity (Charney, 1947; Pedlosky, 1987) ──',
         `Relative vorticity (∇²ψ) ≈ ${Number.isFinite(relVort) ? relVort.toExponential(4) : 'NaN'} /s`,
         `Planetary vorticity f = ${Number.isFinite(f) ? f.toExponential(4) : 'NaN'} /s`,
         `Stretching term ∂/∂p(f²/N²·∂ψ/∂p) ≈ ${Number.isFinite(stretching) ? stretching.toExponential(4) : 'NaN'} /s`,
         '',
         'Step 1 — Assemble QGPV:',
         `  q = ∇²ψ + f + f²/N²·∂²ψ/∂p²`,
         `  q = ${Number.isFinite(relVort) ? relVort.toExponential(4) : 'NaN'} + ${Number.isFinite(f) ? f.toExponential(4) : 'NaN'} + ${Number.isFinite(stretching) ? stretching.toExponential(4) : 'NaN'}`,
         `  q = ${Number.isFinite(q) ? q.toExponential(4) : 'NaN'} /s`,
         '',
         'Step 2 — Vertical structure:',
         `  ${inputsOk && Math.abs(dpp / (dpy || 1e-30)) > 1 ? 'Stretching dominates — baroclinic structure' : 'Relative vorticity dominates — equivalent barotropic'}`,
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
  104: ({ Km, f, tau, rho, curlTau }) => {
    const KmN = Number(Km), fN = Number(f), tauN = Number(tau), rhoN = Number(rho), curlTauN = Number(curlTau);
    const rhoV = Number.isFinite(rhoN) && rhoN > 0 ? rhoN : 1025; // seawater density (kg/m³), documented default
    const hasStress = Number.isFinite(tauN);
    const hasCurl = Number.isFinite(curlTauN);
    const fAbs = Math.abs(fN);
    if (!Number.isFinite(KmN) || !Number.isFinite(fN) || KmN <= 0 || fAbs <= 1e-12) {
      const eqLine = !Number.isFinite(KmN) || !Number.isFinite(fN)
        ? `Non-finite input — K_m = ${Km}, f = ${f}`
        : KmN <= 0
          ? `Eddy viscosity K_m = ${KmN} m²/s — must be positive`
          : `Coriolis parameter f = ${fN} /s — must be non-zero (equatorial singularity)`;
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'ekman_transport', value: Number.NaN, unit: 'm²/s', label: 'Ekman Transport per Unit Width M = τ/(ρ·|f|)' },
          { key: 'ekman_pumping', value: Number.NaN, unit: 'm/s', label: 'Ekman Pumping Velocity w_E = curl τ/(ρ·|f|)' },
        ],
        steps: [
          '── Ekman Depth (Ekman, 1905) ──',
          eqLine,
          '',
          'RESULT: NaN — Ekman theory requires a finite, positive eddy viscosity',
          'and a non-zero Coriolis parameter (off-equatorial latitude). The',
          'frictional boundary layer has no rotational structure at f = 0, so',
          'D_E is undefined. No fabricated value is substituted.',
          '',
          '  └ Valid only for |f| > 0 (off-equatorial latitudes)',
        ],
      };
    }
    const DE = PI * Math.sqrt((2 * KmN) / fAbs);
    const transport = hasStress ? tauN / (rhoV * fAbs) : Number.NaN;
    const pumping = hasCurl ? curlTauN / (rhoV * fAbs) : Number.NaN;
    const hemi = fN > 0 ? 'Northern' : 'Southern';
    return {
      result: DE, unit: 'm',
      secondary: [
        { key: 'ekman_transport', value: transport, unit: 'm²/s', label: 'Ekman Transport per Unit Width M = τ/(ρ·|f|)' },
        { key: 'ekman_pumping', value: pumping, unit: 'm/s', label: 'Ekman Pumping Velocity w_E = curl τ/(ρ·|f|)' },
      ],
      steps: [
        '── Ekman Depth (Ekman, 1905) ──',
        `Eddy viscosity K_m = ${KmN.toExponential(3)} m²/s`,
        `Coriolis parameter f = ${fN.toExponential(6)} /s (${hemi} Hemisphere)`,
        '',
        'Step 1 — Compute Ekman layer depth:',
        `  D_E = π × √(2·K_m/|f|) = π × √(2 × ${KmN.toExponential(3)} / ${fAbs.toExponential(6)})`,
        `  D_E = π × √(${(2 * KmN / fAbs).toExponential(3)})`,
        `  D_E = ${DE.toFixed(1)} m`,
        '',
        'Step 2 — Derived parameters (need wind-stress inputs):',
        `  Ekman transport: M = τ/(ρ·|f|) = ${hasStress ? transport.toFixed(4) : 'NaN — supply τ (N/m²)'} m²/s per unit width`,
        `  Ekman pumping: w_E = curl τ/(ρ·|f|) = ${hasCurl ? pumping.toExponential(4) : 'NaN — supply curl τ (N/m³)'} m/s`,
        `  ${DE > 100 ? 'Deep Ekman layer — typical of ocean interior (low latitudes)' : DE > 30 ? 'Mid-depth Ekman layer — typical mid-latitude ocean' : 'Shallow Ekman layer — high-latitude or high-wind conditions'}`,
        '',
        `  └ Surface current rotates 45° right (NH) / left (SH) of wind; net transport 90° right/left`,
      ]
    };
  },
105: ({ g, thetaVbar, wthetaV, zi, ustar }) => {
    const gN = Number(g), thN = Number(thetaVbar), wN = Number(wthetaV), ziN = Number(zi), uN = Number(ustar);
    if (![gN, thN, wN, ziN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm/s',
        secondary: [
          { key: 'buoyancy_flux', value: Number.NaN, unit: 'm²/s³', label: 'Kinematic Buoyancy Flux (g/θ̄_v)·w′θ′_v' },
          { key: 'theta_v', value: Number.isFinite(thN) ? thN : Number.NaN, unit: 'K', label: 'Mean virtual potential temperature θ̄_v' },
          { key: 'convective_to_friction_ratio', value: Number.NaN, unit: '—', label: 'w*/u* (free-convection regime indicator)' },
        ],
        steps: [
          '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
          'One or more inputs are non-finite (g, θ̄_v, w′θ′_v, z_i).',
          'Cannot compute a genuine convective velocity — no fabricated',
          'value is substituted. Supply all four inputs.',
        ],
      };
    }
    if (thN <= 0 || ziN < 0 || wN < 0) {
      return {
        result: Number.NaN, unit: 'm/s',
        secondary: [
          { key: 'buoyancy_flux', value: Number.NaN, unit: 'm²/s³', label: 'Kinematic Buoyancy Flux (g/θ̄_v)·w′θ′_v' },
          { key: 'theta_v', value: thN, unit: 'K', label: 'Mean virtual potential temperature θ̄_v' },
          { key: 'convective_to_friction_ratio', value: Number.NaN, unit: '—', label: 'w*/u* (free-convection regime indicator)' },
        ],
        steps: [
          '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
          thN <= 0
            ? `RESULT: NaN — θ̄_v = ${thN} K must be positive (virtual potential temperature).`
            : ziN < 0
              ? `RESULT: NaN — z_i = ${ziN} m must be non-negative (boundary-layer height).`
              : `RESULT: NaN — w′θ′_v = ${wN} K·m/s is negative (downward heat flux → stable/neutral BL).`,
          '',
          'Deardorff w* scales free-convective turbulence only. For a negative',
          'surface buoyancy flux the boundary layer is stably stratified and',
          'the convective velocity scale is not defined.',
        ],
      };
    }
    const buoyFlux = (gN / thN) * (wN * ziN);
    const wstar = Math.pow(buoyFlux, 1 / 3);
    const kinBuoyFlux = (gN / thN) * wN;
    const ratio = Number.isFinite(uN) && uN > 0 ? wstar / uN : Number.NaN;
    return {
      result: wstar, unit: 'm/s',
      secondary: [
        { key: 'buoyancy_flux', value: kinBuoyFlux, unit: 'm²/s³', label: 'Kinematic Buoyancy Flux (g/θ̄_v)·w′θ′_v' },
        { key: 'theta_v', value: thN, unit: 'K', label: 'Mean virtual potential temperature θ̄_v' },
        { key: 'convective_to_friction_ratio', value: ratio, unit: '—', label: 'w*/u* (free-convection regime indicator)' },
      ],
      steps: [
        '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
        `Gravity g = ${gN.toFixed(2)} m/s²`,
        `Mean virtual potential temperature θ̄_v = ${thN.toFixed(2)} K`,
        `Surface kinematic heat flux w'θ'_v = ${wN.toExponential(4)} K·m/s`,
        `Boundary layer height z_i = ${ziN.toFixed(0)} m`,
        '',
        'Step 1 — Buoyancy production of TKE:',
        `  (g/θ̄_v)·(w'θ'_v)₀·z_i = (${gN.toFixed(2)}/${thN.toFixed(2)}) × ${wN.toExponential(4)} × ${ziN.toFixed(0)}`,
        `  = ${buoyFlux.toExponential(4)} m²/s³`,
        '',
        'Step 2 — Convective velocity scale:',
        `  w_* = (buoyancy flux)^(1/3) = (${buoyFlux.toExponential(4)})^(1/3)`,
        `  w_* = ${wstar.toFixed(3)} m/s`,
        '',
        'Step 3 — Convective regime:',
        `  ${wstar > 1.5 ? 'STRONG convection — vigorous thermals, deep BL' : wstar > 0.5 ? 'MODERATE convection — typical fair-weather cumulus' : wstar > 0.1 ? 'WEAK convection — suppressed or stable BL' : 'NEARLY NIL — stably stratified or nocturnal BL'}`,
        `${Number.isFinite(ratio) ? `  w*/u* = ${ratio.toFixed(2)} — ${ratio > 1 ? 'free-convection dominated' : 'mixed/shear-influenced'}` : '  w*/u* — NaN, supply friction velocity u*'}`,
        '',
        `  └ w_* scales vertical velocity variance and eddy diffusivity in the convective BL`,
      ]
    };
  },
  106: ({ dtheta, D, cos2b, delta, dB: _dB, dudy }) => {
    if (![dtheta, D, cos2b, delta, dudy].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'K/s',
        steps: ['── Frontogenesis Function (Petterssen, 1936; Sanders, 1955) ──',
          'One or more inputs (∇θ, D, β, δ, ∂u/∂s) are missing or NaN — no fabricated frontogenesis value is substituted.']
      };
    }
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
  107: ({ zeta, f, dudx, dvdy, div: divInput, u, v, dzetaDx, dzetaDy }) => {
    const zN = Number(zeta), fN = Number(f), dudxN = Number(dudx), dvdyN = Number(dvdy);
    const divN = Number(divInput), uN = Number(u), vN = Number(v), dxN = Number(dzetaDx), dyN = Number(dzetaDy);
    const divV = Number.isFinite(divN)
      ? divN
      : (Number.isFinite(dudxN) && Number.isFinite(dvdyN) ? dudxN + dvdyN : Number.NaN);
    if (!Number.isFinite(zN) || !Number.isFinite(fN) || !Number.isFinite(divV)) {
      return {
        result: Number.NaN, unit: '/s²',
        secondary: [
          { key: 'relative_vorticity', value: Number.isFinite(zN) ? zN : Number.NaN, unit: '/s', label: 'Relative vorticity ζ' },
          { key: 'divergence', value: Number.isFinite(divV) ? divV : Number.NaN, unit: '/s', label: 'Horizontal divergence ∇·V' },
          { key: 'absolute_vorticity', value: Number.NaN, unit: '/s', label: 'Absolute vorticity ζ + f' },
          { key: 'stretching_term', value: Number.NaN, unit: '/s²', label: 'Stretching term −(ζ+f)·∇·V' },
          { key: 'advection_term', value: Number.NaN, unit: '/s²', label: 'Relative vorticity advection −(u·∂ζ/∂x + v·∂ζ/∂y)' },
        ],
        steps: [
          '── Barotropic Vorticity Equation (Holton & Hakim, 2012, Ch. 4) ──',
          'One or more inputs are non-finite (ζ, f, ∇·V).',
          'Cannot compute a genuine vorticity tendency — no fabricated',
          'value is substituted. Supply ζ, f and the divergence.',
        ],
      };
    }
    const advAvailable = [uN, vN, dxN, dyN].every(Number.isFinite);
    const advTerm = advAvailable ? -(uN * dxN + vN * dyN) : 0;
    const stretchingTerm = -(zN + fN) * divV;
    const DzetaDt = advTerm + stretchingTerm;
    return {
      result: DzetaDt, unit: '/s²',
      secondary: [
        { key: 'relative_vorticity', value: zN, unit: '/s', label: 'Relative vorticity ζ' },
        { key: 'divergence', value: divV, unit: '/s', label: 'Horizontal divergence ∇·V = ∂u/∂x + ∂v/∂y' },
        { key: 'absolute_vorticity', value: zN + fN, unit: '/s', label: 'Absolute vorticity ζ + f' },
        { key: 'stretching_term', value: stretchingTerm, unit: '/s²', label: 'Stretching term −(ζ+f)·∇·V' },
        { key: 'advection_term', value: advTerm, unit: '/s²', label: 'Relative vorticity advection −(u·∂ζ/∂x + v·∂ζ/∂y)' },
      ],
      steps: [
        '── Barotropic Vorticity Equation (Holton & Hakim, 2012, Ch. 4) ──',
        `Relative vorticity ζ = ${zN.toExponential(4)} /s`,
        `Planetary vorticity f = ${fN.toExponential(4)} /s`,
        `Divergence ∇·V = ∂u/∂x + ∂v/∂y = ${Number.isFinite(divN) ? 'given' : `${dudxN.toExponential(4)} + ${dvdyN.toExponential(4)}`} = ${divV.toExponential(4)} /s`,
        '',
        'Step 1 — Relative vorticity advection:',
        advAvailable
          ? `  −(u·∂ζ/∂x + v·∂ζ/∂y) = −(${uN.toExponential(3)} × ${dxN.toExponential(4)} + ${vN.toExponential(3)} × ${dyN.toExponential(4)}) = ${advTerm.toExponential(4)} /s²`
          : '  Advection term omitted (u, v, ∂ζ/∂x, ∂ζ/∂y not supplied) → 0 /s²',
        '',
        'Step 2 — Stretching/tilting (divergence) term:',
        `  −(ζ+f)·(∇·V) = −(${zN.toExponential(4)} + ${fN.toExponential(4)}) × ${divV.toExponential(4)}`,
        `  = ${stretchingTerm.toExponential(4)} /s² (|ζ+f| = ${Math.abs(zN + fN).toExponential(4)} /s, ${(zN + fN) > 0 ? 'cyclonic' : 'anticyclonic'})`,
        '',
        'Step 3 — Relative vorticity tendency:',
        `  Dζ/Dt = −(u·∂ζ/∂x + v·∂ζ/∂y) − (ζ+f)·∇·V = ${DzetaDt.toExponential(4)} /s²`,
        '',
        'Step 4 — Dynamical interpretation:',
        `  ${divV > 0 ? 'DIVERGENCE → vorticity decreasing (upper-level ridge building)' : 'CONVERGENCE → vorticity increasing (upper-level trough deepening)'}`,
        '',
        `  └ Full barotropic equation: Dζ/Dt = −(u·∂ζ/∂x + v·∂ζ/∂y) − (ζ+f)·(∂u/∂x + ∂v/∂y)`,
      ]
    };
  },

  // ── Domain 17: Cloud Physics ──
  108: ({ a, r, b }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const aN = Number(a), rN = Number(r), bN = Number(b);
    if (!Number.isFinite(aN) || !Number.isFinite(rN) || !Number.isFinite(bN)) {
      return {
        result: Number.NaN, unit: '—',
        steps: ['── Köhler Curve — Cloud Activation (Köhler, 1936; Pruppacher & Klett, 1997) ──',
          'One or more inputs are non-finite — cannot compute.',
          'Supply the Kelvin coefficient a (m), droplet radius r (m) and solute coefficient b (m³).',
        ],
        secondary: [
          { key: 'critical_radius', value: Number.NaN, unit: 'm', label: 'Critical Radius r_c' },
          { key: 'critical_supersaturation', value: Number.NaN, unit: '%', label: 'Critical Supersaturation S_c' },
        ],
      };
    }
    const curvature = aN / rN;
    const solute = bN / (rN * rN * rN);
    const S = curvature - solute;
    const rc = Math.sqrt(3 * bN / aN); // critical radius: dS/dr = 0 → r_c = √(3b/a)
    // Critical supersaturation (fraction): S_c = 2a/(3r_c) = (4a³/27b)^{1/2}
    const Sc = Math.pow(4 * Math.pow(aN, 3) / (27 * bN), 0.5);
    return {
      result: S, unit: '—',
      secondary: [
        { key: 'critical_radius', value: Number.isFinite(rc) ? rc : Number.NaN, unit: 'm', label: 'Critical Radius r_c' },
        { key: 'critical_supersaturation', value: Number.isFinite(Sc) ? Sc * 100 : Number.NaN, unit: '%', label: 'Critical Supersaturation S_c' },
      ],
      steps: [
        '── Köhler Curve — Cloud Activation (Köhler, 1936; Pruppacher & Klett, 1997) ──',
        `Curvature (Kelvin) coefficient a = ${aN.toExponential(3)} m`,
        `Solute (Raoult) coefficient b = ${bN.toExponential(3)} m³`,
        `Droplet radius r = ${rN.toExponential(3)} m (${(rN * 1e6).toFixed(1)} µm)`,
        '',
        'Step 1 — Curvature (Kelvin) term:',
        `  a/r = ${aN.toExponential(3)} / ${rN.toExponential(3)} = ${curvature.toExponential(4)}`,
        '',
        'Step 2 — Solute (Raoult) term:',
        `  b/r³ = ${bN.toExponential(3)} / (${rN.toExponential(3)})³ = ${solute.toExponential(4)}`,
        '',
        'Step 3 — Supersaturation:',
        `  S = a/r − b/r³ = ${curvature.toExponential(4)} − ${solute.toExponential(4)}`,
        `  S = ${S.toExponential(4)} (${(S * 100).toFixed(4)}% supersaturation)`,
        '',
        `  └ Activation: ${S > 0 ? 'SUPERSATURATED — droplet grows spontaneously (r > r_crit)' : 'SUBSATURATED — droplet evaporates'}`,
        `  └ Critical radius r_c = √(3b/a) = ${rc.toExponential(3)} m (${(rc * 1e6).toFixed(1)} µm)`,
        `  └ Critical supersaturation S_c = (4a³/27b)^½ = ${Sc.toExponential(4)} (${(Sc * 100).toFixed(4)}%)`,
      ]
    };
  },
  109: ({ N0, Lambda, D }) => {
    const N0N = Number(N0), LamN = Number(Lambda), DN = Number(D);
    if (!Number.isFinite(N0N) || !Number.isFinite(LamN) || !Number.isFinite(DN)) {
      return {
        result: Number.NaN, unit: 'm⁻³·mm⁻¹',
        secondary: [
          { key: 'lambda_mm', value: Number.NaN, unit: 'mm⁻¹', label: 'Slope parameter Λ (mm⁻¹)' },
          { key: 'total_concentration', value: Number.NaN, unit: 'm⁻³', label: 'Total drop concentration N_T = N₀/Λ' },
          { key: 'mean_diameter', value: Number.NaN, unit: 'mm', label: 'Mean diameter 1/Λ' },
          { key: 'median_volume_diameter', value: Number.NaN, unit: 'mm', label: 'Median-volume diameter D₀ = 3.67/Λ' },
        ],
        steps: [
          '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
          'One or more inputs are non-finite (N₀, Λ, D).',
          'Cannot compute a genuine drop concentration — no fabricated',
          'value is substituted. Supply N₀, Λ and drop diameter D.',
        ],
      };
    }
    if (N0N < 0 || LamN <= 0 || DN < 0) {
      return {
        result: Number.NaN, unit: 'm⁻³·mm⁻¹',
        secondary: [
          { key: 'lambda_mm', value: Number.isFinite(LamN) && LamN > 0 ? LamN / 1000 : Number.NaN, unit: 'mm⁻¹', label: 'Slope parameter Λ (mm⁻¹)' },
          { key: 'total_concentration', value: Number.NaN, unit: 'm⁻³', label: 'Total drop concentration N_T = N₀/Λ' },
          { key: 'mean_diameter', value: Number.NaN, unit: 'mm', label: 'Mean diameter 1/Λ' },
          { key: 'median_volume_diameter', value: Number.NaN, unit: 'mm', label: 'Median-volume diameter D₀ = 3.67/Λ' },
        ],
        steps: [
          '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
          N0N < 0
            ? `RESULT: NaN — intercept N₀ = ${N0N} must be ≥ 0.`
            : LamN <= 0
              ? `RESULT: NaN — slope Λ = ${LamN} m⁻¹ must be > 0 (Λ = 4.1·R^(−0.21) mm⁻¹ is always positive).`
              : `RESULT: NaN — drop diameter D = ${DN} m must be ≥ 0.`,
          '',
          'Unphysical DSD parameter — no fabricated value is substituted.',
        ],
      };
    }
    const expTerm = Math.exp(-LamN * DN);
    const N = N0N * expTerm;
    const LamMM = LamN / 1000; // slope in mm⁻¹ (engine keeps D in metres, Λ in m⁻¹; Λ·D is dimensionless)
    const totalConc = N0N / LamMM; // N_T = ∫₀^∞ N₀·exp(−ΛD)dD = N₀/Λ [m⁻³]
    const meanDmm = 1 / LamMM;     // [mm]
    const D0mm = 3.67 / LamMM;     // median-volume diameter [mm]
    const points: Array<{ x: number; y: number }> = [];
    for (let dmm = 0; dmm <= 8.0001; dmm += 0.25) {
      const y = N0N * Math.exp(-LamN * (dmm / 1000));
      if (Number.isFinite(y)) points.push({ x: dmm, y });
    }
    return {
      result: N, unit: 'm⁻³·mm⁻¹',
      secondary: [
        { key: 'lambda_mm', value: LamMM, unit: 'mm⁻¹', label: 'Slope parameter Λ (mm⁻¹)' },
        { key: 'total_concentration', value: Number.isFinite(totalConc) ? totalConc : Number.NaN, unit: 'm⁻³', label: 'Total drop concentration N_T = N₀/Λ' },
        { key: 'mean_diameter', value: Number.isFinite(meanDmm) ? meanDmm : Number.NaN, unit: 'mm', label: 'Mean diameter 1/Λ' },
        { key: 'median_volume_diameter', value: Number.isFinite(D0mm) ? D0mm : Number.NaN, unit: 'mm', label: 'Median-volume diameter D₀ = 3.67/Λ' },
      ],
      series: [{
        label: 'N(D) — Marshall-Palmer drop size distribution',
        color: '#0072B2',
        points,
      }],
      steps: [
        '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
        `Intercept parameter N₀ = ${N0N.toExponential(3)} m⁻³·mm⁻¹`,
        `Slope parameter Λ = ${LamN.toExponential(3)} /m (${LamMM.toFixed(2)} /mm)`,
        `Drop diameter D = ${(DN * 1000).toFixed(2)} mm (${DN.toExponential(3)} m)`,
        '',
        'Step 1 — Exponential distribution:',
        `  N(D) = N₀·exp(−Λ·D) = ${N0N.toExponential(3)} × exp(−${LamN.toExponential(3)} × ${DN.toExponential(3)})`,
        `  exp(−ΛD) = ${expTerm.toExponential(4)}`,
        '',
        'Step 2 — Concentration at given diameter:',
        `  N(${(DN * 1000).toFixed(1)} mm) = ${N.toExponential(3)} m⁻³·mm⁻¹`,
        '',
        'Step 3 — Distribution moments (Λ in mm⁻¹):',
        `  Total concentration: N_T = N₀/Λ = ${N0N.toExponential(3)} / ${LamMM.toFixed(3)} = ${totalConc.toExponential(4)} m⁻³`,
        `  Mean diameter: 1/Λ = ${meanDmm.toFixed(2)} mm`,
        `  Median-volume diameter: D₀ = 3.67/Λ = ${D0mm.toFixed(2)} mm`,
        `  Reflectivity: Z = N₀·Γ(7)/Λ⁷ = ${N0N.toExponential(3)} × 720 / ${Math.pow(LamMM, 7).toExponential(3)} = ${(N0N * 720 / Math.pow(LamMM, 7)).toExponential(3)} mm⁶/m³`,
        '',
        `  └ Classic MP: N₀ = 8×10³ m⁻³·mm⁻¹, Λ = 4.1·R^(-0.21) mm⁻¹ (R in mm/h)`,
      ]
    };
  },
  110: ({ a, R }) => {
    const aN = Number(a), RN = Number(R);
    if (!Number.isFinite(aN) || !Number.isFinite(RN)) {
      return {
        result: Number.NaN, unit: 'mm⁶/m³',
        secondary: [
          { key: 'reflectivity_dbz', value: Number.NaN, unit: 'dBZ', label: 'Radar reflectivity dBZ = 10·log₁₀(Z)' },
          { key: 'rain_rate_from_z', value: Number.NaN, unit: 'mm/h', label: 'Inverse rain rate R = (Z/a)^(1/b)' },
        ],
        steps: [
          '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
          'One or more inputs are non-finite (a, R).',
          'Cannot compute a genuine reflectivity — no fabricated value',
          'is substituted. Supply the coefficient a and rain rate R.',
        ],
      };
    }
    if (aN <= 0 || RN < 0) {
      return {
        result: Number.NaN, unit: 'mm⁶/m³',
        secondary: [
          { key: 'reflectivity_dbz', value: Number.NaN, unit: 'dBZ', label: 'Radar reflectivity dBZ = 10·log₁₀(Z)' },
          { key: 'rain_rate_from_z', value: Number.NaN, unit: 'mm/h', label: 'Inverse rain rate R = (Z/a)^(1/b)' },
        ],
        steps: [
          '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
          aN <= 0
            ? `RESULT: NaN — coefficient a = ${aN} must be positive (Marshall-Palmer standard a = 200).`
            : `RESULT: NaN — rain rate R = ${RN} mm/h must be ≥ 0.`,
          '',
          'Unphysical Z-R input — no fabricated value is substituted.',
        ],
      };
    }
    const b = 1.6;
    const Z = aN * Math.pow(RN, b);
    const dBZ = RN === 0 ? 0 : 10 * Math.log10(Z);
    const Rinv = RN > 0 ? Math.pow(Z / aN, 1 / b) : 0;
    const rainClass = Z < 20 ? 'Light drizzle' : Z < 200 ? 'Moderate rain' : Z < 2000 ? 'Heavy rain' : 'Very heavy / hailstorm';
    const points: Array<{ x: number; y: number }> = [];
    for (const r of [0, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
      const z = aN * Math.pow(r, b);
      if (Number.isFinite(z)) points.push({ x: r, y: z });
    }
    return {
      result: Z, unit: 'mm⁶/m³',
      secondary: [
        { key: 'reflectivity_dbz', value: dBZ, unit: 'dBZ', label: 'Radar reflectivity dBZ = 10·log₁₀(Z)' },
        { key: 'rain_rate_from_z', value: Rinv, unit: 'mm/h', label: 'Inverse rain rate R = (Z/a)^(1/b)' },
      ],
      series: [{
        label: 'Z(R) — reflectivity-rainfall curve',
        color: '#D55E00',
        points,
      }],
      steps: [
        '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
        `Coefficient a = ${aN.toFixed(1)} (Marshall-Palmer standard: a=200)`,
        `Rain rate R = ${RN.toFixed(2)} mm/h, Exponent b = ${b.toFixed(1)}`,
        '',
        'Step 1 — Compute radar reflectivity:',
        `  Z = a × R^b = ${aN.toFixed(1)} × ${RN.toFixed(2)}^${b.toFixed(1)}`,
        `  Z = ${Z.toExponential(3)} mm⁶/m³`,
        '',
        'Step 2 — Convert to dBZ:',
        `  dBZ = 10 × log₁₀(Z) = 10 × log₁₀(${Z.toExponential(3)})`,
        `  dBZ = ${dBZ.toFixed(1)} dBZ`,
        '',
        'Step 3 — Inverse relation (R from Z):',
        `  R = (Z/a)^(1/b) = (${Z.toExponential(3)}/${aN.toFixed(1)})^(1/${b.toFixed(1)}) = ${Rinv.toFixed(3)} mm/h`,
        '',
        'Step 4 — Precipitation classification:',
        `  ${rainClass} (${dBZ.toFixed(0)} dBZ)`,
        '',
        `  └ Common Z-R pairs: stratiform (200,1.6), orographic (31,1.71), thunderstorm (486,1.37)`,
        `  └ Dual-pol improves R estimate by reducing Z-R ambiguity (K_dp, Z_dr)`,
      ]
    };
  },

};
