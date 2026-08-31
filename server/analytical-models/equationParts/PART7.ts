/**
 * PART7 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import type { ComputeFn } from '../equationShared';

export const PART7: Record<number, ComputeFn> = {

  // ── Part VII · Domain 22: Groundwater ──
  131: ({ T, h1, h2, r1, r2 }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Tn = Number(T), h1n = Number(h1), h2n = Number(h2), r1n = Number(r1), r2n = Number(r2);
    const dh = h2n - h1n;
    const lnRatio = Math.log(r2n / r1n);
    const Q = (2 * Math.PI * Tn * dh) / lnRatio;
    // Thiem requires r₂ > r₁ > 0 (log ratio defined & positive) and T > 0.
    const valid = [Tn, h1n, h2n, r1n, r2n].every(Number.isFinite) && Tn > 0 && r1n > 0 && r2n > r1n;
    if (!valid) {
      return {
        result: Number.NaN, unit: 'm³/day',
        secondary: [
          { key: 'drawdown', value: Number.isFinite(dh) ? dh : Number.NaN, unit: 'm', label: 'Head Difference Δh = h₂ − h₁' },
          { key: 'transmissivity', value: Number.isFinite(Tn) && Tn > 0 ? Tn : Number.NaN, unit: 'm²/day', label: 'Transmissivity T' },
        ],
        steps: ['── Thiem Equation — Steady Radial Flow (Thiem, 1906; Dupuit, 1863) ──',
          'Q = 2π·T·(h₂−h₁)/ln(r₂/r₁)',
          '', 'One or more inputs are missing or unphysical (requires r₂ > r₁ > 0, T > 0) — no fabricated flow rate is substituted.'],
      };
    }
    return {
      result: Q, unit: 'm³/day',
      secondary: [
        { key: 'drawdown', value: dh, unit: 'm', label: 'Head Difference Δh = h₂ − h₁' },
        { key: 'transmissivity', value: Tn, unit: 'm²/day', label: 'Transmissivity T' },
      ],
      // Profile series (tool vizType 'profile'): steady-state drawdown
      // s(r) = Q/(2πT)·ln(r₂/r) over 10–1000 m (20 log-spaced points) from
      // the tool's own Thiem flow rate Q and transmissivity T.
      series: [{
        label: 'Thiem drawdown s(r) = Q/(2πT)·ln(r₂/r)',
        color: '#0072B2',
        xLabel: 'Radial distance r (m)',
        logX: true,
        points: Array.from({ length: 20 }, (_, i) => {
          const r = 10 * Math.pow(100, i / 19); // 10 → 1000 m, log-spaced
          const s = (Q / (2 * Math.PI * Tn)) * Math.log(r2n / r);
          return { x: r, y: Number.isFinite(s) ? s : Number.NaN };
        }),
      }],
      steps: [
        '── Thiem Equation — Steady Radial Flow (Thiem, 1906; Dupuit, 1863) ──',
        `Transmissivity T = ${Tn.toFixed(2)} m²/day`,
        `Drawdown: h₁ = ${h1n.toFixed(2)} m (at r₁ = ${r1n.toFixed(1)} m), h₂ = ${h2n.toFixed(2)} m (at r₂ = ${r2n.toFixed(1)} m)`,
        `Head difference Δh = ${dh.toFixed(2)} m`,
        '',
        'Step 1 — Compute log ratio:',
        `  ln(r₂/r₁) = ln(${r2n.toFixed(1)} / ${r1n.toFixed(1)}) = ${lnRatio.toFixed(4)}`,
        '',
        'Step 2 — Compute flow rate:',
        `  Q = 2π·T·Δh / ln(r₂/r₁)`,
        `  Q = 2π × ${Tn.toFixed(2)} × ${dh.toFixed(2)} / ${lnRatio.toFixed(4)}`,
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
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Qn = Number(Q), Tn = Number(T), tn = Number(t), rn = Number(r), Sn = Number(S);
    // Theis (1935) well function W(u) = ∫ᵤ^∞ (e^{-x}/x) dx
    // Reference: Theis, C.V. (1935) Trans. Am. Geophys. Union, 16(2), 519–524.
    const u = Math.max((rn * rn) * Sn / (4 * Tn * tn), 1e-30);
    const gamma = 0.5772156649;
    // W(u) computation:
    //   u < 1:   series expansion (4 terms, error < 0.6%)
    //   1 ≤ u < 5: 15-term series (error < 0.01%)
    //   u ≥ 5:   asymptotic expansion (4 terms, error < 2.3%)
    const wellFn = (uu: number): number => {
      if (uu < 1) {
        return -gamma - Math.log(uu) + uu - (uu*uu)/4 + (uu*uu*uu)/18 - (uu*uu*uu*uu)/96;
      }
      if (uu < 5) {
        // Series: W(u) = -γ - ln(u) + Σ_{n=1}^{N} (-1)^{n+1} · u^n/(n·n!)
        let sum = 0;
        let un = uu; // u^n
        let factN = 1; // n!
        for (let n = 1; n <= 15; n++) {
          sum += (n % 2 === 1 ? 1 : -1) * un / (n * factN);
          un *= uu;
          factN *= (n + 1);
        }
        return -gamma - Math.log(uu) + sum;
      }
      // Asymptotic: W(u) ≈ e^{-u}/u · (1 - 1/u + 2!/u² - 3!/u³ + 4!/u⁴)
      const eu = Math.exp(-uu);
      return (eu / uu) * (1 - 1/uu + 2/(uu*uu) - 6/(uu*uu*uu) + 24/(uu*uu*uu*uu));
    };
    const W_u = wellFn(u);
    const s = (Qn / (4 * Math.PI * Tn)) * W_u;
    if (![Qn, Tn, tn, rn, Sn].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm',
        steps: ['── Theis Well Function (Theis, 1935) ──',
          's = (Q/4πT)·W(u), u = r²S/(4Tt)',
          '', 'One or more inputs are missing — no fabricated drawdown is substituted.'],
      };
    }
    return {
      result: s, unit: 'm',
      secondary: [
        { key: 'well_function', value: Number.isFinite(W_u) ? W_u : Number.NaN, unit: '—', label: 'Well Function W(u)' },
        { key: 'dimensionless_u', value: Number.isFinite(u) ? u : Number.NaN, unit: '—', label: 'Dimensionless Time u' },
        { key: 'specific_capacity', value: Number.isFinite(s) && s > 0 ? Qn / s : Number.NaN, unit: 'm²/day', label: 'Specific Capacity Q/s' },
      ],
      // Timeseries series (tool vizType 'timeseries'): drawdown s(t) over
      // 0.1–100 days (20 log-spaced points) from the tool's own Theis formula
      // s = (Q/4πT)·W(u), u = r²S/(4Tt), reusing the exact W(u) above.
      series: [{
        label: 'Theis drawdown s(t) = (Q/4πT)·W(u)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const tt = 0.1 * Math.pow(1000, i / 19); // 0.1 → 100 days, log-spaced
          const ut = Math.max((rn * rn) * Sn / (4 * Tn * tt), 1e-30);
          const st = (Qn / (4 * Math.PI * Tn)) * wellFn(ut);
          return { x: tt, y: Number.isFinite(st) ? st : Number.NaN };
        }),
      }],
      steps: [
        '── Theis Well Function — Unsteady Radial Flow (Theis, 1935) ──',
        `Pumping rate Q = ${Qn.toFixed(2)} m³/day, Transmissivity T = ${Tn.toFixed(2)} m²/day`,
        `Time t = ${tn.toFixed(2)} days, Distance r = ${rn.toFixed(1)} m`,
        `Storativity S = ${Sn.toExponential(3)}`,
        '',
        'Step 1 — Compute dimensionless argument u:',
        `  u = r²·S / (4·T·t) = (${rn.toFixed(1)})² × ${Sn.toExponential(3)} / (4 × ${Tn.toFixed(2)} × ${tn.toFixed(2)})`,
        `  u = ${u.toExponential(3)}`,
        '',
        'Step 2 — Compute well function W(u):',
        `  W(u) = −γ − ln(u) + u − u²/4 + u³/18 − u⁴/96`,
        `  ${u < 1 ? 'u < 1: series converges rapidly (small u approximation valid)' : 'u ≥ 1: using exponential integral asymptotic'}`,
        `  W(u) = ${W_u.toExponential(4)}`,
        '',
        'Step 3 — Drawdown at observation well:',
        `  s = (Q / 4πT) × W(u) = (${Qn.toFixed(2)} / (4π × ${Tn.toFixed(2)})) × ${W_u.toExponential(4)}`,
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
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Qn = Number(Q), Tn = Number(T), tn = Number(t), rn = Number(r), Sn = Number(S);
    // Cooper & Jacob (1946) straight-line approximation to Theis.
    // Valid when u = r²S/(4Tt) < 0.01 (error < 1% vs full Theis).
    // Reference: Cooper & Jacob (1946) Trans. Am. Geophys. Union, 27(4),
    // 526–534. DOI: 10.1029/TR027i004p00526.
    const u = (rn * rn * Sn) / (4 * Tn * tn);
    // log₁₀ argument = 2.25·T·t/(r²·S) = 2.25/(4u) = 0.5625/u — the small-u
    // approximation W(u) ≈ ln(2.25/(4u)) reproduces Theis to <1% for u<0.01.
    // (The previous `2.25/u` omitted the factor 4, overestimating s by ~20%.)
    const arg = 0.5625 / u;
    const slope = 2.3 * Qn / (4 * Math.PI * Tn);
    const s = slope * Math.log10(Math.max(arg, 1e-10));
    const valid = u < 0.01;
    return {
      result: s, unit: 'm',
      secondary: [
        { key: 'dimensionless_u', value: Number.isFinite(u) ? u : Number.NaN, unit: '—', label: 'Dimensionless Time u' },
        { key: 'slope_per_cycle', value: Number.isFinite(slope) ? slope : Number.NaN, unit: 'm', label: 'Slope per Log Cycle Δs' },
        { key: 'min_time', value: Number.isFinite(u) ? (rn * rn * Sn) / (0.04 * Tn) : Number.NaN, unit: 'days', label: 'Minimum Applicable Time t_min' },
      ],
      // Timeseries series (tool vizType 'timeseries'): drawdown s(t) over
      // 0.1–100 days (20 log-spaced points) from the tool's own Cooper-Jacob
      // straight-line approximation s = (2.3Q/4πT)·log₁₀(2.25/(4u)).
      series: [{
        label: 'Cooper-Jacob drawdown s(t) = (2.3Q/4πT)·log₁₀(2.25/(4u))',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const tt = 0.1 * Math.pow(1000, i / 19); // 0.1 → 100 days, log-spaced
          const ut = (rn * rn * Sn) / (4 * Tn * tt);
          const st = slope * Math.log10(Math.max(0.5625 / ut, 1e-10));
          return { x: tt, y: Number.isFinite(st) ? st : Number.NaN };
        }),
      }],
      steps: [
        '── Cooper-Jacob Straight-Line Method (Cooper & Jacob, 1946) ──',
        `Pumping rate Q = ${Qn.toFixed(2)} m³/day, Transmissivity T = ${Tn.toFixed(2)} m²/day`,
        `Time t = ${tn.toFixed(2)} days, Distance r = ${rn.toFixed(1)} m`,
        `Storativity S = ${Sn.toExponential(3)}`,
        '',
        'Step 1 — Validity check (u < 0.01 required):',
        `  u = r²S / (4Tt) = ${(rn*rn).toFixed(0)} × ${Sn.toExponential(3)} / (4 × ${Tn.toFixed(2)} × ${tn.toFixed(2)})`,
        `  u = ${u.toExponential(3)}`,
        `  ${valid ? '✓ u < 0.01 — Cooper-Jacob valid (< 1% error vs Theis)' : '⚠ u ≥ 0.01 — approximation error > 1%; use full Theis W(u) for accuracy'}`,
        '',
        'Step 2 — Logarithmic argument:',
        `  2.25·Tt/(r²S) = 2.25/(4u) = 2.25 / ${(4*u).toExponential(3)} = ${arg.toExponential(3)}`,
        '',
        'Step 3 — Compute drawdown:',
        `  s = (2.3·Q / 4πT) × log₁₀(2.25/(4u))`,
        `  s = ${slope.toFixed(4)} × log₁₀(${arg.toExponential(3)})`,
        `  s = ${s.toFixed(4)} m`,
        '',
        'Step 4 — Straight-line analysis:',
        `  Slope per log cycle: Δs = ${slope.toFixed(4)} m`,
        `  T = 2.3Q / (4π·Δs) = ${(2.3 * Qn / (4 * Math.PI * slope)).toFixed(2)} m²/day`,
        `  ${s > 0.1 ? 'Measurable drawdown — suitable for T/S estimation' : 'Very small drawdown — needs longer pumping or closer well'}`,
        '',
        `  └ Validity: Cooper-Jacob is the late-time (small u) limit of Theis`,
        `  └ For u > 0.01: use full Theis W(u) or Cooper-Jacob will overestimate s`,
      ]
    };
  },
  134: ({ fc, f0, k, t }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const fcN = Number(fc), f0N = Number(f0), kN = Number(k), tN = Number(t);
    const excess = f0N - fcN;
    const decay = Math.exp(-kN * tN);
    const f = fcN + excess * decay;
    const cumInf = fcN * tN + (excess / kN) * (1 - decay);
    if (![fcN, f0N, kN, tN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'mm/h',
        steps: ['── Horton Infiltration Model (Horton, 1939) ──',
          'f(t) = f_c + (f₀−f_c)·e^(−kt)',
          '', 'One or more inputs are missing — no fabricated infiltration is substituted.'],
      };
    }
    return {
      result: f, unit: 'mm/h',
      secondary: [
        { key: 'cumulative_infiltration', value: Number.isFinite(cumInf) ? cumInf : Number.NaN, unit: 'mm', label: 'Cumulative Infiltration F(t)' },
        { key: 'equilibrium_rate', value: Number.isFinite(fcN) ? fcN : Number.NaN, unit: 'mm/h', label: 'Equilibrium Rate f_c' },
      ],
      // Timeseries series (tool vizType 'timeseries'): infiltration rate f(t)
      // over 0–10 h (20 points) from the tool's own Horton equation
      // f(t) = f_c + (f₀ − f_c)·e^(−kt).
      series: [{
        label: 'Horton infiltration f(t) = f_c + (f₀−f_c)·e^(−kt)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const tt = i * (10 / 19);
          const ft = fcN + (f0N - fcN) * Math.exp(-kN * tt);
          return { x: tt, y: Number.isFinite(ft) ? ft : Number.NaN };
        }),
      }],
      steps: [
        '── Horton Infiltration Model (Horton, 1939) ──',
        `Initial infiltration rate f₀ = ${f0N.toFixed(2)} mm/h`,
        `Equilibrium rate f_c = ${fcN.toFixed(2)} mm/h (saturated conductivity)`,
        `Decay constant k = ${kN.toExponential(3)} /h, Time t = ${tN.toFixed(2)} h`,
        '',
        'Step 1 — Compute exponential decay factor:',
        `  e^(−kt) = exp(−${kN.toExponential(3)} × ${tN.toFixed(2)}) = ${decay.toExponential(4)}`,
        '',
        'Step 2 — Infiltration rate at time t:',
        `  f(t) = f_c + (f₀ − f_c)·e^(−kt)`,
        `  f(${tN.toFixed(1)} h) = ${fcN.toFixed(2)} + (${f0N.toFixed(2)} − ${fcN.toFixed(2)}) × ${decay.toExponential(4)}`,
        `  f(${tN.toFixed(1)} h) = ${f.toFixed(2)} mm/h`,
        '',
        'Step 3 — Cumulative infiltration:',
        `  F(t) = f_c·t + (f₀−f_c)/k·(1−e^(−kt))`,
        `  F(${tN.toFixed(1)} h) = ${cumInf.toFixed(2)} mm total infiltrated`,
        '',
        'Step 4 — Infiltration regime:',
        `  ${f / f0N > 0.8 ? 'EARLY STAGE — matrix potential dominated' : f / f0N > 0.3 ? 'TRANSITION — mixed gravitational/capillary' : 'LATE STAGE — gravity-dominated, near f_c'}`,
        '',
        `  └ Time to near-equilibrium (f ≈ 1.05·f_c): t ≈ 3/k ≈ ${(3 / kN).toFixed(1)} h`,
      ]
    };
  },

  // ── Domain 23: Hazard & Risk ──
  135: ({ H, V, E }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Hn = Number(H), Vn = Number(V), En = Number(E);
    const valid = [Hn, Vn, En].every(Number.isFinite) && Hn >= 0 && Vn >= 0 && En >= 0;
    const R = Hn * Vn * En;
    const riskClass = !Number.isFinite(R) ? Number.NaN : (R < 0.1 ? 0 : R < 0.3 ? 1 : R < 0.6 ? 2 : 3);
    if (!valid) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'hazard', value: Number.isFinite(Hn) ? Hn : Number.NaN, unit: '—', label: 'Hazard H' },
          { key: 'vulnerability', value: Number.isFinite(Vn) ? Vn : Number.NaN, unit: '—', label: 'Vulnerability V' },
          { key: 'exposure', value: Number.isFinite(En) ? En : Number.NaN, unit: '—', label: 'Exposure E' },
          { key: 'risk_class', value: Number.NaN, unit: '—', label: 'Risk Class (0 Low, 1 Moderate, 2 High, 3 Very High)' },
        ],
        steps: ['── UNISDR Disaster Risk Framework (UNISDR, 2004; UNDRO, 1979) ──',
          'Risk = H × V × E',
          '', 'One or more inputs are missing or out of range — no fabricated risk is substituted.'],
      };
    }
    return {
      result: R, unit: '—',
      secondary: [
        { key: 'hazard', value: Hn, unit: '—', label: 'Hazard H' },
        { key: 'vulnerability', value: Vn, unit: '—', label: 'Vulnerability V' },
        { key: 'exposure', value: En, unit: '—', label: 'Exposure E' },
        { key: 'risk_class', value: riskClass, unit: '—', label: 'Risk Class (0 Low, 1 Moderate, 2 High, 3 Very High)' },
      ],
      steps: [
        '── UNISDR Disaster Risk Framework (UNISDR, 2004; UNDRO, 1979) ──',
        `Hazard H = ${Hn.toFixed(3)} (event probability × intensity)`,
        `Vulnerability V = ${Vn.toFixed(3)} (0–1: degree of loss given event)`,
        `Exposure E = ${En.toFixed(3)} (elements at risk, e.g. population × value)`,
        '',
        'Step 1 — Compute risk:',
        `  Risk = H × V × E = ${Hn.toFixed(3)} × ${Vn.toFixed(3)} × ${En.toFixed(3)}`,
        `  Risk = ${R.toFixed(3)} (expected loss units)`,
        '',
        'Step 2 — Risk level:',
        `  ${R < 0.1 ? 'LOW — negligible risk, routine monitoring' : R < 0.3 ? 'MODERATE — acceptable risk, standard mitigation' : R < 0.6 ? 'HIGH — requires active risk reduction measures' : 'VERY HIGH — priority intervention, evacuation planning'}`,
        '',
        `  └ Components: H = f(probability, magnitude); V depends on structural/physical/social factors; E quantifies population and assets`,
      ]
    };
  },
  136: ({ D_P, P_low, P_high, num_intervals }) => {
    // Expected Annual Damage (USACE EM 1110-2-1619)
    // EAD = ∫₀¹ D(P)·dP, integrated numerically via trapezoidal rule.
    // D(P) is modeled as a power-law: D(P) = D_P × (P/P_ref)^(-α)
    // where P_ref = 0.01 (100-year event) and α = 0.8 (typical flood).
    const P_ref = 0.01;
    const alpha = 0.8;  // damage curve exponent (typical for riverine floods)
    const D100raw = Number(D_P);
    const D100 = (Number.isFinite(D100raw) && D100raw >= 0) ? D100raw : Number.NaN;
    const n = Math.max(10, Math.min(1000, Math.round(Number(num_intervals) || 100)));
    const pLo = Math.max(0.0001, Number(P_low) || 0.001);
    const pHi = Math.min(0.99, Number(P_high) || 0.5);
    if (!Number.isFinite(D100) || pLo >= pHi) {
      return {
        result: Number.NaN, unit: '$/yr',
        secondary: [
          { key: 'annual_loss', value: Number.NaN, unit: '$/yr', label: 'Expected Annual Damage EAD' },
          { key: 'max_damage', value: Number.NaN, unit: '$', label: 'Maximum Damage D₁₀₀' },
          { key: 'return_period_damage', value: Number.NaN, unit: '$', label: 'Damage at 1000-yr Event' },
        ],
        steps: ['── Expected Annual Damage (USACE EM 1110-2-1619) ──',
          'EAD = ∫ D(P)·dP, D(P) = D₁₀₀·(P/P_ref)^(-α)',
          '', 'Damage at 100-yr event (D_P) is missing or not finite — no fabricated EAD is substituted.'],
      };
    }
    // Power-law damage curve: D(P) = D100 × (P/P_ref)^(-α)
    // Logarithmic grid integration for accuracy on steep D(P) curve
    const logPLo = Math.log(pLo);
    const logPHi = Math.log(pHi);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t1 = i / n;
      const t2 = (i + 1) / n;
      const p1 = Math.exp(logPLo + t1 * (logPHi - logPLo));
      const p2 = Math.exp(logPLo + t2 * (logPHi - logPLo));
      const D1 = D100 * Math.pow(p1 / P_ref, -alpha);
      const D2 = D100 * Math.pow(p2 / P_ref, -alpha);
      sum += 0.5 * (D1 + D2) * (p2 - p1);
    }
    const EAD = sum;
    // Damage-exceedance curve series: D(P) over the integration range
    const seriesPoints: Array<{ x: number; y: number }> = [];
    const seriesN = 40;
    for (let i = 0; i <= seriesN; i++) {
      const t = i / seriesN;
      const p = Math.exp(logPLo + t * (logPHi - logPLo));
      const D = D100 * Math.pow(p / P_ref, -alpha);
      if (Number.isFinite(D)) seriesPoints.push({ x: p, y: D });
    }
    const D1000 = D100 * Math.pow(0.001 / P_ref, -alpha);
    return {
      result: EAD, unit: '$/yr',
      secondary: [
        { key: 'annual_loss', value: EAD, unit: '$/yr', label: 'Expected Annual Damage EAD' },
        { key: 'max_damage', value: D100, unit: '$', label: 'Maximum Damage D₁₀₀' },
        { key: 'return_period_damage', value: D1000, unit: '$', label: 'Damage at 1000-yr Event' },
        { key: 'D_100', value: D100, unit: '$', label: 'Damage at 100-yr event' },
        { key: 'D_1000', value: D1000, unit: '$', label: 'Damage at 1000-yr event' },
      ],
      series: seriesPoints.length > 0
        ? [{
            label: 'Damage-Exceedance D(P)',
            color: '#d62728',
            points: seriesPoints,
          }]
        : undefined,
      steps: [
        '── Expected Annual Damage (USACE EM 1110-2-1619) ──',
        `Damage at 100-yr event D₁₀₀ = $${D100.toFixed(0)}`,
        `Power-law exponent α = ${alpha} (typical riverine flood)`,
        `Integration range: P ∈ [${pLo.toFixed(4)}, ${pHi.toFixed(4)}]`,
        `Number of intervals: ${n}`,
        '',
        'Step 1 — Damage-exceedance curve D(P):',
        `  D(P) = D₁₀₀ × (P/${P_ref})^(-${alpha})`,
        `  D(0.5) = $${(D100 * Math.pow(0.5/P_ref, -alpha)).toFixed(0)} (2-yr event)`,
        `  D(0.01) = $${D100.toFixed(0)} (100-yr event)`,
        `  D(0.001) = $${(D100 * Math.pow(0.001/P_ref, -alpha)).toFixed(0)} (1000-yr event)`,
        '',
        'Step 2 — Numerical integration (trapezoidal rule):',
        `  EAD = ∫ D(P)·dP ≈ ${n} intervals`,
        `  EAD = $${EAD.toFixed(0)}/yr`,
        '',
        'Step 3 — Risk assessment:',
        `  ${EAD > 1e6 ? 'CATASTROPHIC — > $1M/yr, flood insurance essential' : EAD > 1e4 ? 'HIGH — > $10K/yr, risk transfer recommended' : EAD > 1e3 ? 'MODERATE — > $1K/yr, monitor regularly' : 'LOW — < $1K/yr, minimal financial risk'}`,
        '',
        `  └ Mitigation benefit: if levee reduces D₁₀₀ by 50%, EAD drops proportionally`,
        `  └ Benefit-cost ratio: BCR = ΔEAD / annualized mitigation cost`,
      ],
    };
  },
  137: ({ IHi, ILo, BPHi, BPLo, Cp }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const IHiN = Number(IHi), ILoN = Number(ILo), BPHiN = Number(BPHi), BPLoN = Number(BPLo), CpN = Number(Cp);
    // EPA 40 CFR Part 50 Appendix G — AQI breakpoint interpolation
    // AQI = [(I_Hi−I_Lo)/(BP_Hi−BP_Lo)] × (C_p−BP_Lo) + I_Lo
    const denom = (BPHiN - BPLoN) || 1;
    const concRatio = (CpN - BPLoN) / denom;
    const AQI = (IHiN - ILoN) * concRatio + ILoN;
    const valid = [IHiN, ILoN, BPHiN, BPLoN, CpN].every(Number.isFinite) && CpN >= 0 && BPHiN > BPLoN;
    // Health classification: numeric class 0–5 per EPA AQI categories
    const healthLabel = !Number.isFinite(AQI) ? Number.NaN
      : AQI <= 50 ? 0 : AQI <= 100 ? 1 : AQI <= 150 ? 2 : AQI <= 200 ? 3 : AQI <= 300 ? 4 : 5;
    // Breakpoint band index derived from I_Lo
    const breakpointBand = !Number.isFinite(ILoN) ? Number.NaN
      : Math.round(ILoN / 50);
    // Pollutant detection via known EPA breakpoint tables (PM2.5, PM10, O3, NO2, SO2, CO)
    const POLLUTANT_BANDS: Array<{ code: number; lo: number; hi: number; ilo: number; ihi: number }> = [
      { code: 1, lo: 0, hi: 12.0, ilo: 0, ihi: 50 },
      { code: 1, lo: 12.1, hi: 35.4, ilo: 51, ihi: 100 },
      { code: 1, lo: 35.5, hi: 55.4, ilo: 101, ihi: 150 },
      { code: 1, lo: 55.5, hi: 150.4, ilo: 151, ihi: 200 },
      { code: 1, lo: 150.5, hi: 250.4, ilo: 201, ihi: 300 },
      { code: 1, lo: 250.5, hi: 350.4, ilo: 301, ihi: 400 },
      { code: 1, lo: 350.5, hi: 500.4, ilo: 401, ihi: 500 },
      { code: 2, lo: 0, hi: 54, ilo: 0, ihi: 50 },
      { code: 2, lo: 55, hi: 154, ilo: 51, ihi: 100 },
      { code: 2, lo: 155, hi: 254, ilo: 101, ihi: 150 },
      { code: 2, lo: 255, hi: 354, ilo: 151, ihi: 200 },
      { code: 2, lo: 355, hi: 424, ilo: 201, ihi: 300 },
      { code: 2, lo: 425, hi: 504, ilo: 301, ihi: 400 },
      { code: 2, lo: 505, hi: 604, ilo: 401, ihi: 500 },
      { code: 3, lo: 0, hi: 0.054, ilo: 0, ihi: 50 },
      { code: 3, lo: 0.055, hi: 0.070, ilo: 51, ihi: 100 },
      { code: 3, lo: 0.071, hi: 0.085, ilo: 101, ihi: 150 },
      { code: 3, lo: 0.086, hi: 0.105, ilo: 151, ihi: 200 },
      { code: 3, lo: 0.106, hi: 0.200, ilo: 201, ihi: 300 },
    ];
    const matched = valid && POLLUTANT_BANDS.find(b =>
      Math.abs(b.hi - BPHiN) <= 0.2 && Math.abs(b.lo - BPLoN) <= 0.2 &&
      Math.abs(b.ihi - IHiN) <= 5 && Math.abs(b.ilo - ILoN) <= 5);
    const pollutantCategory = matched ? matched.code : 0;
    if (!valid) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'breakpoint_band', value: Number.NaN, unit: '—', label: 'Breakpoint Band Index (0–5)' },
          { key: 'pollutant_category', value: Number.NaN, unit: '—', label: 'Pollutant Category (1 PM2.5, 2 PM10, 3 O3, 0 generic)' },
          { key: 'health_label', value: Number.NaN, unit: '—', label: 'Health Class (0 Good … 5 Hazardous)' },
        ],
        steps: ['── EPA AQI Breakpoint Interpolation (40 CFR Part 50 App. G) ──',
          'AQI = [(I_Hi−I_Lo)/(BP_Hi−BP_Lo)] × (C_p−BP_Lo) + I_Lo',
          '', 'One or more inputs are missing or unphysical — no fabricated AQI is substituted.'],
      };
    }
    // AQI vs concentration series across the breakpoint band
    const seriesPoints: Array<{ x: number; y: number }> = [];
    const stepCount = 20;
    for (let i = 0; i <= stepCount; i++) {
      const c = BPLoN + (i / stepCount) * (BPHiN - BPLoN);
      const ratio = (c - BPLoN) / denom;
      const aqi = (IHiN - ILoN) * ratio + ILoN;
      if (Number.isFinite(aqi)) seriesPoints.push({ x: c, y: aqi });
    }
    return {
      result: AQI, unit: '—',
      secondary: [
        { key: 'breakpoint_band', value: breakpointBand, unit: '—', label: 'Breakpoint Band Index (0–5)' },
        { key: 'pollutant_category', value: pollutantCategory, unit: '—', label: 'Pollutant Category (1 PM2.5, 2 PM10, 3 O3, 0 generic)' },
        { key: 'health_label', value: healthLabel, unit: '—', label: 'Health Class (0 Good … 5 Hazardous)' },
      ],
      series: seriesPoints.length > 0
        ? [{
            label: 'AQI vs Concentration',
            color: '#2ca02c',
            points: seriesPoints,
          }]
        : undefined,
      steps: [
        '── EPA AQI Breakpoint Interpolation (40 CFR Part 50 App. G) ──',
        `Breakpoints: BP_lo = ${BPLoN.toFixed(1)}, BP_hi = ${BPHiN.toFixed(1)}`,
        `Indices: I_lo = ${ILoN.toFixed(0)}, I_hi = ${IHiN.toFixed(0)}`,
        `Pollutant concentration C_p = ${CpN.toFixed(2)}`,
        '',
        'Step 1 — Ratio of concentration within breakpoint interval:',
        `  (C_p − BP_lo) / (BP_hi − BP_lo) = (${CpN.toFixed(2)} − ${BPLoN.toFixed(1)}) / (${BPHiN.toFixed(1)} − ${BPLoN.toFixed(1)})`,
        `  = ${concRatio.toFixed(4)}`,
        '',
        'Step 2 — Linear interpolation to AQI:',
        `  AQI = (I_hi − I_lo) × ratio + I_lo`,
        `  AQI = (${IHiN.toFixed(0)} − ${ILoN.toFixed(0)}) × ${concRatio.toFixed(4)} + ${ILoN.toFixed(0)}`,
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
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const XbarN = Number(Xbar), KpN = Number(Kp), sigmaXN = Number(sigmaX);
    const valid = [XbarN, KpN, sigmaXN].every(Number.isFinite) && XbarN >= 0 && sigmaXN >= 0 && KpN >= 0;
    const PMP = XbarN + KpN * sigmaXN;
    if (!valid) {
      return {
        result: Number.NaN, unit: 'mm',
        secondary: [
          { key: 'standard_deviation', value: Number.isFinite(sigmaXN) && sigmaXN >= 0 ? sigmaXN : Number.NaN, unit: 'mm', label: 'Standard Deviation σ_x' },
          { key: 'frequency_factor', value: Number.isFinite(KpN) && KpN >= 0 ? KpN : Number.NaN, unit: '—', label: 'Frequency Factor K_p' },
        ],
        steps: ['── Probable Maximum Precipitation — Hershfield Method (Hershfield, 1961; World Meteorological Organization, 1986) ──',
          'PMP = X̄ + K_p × σ_x',
          '', 'One or more inputs are missing or out of range — no fabricated PMP is substituted.'],
      };
    }
    return {
      result: PMP, unit: 'mm',
      secondary: [
        { key: 'standard_deviation', value: sigmaXN, unit: 'mm', label: 'Standard Deviation σ_x' },
        { key: 'frequency_factor', value: KpN, unit: '—', label: 'Frequency Factor K_p' },
      ],
      steps: [
        '── Probable Maximum Precipitation — Hershfield Method (Hershfield, 1961; World Meteorological Organization, 1986) ──',
        `Mean annual maximum rainfall X̄ = ${XbarN.toFixed(1)} mm`,
        `Frequency factor K_p = ${KpN.toFixed(2)} (typically 5–20 for PMP)`,
        `Standard deviation σ_x = ${sigmaXN.toFixed(1)} mm`,
        '',
        'Step 1 — Compute PMP:',
        `  PMP = X̄ + K_p × σ_x = ${XbarN.toFixed(1)} + ${KpN.toFixed(2)} × ${sigmaXN.toFixed(1)}`,
        `  PMP = ${PMP.toFixed(1)} mm`,
        '',
        'Step 2 — Comparison with observed maximum:',
        `  K_p = ${KpN.toFixed(2)} → ${KpN < 10 ? 'Moderate factor — less extreme basin' : 'High factor — extreme rainfall potential'}`,
        `  Ratio PMP / X̄ = ${(PMP / XbarN).toFixed(1)}× the mean annual maximum`,
        '',
        `  └ PMP used for design of high-hazard dams (spillway capacity), nuclear facilities`,
        `  └ Hershfield envelope: K_p max ≈ 15 for 24-hr PMP in most regions`,
      ]
    };
  },
  139: ({ Xim1, Zi, alpha = 0.897 }) => {
    // Palmer 1965: X_i = α · X_{i-1} + Z_i / 3
    // α = persistence factor, 0.897 is standard US calibration
    // PDSI is bounded to [−10, +10]
    const Xim1N = Number(Xim1), ZiN = Number(Zi), alphaN = Number(alpha);
    if (![Xim1N, ZiN, alphaN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'drought_classification', value: Number.NaN, unit: '—', label: 'Unknown' },
          { key: 'persistence_factor', value: Number.isFinite(alphaN) ? alphaN : Number.NaN, unit: '—', label: 'Persistence Factor α (Palmer 1965)' },
        ],
        steps: ['── Palmer Drought Severity Index (Palmer, 1965) ──',
          'X_i = α · X_{i-1} + Z_i / 3',
          '', 'One or more inputs are missing — no fabricated PDSI is substituted.'],
      };
    }
    let Xi = alphaN * Xim1N + ZiN / 3;

    // Clamp to Palmer's physical bounds
    if (Xi > 10) Xi = 10;
    if (Xi < -10) Xi = -10;

    // Drought classification (Palmer 1965)
    let classification: string;
    if (Xi > 4) classification = 'Extreme Wet (> +4)';
    else if (Xi > 3) classification = 'Severe Wet (+3 to +4)';
    else if (Xi > 2) classification = 'Moderate Wet (+2 to +3)';
    else if (Xi > 1) classification = 'Slight Wet (+1 to +2)';
    else if (Xi > -1) classification = 'Near Normal (−1 to +1)';
    else if (Xi > -2) classification = 'Incipient Drought (−1 to −2)';
    else if (Xi > -3) classification = 'Moderate Drought (−2 to −3)';
    else if (Xi > -4) classification = 'Severe Drought (−3 to −4)';
    else classification = 'Extreme Drought (< −4)';

    return {
      result: Xi, unit: '—',
      secondary: [
        { key: 'drought_classification', value: Xi, unit: '—', label: classification },
        { key: 'persistence_factor', value: alphaN, unit: '—', label: 'Persistence Factor α (Palmer 1965)' },
      ],
      steps: [
        '── Palmer Drought Severity Index (Palmer, 1965) ──',
        `  Previous month PDSI X_{i-1} = ${Xim1N.toFixed(3)}`,
        `  Moisture anomaly index Z_i = ${ZiN.toFixed(3)}`,
        `  Persistence factor α = ${alphaN} ${alphaN === 0.897 ? '(standard US calibration)' : '(user-supplied)'}`,
        '',
        'Step 1 — PDSI recurrence formula:',
        `  X_i = α × X_{i-1} + Z_i / 3`,
        `  X_i = ${alphaN} × ${Xim1N.toFixed(3)} + ${ZiN.toFixed(3)} / 3`,
        `  X_i = ${(alphaN * Xim1N).toFixed(4)} + ${(ZiN / 3).toFixed(4)}`,
        `  X_i = ${(alphaN * Xim1N + ZiN / 3).toFixed(4)}`,
        '',
        'Step 2 — Apply bounds [−10, +10]:',
        `  Clamped X_i = ${Xi.toFixed(4)}`,
        '',
        'Step 3 — Drought classification:',
        `  ${classification}`,
        '',
        '  └ 0.897 persistence factor calibrated for central US (Palmer 1965)',
        '  └ Z-index derived from: P, ET, soil moisture recharge, runoff vs climatically expected values',
      ]
    };
  },
  140: ({ K0, Vres, hb }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const K0n = Number(K0), Vresn = Number(Vres), hbn = Number(hb);
    // Froehlich 2008: B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19
    // B_avg is average BREACH WIDTH (meters), NOT discharge
    const valid = [K0n, Vresn, hbn].every(Number.isFinite) && K0n > 0 && Vresn > 0 && hbn > 0;
    const Bavg = 0.1803 * K0n * Math.pow(Vresn, 0.32) * Math.pow(hbn, 0.19);

    // Secondary outputs from Froehlich 2008:
    // Peak outflow: Q_p = 3.1 × B_avg × h_b^1.5 (broad-crested weir, USACE EM 1110-2-1619)
    const Qp = 3.1 * Bavg * Math.pow(hbn, 1.5);

    // Breach formation time: t_f = 0.0179 × K₁ × V_res^0.34 × h_b^(-0.14) hours
    // K₁ = 1.0 for overtopping, 1.5 for piping (K0 ≤ 1.3 = overtopping, > 1.3 = piping)
    const K1 = K0n > 1.3 ? 1.5 : 1.0;
    const tf_hours = 0.0179 * K1 * Math.pow(Vresn, 0.34) * Math.pow(hbn, -0.14);

    if (!valid) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'peak_outflow', value: Number.NaN, unit: 'm³/s', label: 'Peak Outflow Q_p (broad-crested weir)' },
          { key: 'breach_formation_time', value: Number.NaN, unit: 'hours', label: 'Breach Formation Time t_f' },
          { key: 'breach_factor_k1', value: Number.isFinite(K1) ? K1 : Number.NaN, unit: '—', label: 'Breach Factor K₁ (1.0 overtopping, 1.5 piping)' },
        ],
        steps: ['── Froehlich Dam Breach Parameters (Froehlich, 2008) ──',
          'B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19',
          '', 'One or more inputs are missing or unphysical (requires K₀ > 0, V_res > 0, h_b > 0) — no fabricated breach width is substituted.'],
      };
    }

    return {
      result: Bavg, unit: 'm',
      secondary: [
        { key: 'peak_outflow', value: Qp, unit: 'm³/s', label: 'Peak Outflow Q_p (broad-crested weir)' },
        { key: 'breach_formation_time', value: tf_hours, unit: 'hours', label: 'Breach Formation Time t_f' },
        { key: 'breach_factor_k1', value: K1, unit: '—', label: 'Breach Factor K₁ (1.0 overtopping, 1.5 piping)' },
      ],
      steps: [
        '── Froehlich Dam Breach Parameters (Froehlich, 2008) ──',
        `  Reservoir volume V_res = ${Vresn.toExponential(2)} m³`,
        `  Embankment height h_b = ${hbn.toFixed(1)} m`,
        `  Breach factor K₀ = ${K0n.toFixed(3)} ${K0n <= 1.3 ? '(overtopping)' : K0n <= 2.0 ? '(piping)' : '(elevated)'}`,
        '',
        'Step 1 — Average breach width:',
        `  B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19`,
        `  B_avg = 0.1803 × ${K0n.toFixed(3)} × ${Math.pow(Vresn, 0.32).toExponential(3)} × ${Math.pow(hbn, 0.19).toExponential(4)}`,
        `  B_avg = ${Bavg.toFixed(1)} m`,
        '',
        'Step 2 — Peak outflow (broad-crested weir):',
        `  Q_p = 3.1 × B_avg × h_b^1.5`,
        `  Q_p = 3.1 × ${Bavg.toFixed(1)} × ${Math.pow(hbn, 1.5).toFixed(1)}`,
        `  Q_p = ${Qp.toFixed(0)} m³/s`,
        '',
        'Step 3 — Breach formation time:',
        `  K₁ = ${K1} (${K0n > 1.3 ? 'piping' : 'overtopping'})`,
        `  t_f = 0.0179 × K₁ × V_res^0.34 × h_b^(-0.14)`,
        `  t_f = ${tf_hours.toFixed(2)} hours`,
        '',
        'Step 4 — Hazard classification:',
        `  ${Qp > 10000 ? 'CATASTROPHIC — >10,000 m³/s, massive downstream flooding' : Qp > 1000 ? 'MAJOR — 1,000–10,000 m³/s, significant flood wave' : Qp > 100 ? 'MODERATE — 100–1,000 m³/s, localized flooding' : 'MINOR — <100 m³/s, limited hazard'}`,
        '',
        `  └ 0.1803 is the regression constant from 108 historical dam failures`,
        `  └ K₀: 1.0 (overtopping), 1.3 (piping); K₁: 1.0 (overtopping), 1.5 (piping)`,
      ]
    };
  },

  // ── Domain 24: Data Assimilation ──
  141: ({ xf, Pf, y, R, H = 1 }) => {
    // Kalman Filter Analysis Step (Kalman 1960; Evensen 1994 EnKF)
    // x_a = x_f + K·(y − H·x_f)
    // K = P_f·H^T·(H·P_f·H^T + R)^{−1}
    // P_a = (I − K·H)·P_f
    if (!Number.isFinite(xf) || !Number.isFinite(Pf) || !Number.isFinite(y) || !Number.isFinite(R) || Pf <= 0 || R < 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'analysis_error_covariance', value: Number.NaN, unit: '—', label: 'Analysis Error Covariance P_a (NaN)' },
        { key: 'innovation', value: Number.NaN, unit: '—', label: 'Innovation d = y − H·x_f (NaN)' },
        { key: 'kalman_gain', value: Number.NaN, unit: '—', label: 'Kalman Gain K (NaN)' },
      ], steps: ['Error: Pf must be > 0 and R ≥ 0'] };
    }
    const den = H * Pf * H + R;
    const K = (Pf * H) / den;
    const innov = y - H * xf;
    const xa = xf + K * innov;   // ← correct: base state is x_f, NOT x_b
    const Pa = (1 - K * H) * Pf;  // analysis error covariance

    return {
      result: xa, unit: '—',
      secondary: [
        { key: 'analysis_error_covariance', value: Pa, unit: '—', label: 'Analysis Error Covariance P_a' },
        { key: 'innovation', value: innov, unit: '—', label: 'Innovation d = y − H·x_f' },
        { key: 'kalman_gain', value: K, unit: '—', label: 'Kalman Gain K' },
      ],
      steps: [
        '── Kalman Filter Analysis (Kalman 1960; Evensen 1994) ──',
        `  Forecast state x_f = ${xf.toFixed(4)}`,
        `  Forecast error covariance P_f = ${Pf.toFixed(4)}`,
        `  Observation y = ${y.toFixed(4)}`,
        `  Observation error variance R = ${R.toFixed(4)}`,
        `  Observation operator H = ${H.toFixed(4)}`,
        '',
        'Step 1 — Innovation (observation residual):',
        `  d = y − H·x_f = ${y.toFixed(4)} − ${H.toFixed(4)} × ${xf.toFixed(4)}`,
        `  d = ${innov.toFixed(4)}`,
        '',
        'Step 2 — Kalman gain:',
        `  K = P_f·H / (H·P_f·H + R)`,
        `  K = ${Pf.toFixed(4)} × ${H.toFixed(4)} / (${H.toFixed(4)} × ${Pf.toFixed(4)} × ${H.toFixed(4)} + ${R.toFixed(4)})`,
        `  K = ${K.toFixed(4)} ${K > 0.5 ? '(observation-weighted: R << P_f)' : K < 0.1 ? '(model-weighted: P_f << R)' : '(balanced: comparable uncertainties)'}`,
        '',
        'Step 3 — Analysis update:',
        `  x_a = x_f + K·d = ${xf.toFixed(4)} + ${K.toFixed(4)} × ${innov.toFixed(4)}`,
        `  x_a = ${xa.toFixed(4)}`,
        '',
        'Step 4 — Analysis error covariance:',
        `  P_a = (1 − K·H)·P_f = (1 − ${K.toFixed(4)} × ${H.toFixed(4)}) × ${Pf.toFixed(4)}`,
        `  P_a = ${Pa.toFixed(4)} ${Pa < Pf ? `(${((1 - Pa / Pf) * 100).toFixed(1)}% reduction from P_f)` : '(no reduction)'}`,
        '',
        `  └ The analysis x_a lies between x_f and y/H, weighted by their relative uncertainties`,
        `  └ EnKF extends this to ensembles: P_f estimated from ensemble spread, not explicit matrix`,
      ]
    };
  },
  142: ({ xb, H = 1, y, R, B }) => {
    // Optimal Interpolation (Lorenz 1969; Gandin 1963)
    // x_a = x_b + B·H^T·(H·B·H^T + R)^{-1}·(y − H·x_b)
    // Unlike KF (Tool 141), OI/3D-Var uses x_b as base state (not x_f)
    if (!Number.isFinite(xb) || !Number.isFinite(B) || !Number.isFinite(y) || !Number.isFinite(R) || !Number.isFinite(H) || B <= 0 || R < 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'analysis_increment', value: Number.NaN, unit: '—', label: 'Analysis Increment x_a − x_b (NaN)' },
        { key: 'analysis_error_variance', value: Number.NaN, unit: '—', label: 'Analysis Error Variance P_a (NaN)' },
        { key: 'kalman_gain', value: Number.NaN, unit: '—', label: 'OI Gain K (NaN)' },
      ], steps: ['Error: B must be > 0 and R ≥ 0'] };
    }
    const den = H * B * H + R;
    const K = (B * H) / den;
    const innov = y - H * xb;
    const xa = xb + K * innov;
    const Pa = (1 - K * H) * B;  // analysis error variance

    return {
      result: xa, unit: '—',
      secondary: [
        { key: 'analysis_increment', value: xa - xb, unit: '—', label: 'Analysis Increment x_a − x_b' },
        { key: 'analysis_error_variance', value: Pa, unit: '—', label: 'Analysis Error Variance P_a' },
        { key: 'kalman_gain', value: K, unit: '—', label: 'OI Gain K' },
      ],
      steps: [
        '── Optimal Interpolation (Lorenz 1969; Gandin 1963) ──',
        `  Background x_b = ${xb.toFixed(4)}, Background error covariance B = ${B.toFixed(4)}`,
        `  Observation y = ${y.toFixed(4)}, Observation error variance R = ${R.toFixed(4)}`,
        `  Observation operator H = ${H.toFixed(4)}`,
        '',
        'Step 1 — Innovation:',
        `  d = y − H·x_b = ${y.toFixed(4)} − ${H.toFixed(4)} × ${xb.toFixed(4)}`,
        `  d = ${innov.toFixed(4)}`,
        '',
        'Step 2 — OI gain:',
        `  K = B·H / (H·B·H + R) = ${B.toFixed(4)} × ${H.toFixed(4)} / (${H.toFixed(4)} × ${B.toFixed(4)} × ${H.toFixed(4)} + ${R.toFixed(4)})`,
        `  K = ${K.toFixed(4)} ${K > 0.5 ? '(obs-weighted: B >> R)' : K < 0.1 ? '(bg-weighted: R >> B)' : '(balanced)'}`,
        '',
        'Step 3 — Analysis:',
        `  x_a = x_b + K·d = ${xb.toFixed(4)} + ${K.toFixed(4)} × ${innov.toFixed(4)}`,
        `  x_a = ${xa.toFixed(4)}`,
        '',
        'Step 4 — Analysis error variance:',
        `  P_a = (1 − K·H)·B = (1 − ${K.toFixed(4)} × ${H.toFixed(4)}) × ${B.toFixed(4)}`,
        `  P_a = ${Pa.toFixed(4)} ${Pa < B ? `(${((1 - Pa / B) * 100).toFixed(1)}% reduction)` : '(no reduction)'}`,
        '',
        `  └ OI uses static B (no flow dependence) — 3D-Var extends to cost-function minimization`,
        `  └ Unlike KF (Tool 141), OI uses x_b as base state (not x_f)`,
      ]
    };
  },
  143: ({ x, xb, B, y, H, R }) => {
    // 3D-Var Cost Function (Le Dimet & Talagrand 1986)
    // J(x) = ½(x − x_b)ᵀ B⁻¹ (x − x_b) + ½(y − H·x)ᵀ R⁻¹ (y − H·x)
    // This is the single-time-step evaluation; 4D-Var sums over a time window
    if (!Number.isFinite(x) || !Number.isFinite(xb) || !Number.isFinite(B) || !Number.isFinite(y) || !Number.isFinite(H) || !Number.isFinite(R) || B <= 0 || R <= 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'background_term', value: Number.NaN, unit: '—', label: 'Background Term J_b (NaN)' },
        { key: 'observation_term', value: Number.NaN, unit: '—', label: 'Observation Term J_o (NaN)' },
        { key: 'optimal_analysis', value: Number.NaN, unit: '—', label: 'Optimal Analysis x_a (∇J = 0) (NaN)' },
      ], steps: ['Error: B > 0 and R > 0 required'] };
    }
    const bgTerm = 0.5 * (x - xb) * (1 / B) * (x - xb);
    const obsTerm = 0.5 * (y - H * x) * (1 / R) * (y - H * x);
    const J = bgTerm + obsTerm;

    // Optimal analysis (set ∇J = 0): x_a = (B⁻¹ + HᵀR⁻¹H)⁻¹ (B⁻¹x_b + HᵀR⁻¹y)
    // For scalar: x_a = (x_b/B + H*y/R) / (1/B + H²/R)
    const xa = (xb / B + H * y / R) / (1 / B + H * H / R);

    return {
      result: J, unit: '—',
      secondary: [
        { key: 'background_term', value: bgTerm, unit: '—', label: 'Background Term J_b' },
        { key: 'observation_term', value: obsTerm, unit: '—', label: 'Observation Term J_o' },
        { key: 'optimal_analysis', value: xa, unit: '—', label: 'Optimal Analysis x_a (∇J = 0)' },
      ],
      steps: [
        '── 3D-Var Cost Function (Le Dimet & Talagrand 1986) ──',
        `  State x = ${x.toFixed(4)}, Background x_b = ${xb.toFixed(4)}`,
        `  Background error covariance B = ${B.toFixed(4)}`,
        `  Observation y = ${y.toFixed(4)}, Observation error R = ${R.toFixed(4)}`,
        `  Observation operator H = ${H.toFixed(4)}`,
        '',
        'Step 1 — Background term:',
        `  J_b = ½(x − x_b)² / B = ½ × (${x.toFixed(4)} − ${xb.toFixed(4)})² / ${B.toFixed(4)}`,
        `  J_b = ${bgTerm.toFixed(4)}`,
        '',
        'Step 2 — Observation term:',
        `  J_o = ½(y − H·x)² / R = ½ × (${y.toFixed(4)} − ${H.toFixed(4)} × ${x.toFixed(4)})² / ${R.toFixed(4)}`,
        `  J_o = ${obsTerm.toFixed(4)}`,
        '',
        'Step 3 — Total cost:',
        `  J(x) = J_b + J_o = ${bgTerm.toFixed(4)} + ${obsTerm.toFixed(4)}`,
        `  J(x) = ${J.toFixed(4)}`,
        '',
        'Step 4 — Optimal analysis (∇J = 0):',
        `  x_a = (x_b/B + H·y/R) / (1/B + H²/R)`,
        `  x_a = ${xa.toFixed(4)}`,
        `  J(x_a) = ${((0.5 * (xa - xb) * (1 / B) * (xa - xb)) + (0.5 * (y - H * xa) * (1 / R) * (y - H * xa))).toFixed(4)} (minimum)`,
        '',
        `  └ bg/obs = ${obsTerm !== 0 ? (bgTerm / obsTerm).toFixed(2) : '∞'} — ${bgTerm > obsTerm ? 'Background-dominated (strong constraint)' : obsTerm > bgTerm ? 'Obs-dominated (weak constraint)' : 'Balanced'}`,
        `  └ 4D-Var extends to time window: J = J_b + Σᵢ J_o(tᵢ) with adjoint model for gradient`,
      ]
    };
  },
  144: ({ px, py, Hxy }) => {
    // Shannon Information Entropy (Shannon 1948)
    // For a binary variable: H(X) = −p·log₂(p) − (1−p)·log₂(1−p)
    // Mutual information: I(X;Y) = H(X) + H(Y) − H(X,Y)
    // Hxy is the joint entropy H(X,Y), not a probability
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(Hxy) || px <= 0 || px >= 1 || py <= 0 || py >= 1) {
      return { result: NaN, unit: 'bits', secondary: [
        { key: 'entropy_y', value: Number.NaN, unit: 'bits', label: 'Entropy H(Y) (NaN)' },
        { key: 'joint_entropy', value: Number.NaN, unit: 'bits', label: 'Joint Entropy H(X,Y) (NaN)' },
        { key: 'mutual_information', value: Number.NaN, unit: 'bits', label: 'Mutual Information I(X;Y) (NaN)' },
      ], steps: ['Error: px, py must be in (0, 1)'] };
    }

    // Binary entropy: H(p) = −p·log₂(p) − (1−p)·log₂(1−p)
    const Hx = -(px * Math.log2(px) + (1 - px) * Math.log2(1 - px));
    const Hy = -(py * Math.log2(py) + (1 - py) * Math.log2(1 - py));

    // Hxy is the joint entropy H(X,Y) in bits (directly provided)
    const Hjoint = Hxy;

    // Mutual information: I(X;Y) = H(X) + H(Y) − H(X,Y)
    const MI = Hx + Hy - Hjoint;

    return {
      result: Hx, unit: 'bits',
      secondary: [
        { key: 'entropy_y', value: Hy, unit: 'bits', label: 'Entropy H(Y)' },
        { key: 'joint_entropy', value: Hjoint, unit: 'bits', label: 'Joint Entropy H(X,Y)' },
        { key: 'mutual_information', value: MI, unit: 'bits', label: 'Mutual Information I(X;Y)' },
      ],
      steps: [
        '── Shannon Information Entropy (Shannon 1948) ──',
        `  p(x) = ${px.toFixed(4)}, p(y) = ${py.toFixed(4)}`,
        `  Joint entropy H(X,Y) = ${Hjoint.toFixed(4)} bits (provided)`,
        '',
        'Step 1 — Binary entropy H(X):',
        `  H(X) = −p·log₂(p) − (1−p)·log₂(1−p)`,
        `  H(X) = −${px.toFixed(4)}·log₂(${px.toFixed(4)}) − ${(1-px).toFixed(4)}·log₂(${(1-px).toFixed(4)})`,
        `  H(X) = ${Hx.toFixed(4)} bits ${Hx === 1 ? '(maximum for binary)' : Hx < 0.1 ? '(near-deterministic)' : ''}`,
        '',
        'Step 2 — Binary entropy H(Y):',
        `  H(Y) = −${py.toFixed(4)}·log₂(${py.toFixed(4)}) − ${(1-py).toFixed(4)}·log₂(${(1-py).toFixed(4)})`,
        `  H(Y) = ${Hy.toFixed(4)} bits`,
        '',
        'Step 3 — Mutual information:',
        `  I(X;Y) = H(X) + H(Y) − H(X,Y)`,
        `  I(X;Y) = ${Hx.toFixed(4)} + ${Hy.toFixed(4)} − ${Hjoint.toFixed(4)}`,
        `  I(X;Y) = ${MI.toFixed(4)} bits ${MI === 0 ? '(independent)' : MI > 0 ? '(dependent)' : '(inconsistent: H(X,Y) > H(X)+H(Y))'}`,
        '',
        `  └ I(X;Y) ≥ 0 always; I = 0 iff X,Y independent; I = min(H(X),H(Y)) iff one determines the other` ,
      ]
    };
  },

  // ── Domain 25: Signal Processing ──
  145: ({ dKm, fGHz }) => {
    // Free-Space Path Loss (Friis 1946; ITU-R P.525-2)
    // FSPL(dB) = 32.45 + 20·log₁₀(d_km) + 20·log₁₀(f_GHz)
    if (!Number.isFinite(dKm) || !Number.isFinite(fGHz) || dKm <= 0 || fGHz <= 0) {
      return { result: NaN, unit: 'dB', secondary: [
        { key: 'wavelength_m', value: Number.NaN, unit: 'm', label: 'Wavelength λ = c/f (NaN)' },
        { key: 'received_power_dBm', value: Number.NaN, unit: 'dBm', label: 'Received Power P_r (NaN)' },
      ], steps: ['Error: d > 0 and f > 0 required'] };
    }
    const logD = 20 * Math.log10(dKm);
    const logF = 20 * Math.log10(fGHz);
    const FSPL = 32.45 + logD + logF;
    const lambda_m = 0.3 / fGHz;  // λ = c/f, c ≈ 3×10⁸ m/s → 0.3/f(GHz) m

    // Reference link budget: P_t=40 dBm (10 W), G_t=20 dBi, G_r=0 dBi
    const Pt = 40, Gt = 20, Gr = 0;
    const Pr = Pt + Gt + Gr - FSPL;

    return {
      result: FSPL, unit: 'dB',
      secondary: [
        { key: 'wavelength_m', value: lambda_m, unit: 'm', label: 'Wavelength λ = c/f' },
        { key: 'received_power_dBm', value: Pr, unit: 'dBm', label: 'Received Power P_r (10 W, 20 dBi ref link)' },
      ],
      steps: [
        '── Free-Space Path Loss (Friis 1946; ITU-R P.525-2) ──',
        `  Distance d = ${dKm >= 1e6 ? (dKm/1e6).toFixed(2) + '×10⁶ km' : dKm >= 1000 ? (dKm/1000).toFixed(1) + '×10³ km' : dKm.toFixed(1) + ' km'}`,
        `  Frequency f = ${fGHz >= 1 ? fGHz.toFixed(2) + ' GHz' : (fGHz*1000).toFixed(0) + ' MHz'}`,
        `  Wavelength λ = 0.3/f = ${lambda_m.toFixed(4)} m (${(lambda_m*100).toFixed(2)} cm)`,
        '',
        'Step 1 — Distance term:',
        `  20·log₁₀(${dKm.toExponential(2)}) = ${logD.toFixed(2)} dB`,
        '',
        'Step 2 — Frequency term:',
        `  20·log₁₀(${fGHz.toExponential(2)}) = ${logF.toFixed(2)} dB`,
        '',
        'Step 3 — Free-space path loss:',
        `  FSPL = 32.45 + ${logD.toFixed(2)} + ${logF.toFixed(2)}`,
        `  FSPL = ${FSPL.toFixed(2)} dB`,
        '',
        'Step 4 — Reference link budget:',
        `  P_r = P_t + G_t + G_r − FSPL = ${Pt} + ${Gt} + ${Gr} − ${FSPL.toFixed(2)}`,
        `  P_r = ${Pr.toFixed(2)} dBm ${Pr > -100 ? '(strong signal)' : Pr > -140 ? '(weak but detectable)' : '(below typical receiver sensitivity)'}` ,
        '',
        `  └ FSPL increases 6 dB per doubling of distance (inverse-square law)`,
        `  └ FSPL increases 6 dB per doubling of frequency`,
      ]
    };
  },
   146: ({ alpha1, alpha2, alpha3, alpha4, beta1, beta2, beta3, beta4, phi_m, t_sec, elevation }) => {
      // Full Klobuchar (1987) ICD-GPS-200: compute amplitude & period from 8
      // broadcast coefficients. NOTE the paper's units: "all angles are in
      // units of semi-circle" — the α/β polynomials are evaluated with φ_m in
      // SEMICIRCLES (180° = 1), NOT degrees. Using degrees yields ~9 orders of
      // magnitude error in the amplitude term.
      const phiMDeg = Number(phi_m ?? 0);      // geomagnetic latitude of IPP (°)
      const phiM_sc = phiMDeg / 180;   // → semicircles (paper eq. 4)
      const tSec = Number(t_sec ?? 50400);     // local time at IPP (s), default 14:00 peak
      const elevDeg = Number(elevation ?? 90); // satellite elevation (°), default zenith
      const elev_sc = elevDeg / 180;   // → semicircles
      // Physical defaults: real broadcast α are ~1e-8 s (amplitude in seconds
      // per unit of geomagnetic latitude, semicircles); β are ~1e4 s (period).
      const Ai = Number(alpha1 ?? 5e-9) + Number(alpha2 ?? 0) * phiM_sc + Number(alpha3 ?? 0) * phiM_sc ** 2 + Number(alpha4 ?? 0) * phiM_sc ** 3;   // amplitude (s)
      const Pi = Math.max(200, Number(beta1 ?? 50400) + Number(beta2 ?? 0) * phiM_sc + Number(beta3 ?? 0) * phiM_sc ** 2 + Number(beta4 ?? 0) * phiM_sc ** 3); // period (s), clamped ≥200
      const x = 2 * Math.PI * (tSec - 50400) / Pi;
      const poly = 1 - (x * x) / 2 + Math.pow(x, 4) / 24;
      // Nighttime: |x| >= π/2 → no ionospheric delay beyond the 5 ns base
      const delay_s = Math.abs(x) < Math.PI / 2 ? 5e-9 + Math.max(0, Ai) * poly : 5e-9;
      // Obliquity (slant) factor: F = 1 + 16·(0.53 − E)³, E in semicircles
      // (paper "SUMMARY OF ALGORITHM EQUATIONS" step 6).
      const F = 1 + 16 * Math.pow(0.53 - elev_sc, 3);
      const slant_s = delay_s * F;
      const delay_ns = delay_s * 1e9;
      const slant_ns = slant_s * 1e9;
      const rangeErr = slant_s * 299792458;
      return {
        result: delay_ns, unit: 'ns',
        secondary: [
          { key: 'slant_delay', value: Number.isFinite(slant_ns) ? slant_ns : Number.NaN, unit: 'ns', label: 'Slant Delay (with obliquity F)' },
          { key: 'slant_factor', value: Number.isFinite(F) ? F : Number.NaN, unit: '—', label: 'Obliquity Factor F' },
          { key: 'range_error', value: Number.isFinite(rangeErr) ? rangeErr : Number.NaN, unit: 'm', label: 'Range Error (c·τ)' },
          { key: 'amplitude', value: Number.isFinite(Ai) ? Ai : Number.NaN, unit: 's', label: 'Amplitude A (α polynomial)' },
          { key: 'period', value: Number.isFinite(Pi) ? Pi : Number.NaN, unit: 's', label: 'Period P (β polynomial)' },
        ],
        // Timeseries series (tool vizType 'timeseries'): vertical ionospheric
        // delay τ(t) over the full diurnal cycle (local time 0–86400 s,
        // 24 points) from the tool's own Klobuchar formula
        // Δτ = 5 ns + A·(1 − x²/2 + x⁴/24), x = 2π(t−50400)/P.
        series: [{
          label: 'Klobuchar vertical delay τ(t) (local time, ns)',
          color: '#0072B2',
          points: Array.from({ length: 24 }, (_, i) => {
            const tt = i * (86400 / 23); // local time 0 → 86400 s
            const xx = 2 * Math.PI * (tt - 50400) / Pi;
            const polyy = 1 - (xx * xx) / 2 + Math.pow(xx, 4) / 24;
            const delay = Math.abs(xx) < Math.PI / 2 ? 5e-9 + Math.max(0, Ai) * polyy : 5e-9;
            const delayNS = delay * 1e9;
            return { x: tt, y: Number.isFinite(delayNS) ? delayNS : Number.NaN };
          }),
        }],
        steps: [
          '── Klobuchar Ionospheric Delay Model (Klobuchar, 1987; ICD-GPS-200) ──',
          `Geomagnetic latitude φ_m = ${phiMDeg.toFixed(2)}° = ${phiM_sc.toFixed(4)} semicircles (paper: angles in semicircles)`,
          `Local time at IPP t = ${tSec} s (${(tSec / 3600).toFixed(2)} h)`,
          `Elevation E = ${elevDeg.toFixed(1)}° (obliquity F = 1 + 16(0.53−E)³)`,
          '',
          'Step 1 — Amplitude (α polynomial, φ_m in semicircles):',
          `  A = α₀ + α₁·φ_m + α₂·φ_m² + α₃·φ_m³ = ${Ai.toExponential(2)} s`,
          '',
          'Step 2 — Period (β polynomial):',
          `  P = β₀ + β₁·φ_m + β₂·φ_m² + β₃·φ_m³ = ${Pi.toExponential(3)} s`,
          '',
          'Step 3 — Normalised time x = 2π(t − 50400)/P:',
          `  x = ${x.toFixed(4)} (drives cosinusoidal shape)`,
          '',
          'Step 4 — Polynomial approximation of cosine:',
          `  1 − x²/2 + x⁴/24 = 1 − (${x.toFixed(4)})²/2 + (${x.toFixed(4)})⁴/24`,
          `  = ${poly.toFixed(4)}`,
          '',
          'Step 5 — Vertical delay at L1 (1.57542 GHz):',
          `  Δτ = 5 ns + A × (1 − x²/2 + x⁴/24)`,
          `  Δτ = 5 ns + ${Ai.toExponential(2)} × ${poly.toFixed(4)}`,
          `  Δτ = ${delay_s.toExponential(3)} s = ${delay_ns.toFixed(1)} ns`,
          '',
          'Step 6 — Obliquity (slant) factor F = 1 + 16·(0.53 − E)³:',
          `  F = 1 + 16 × (0.53 − ${elev_sc.toFixed(4)})³ = ${F.toFixed(4)}`,
          `  Slant delay = ${slant_s.toExponential(3)} s = ${slant_ns.toFixed(1)} ns`,
          '',
          'Step 7 — Range error equivalent:',
          `  Δρ = c·Δτ = ${rangeErr.toFixed(2)} m`,
          '',
          'Step 8 — Diurnal variation:',
          `  ${delay_ns > 15 ? 'HIGH delay — midday / equatorial / solar max conditions' : delay_ns > 5 ? 'MODERATE — typical mid-latitude daytime' : 'LOW — night-time / polar / solar minimum'}`,
          '',
          `  └ Klobuchar removes ~50% RMS error; dual-frequency (L1/L2) removes >90%`,
          `  └ Paper worked example (40°N,100°W, E=20°): α=[3.82e-8,1.49e-8,-1.79e-7,0], β=[1.43e5,0,-3.28e5,1.13e5], φ_m=45.16°, t=50700 s → TIONO = 77.6 ns (23.3 m) — reproduced exactly (F=2.176).`,
        ]
      };
    },
  147: ({ f0, vrel, c: cLight }) => {
    // Classical Doppler Effect (Doppler 1842)
    // Non-relativistic: Δf = −f₀ · v/c (v positive = receding → redshift)
    // Relativistic: f_obs = f₀ · √((1−β)/(1+β)) where β = v/c
    const c0 = cLight || 299792458;
    if (!Number.isFinite(f0) || f0 <= 0 || !Number.isFinite(vrel) || !Number.isFinite(c0) || c0 <= 0 || Math.abs(vrel) >= c0) {
      return { result: NaN, unit: 'Hz', secondary: [
        { key: 'relativistic_shift', value: Number.NaN, unit: 'Hz', label: 'Relativistic Frequency Shift (exact) (NaN)' },
        { key: 'observed_frequency', value: Number.NaN, unit: 'Hz', label: 'Observed Frequency (relativistic) (NaN)' },
        { key: 'beta', value: Number.NaN, unit: '—', label: 'β = v/c (NaN)' },
      ], steps: ['Error: f0 > 0, finite v_rel, and |v| < c required'] };
    }
    const beta = vrel / c0;
    const isRecede = vrel > 0;

    // Non-relativistic frequency shift (sign: positive v → redshift → negative Δf)
    const df_nonrel = -f0 * beta + 0;  // +0 normalizes signed zero for v = 0

    // Relativistic frequency shift (exact)
    const gammaRel = 1 / Math.sqrt(1 - beta * beta);
    const df_rel = f0 * (gammaRel * (1 - beta) - 1);  // exact: f_obs = f₀·√((1−β)/(1+β))
    const f_obs_rel = f0 + df_rel;

    // For v << c, both should agree
    const relError = Math.abs(df_nonrel) > 0 ? Math.abs((df_rel - df_nonrel) / df_nonrel) * 100 : 0;

    return {
      result: df_nonrel, unit: 'Hz',
      secondary: [
        { key: 'relativistic_shift', value: df_rel, unit: 'Hz', label: 'Relativistic Frequency Shift (exact)' },
        { key: 'observed_frequency', value: f_obs_rel, unit: 'Hz', label: 'Observed Frequency (relativistic)' },
        { key: 'beta', value: beta, unit: '—', label: 'β = v/c' },
      ],
      series: [{
        label: 'Classical vs Relativistic Δf (f₀ fixed)',
        points: Array.from({ length: 41 }, (_, i) => {
          const v = -0.8 * c0 + i * (1.6 * c0 / 40);  // β from −0.8c to +0.8c
          const b = v / c0;
          const rel = f0 * (1 / Math.sqrt(1 - b * b) * (1 - b) - 1);
          return { x: b, y: rel };
        }),
      }],
      steps: [
        '── Classical Doppler Effect (Doppler 1842) ──',
        `  Source frequency f₀ = ${f0.toExponential(4)} Hz`,
        `  Relative velocity v = ${vrel.toFixed(1)} m/s (${isRecede ? 'receding' : 'approaching'})`,
        `  Speed of light c = ${c0.toExponential(4)} m/s`,
        '',
        'Step 1 — β factor:',
        `  β = v/c = ${vrel.toFixed(1)} / ${c0.toExponential(4)} = ${beta.toExponential(4)}`,
        `  ${Math.abs(beta) < 0.01 ? '(non-relativistic regime: β ≪ 1)' : Math.abs(beta) < 0.1 ? '(mildly relativistic)' : '(relativistic — use exact formula)'}`,
        '',
        'Step 2 — Frequency shift (non-relativistic):',
        `  Δf = −f₀ × β = −${f0.toExponential(4)} × ${beta.toExponential(4)}`,
        `  Δf = ${df_nonrel.toExponential(4)} Hz (${Math.abs(df_nonrel) > 1e6 ? (df_nonrel / 1e6).toFixed(2) + ' MHz' : Math.abs(df_nonrel) > 1e3 ? (df_nonrel / 1e3).toFixed(2) + ' kHz' : df_nonrel.toFixed(2) + ' Hz'})`,
        '',
        'Step 3 — Observed frequency:',
        `  f_obs = f₀ + Δf = ${(f0 + df_nonrel).toExponential(4)} Hz`,
        `  ${isRecede ? 'REDSHIFT (receding: f_obs < f₀)' : 'BLUESHIFT (approaching: f_obs > f₀)'}`,
        '',
        'Step 4 — Relativistic correction:',
        `  Δf_rel = ${df_rel.toExponential(4)} Hz (error: ${relError.toFixed(4)}%)`,
        '',
        `  └ GPS satellites: Doppler shift ~±5 kHz at L1 (1.575 GHz, v≈3.9 km/s)`,
        `  └ Weather radar: Doppler measures radial velocity of precipitation`,
      ]
    };
  },

  // ── Domain 26: Mathematical Frameworks ──
  148: ({ GM, r1, r2 }) => {
    // Hohmann Transfer (Hohmann 1925)
    // Δv₁ = √(GM/r₁)·[√(2r₂/(r₁+r₂)) − 1]
    // Δv₂ = √(GM/r₂)·[1 − √(2r₁/(r₁+r₂))]
    if (!Number.isFinite(GM) || !Number.isFinite(r1) || !Number.isFinite(r2) || r1 <= 0 || r2 <= 0 || GM <= 0) {
      return { result: NaN, unit: 'm/s', secondary: [
        { key: 'dv2', value: Number.NaN, unit: 'm/s', label: 'Circularization Δv₂ (NaN)' },
        { key: 'total_dv', value: Number.NaN, unit: 'm/s', label: 'Total Δv = |Δv₁| + |Δv₂| (NaN)' },
        { key: 'transfer_time_s', value: Number.NaN, unit: 's', label: 'Transfer Time (half period) (NaN)' },
        { key: 'transfer_time_h', value: Number.NaN, unit: 'h', label: 'Transfer Time (NaN)' },
        { key: 'semi_major_axis', value: Number.NaN, unit: 'm', label: 'Transfer Ellipse Semi-Major Axis (NaN)' },
        { key: 'period', value: Number.NaN, unit: 's', label: 'Transfer Orbit Period (NaN)' },
      ], steps: ['Error: GM, r1, r2 must be > 0'] };
    }
    const v_circ1 = Math.sqrt(GM / r1);
    const v_circ2 = Math.sqrt(GM / r2);
    const sqrtTerm = Math.sqrt(2 * r2 / (r1 + r2));
    const dv1 = v_circ1 * (sqrtTerm - 1);
    const dv2 = v_circ2 * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
    const totalDV = Math.abs(dv1) + Math.abs(dv2);  // use absolute values for total
    const semiMajor = (r1 + r2) / 2;
    const period = 2 * Math.PI * Math.sqrt(Math.pow(semiMajor, 3) / GM);
    const transferTime = period / 2;
    const ratio = r2 / r1;

    return {
      result: dv1, unit: 'm/s',
      secondary: [
        { key: 'dv2', value: dv2, unit: 'm/s', label: 'Circularization Δv₂' },
        { key: 'total_dv', value: totalDV, unit: 'm/s', label: 'Total Δv = |Δv₁| + |Δv₂|' },
        { key: 'transfer_time_s', value: transferTime, unit: 's', label: 'Transfer Time (half period)' },
        { key: 'transfer_time_h', value: transferTime / 3600, unit: 'h', label: 'Transfer Time' },
        { key: 'semi_major_axis', value: semiMajor, unit: 'm', label: 'Transfer Ellipse Semi-Major Axis' },
        { key: 'period', value: period, unit: 's', label: 'Transfer Orbit Period' },
      ],
      series: [{
        label: 'Transfer-orbit velocity vs radius (r₁ → r₂)',
        points: Array.from({ length: 51 }, (_, i) => {
          const r = r1 + i * (r2 - r1) / 50;
          return { x: r / 1000, y: Math.sqrt(GM / r) / 1000 };
        }),
      }],
      steps: [
        '── Hohmann Transfer Orbit (Hohmann 1925) ──',
        `  GM = ${GM.toExponential(3)} m³/s², r₁ = ${(r1/1000).toFixed(0)} km, r₂ = ${(r2/1000).toFixed(0)} km` ,
        `  r₂/r₁ = ${ratio.toFixed(2)} ${ratio < 11.94 ? '(Hohmann optimal)' : '(bi-elliptic may be more efficient)'}` ,
        '',
        'Step 1 — Circular velocities:',
        `  v₁ = √(GM/r₁) = ${(v_circ1/1000).toFixed(2)} km/s` ,
        `  v₂ = √(GM/r₂) = ${(v_circ2/1000).toFixed(2)} km/s` ,
        '',
        'Step 2 — Δv₁ (injection burn at r₁):',
        `  Δv₁ = v₁·[√(2r₂/(r₁+r₂)) − 1] = ${(dv1/1000).toFixed(3)} km/s` ,
        '',
        'Step 3 — Δv₂ (circularization burn at r₂):',
        `  Δv₂ = v₂·[1 − √(2r₁/(r₁+r₂))] = ${(dv2/1000).toFixed(3)} km/s` ,
        '',
        'Step 4 — Total:',
        `  |Δv₁| + |Δv₂| = ${(totalDV/1000).toFixed(3)} km/s` ,
        `  Transfer time = ${(transferTime/3600).toFixed(1)} h = ${(transferTime/86400).toFixed(1)} days` ,
        '',
        `  └ Hohmann is optimal for r₂/r₁ < 11.94; above that, bi-elliptic transfer saves fuel` ,
      ]
    };
  },
  149: ({ x: m1, y: m2 }) => {
    // Lagrange Points L1-L5 (Lagrange 1772; Euler 1767)
    // Circular Restricted 3-Body Problem (CR3BP)
    // x = m1 (primary mass), y = m2 (secondary mass)
    if (!Number.isFinite(m1) || !Number.isFinite(m2) || m1 <= 0 || m2 <= 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'L1_from_secondary', value: Number.NaN, unit: '—', label: 'L1 distance from secondary (NaN)' },
        { key: 'L2_from_secondary', value: Number.NaN, unit: '—', label: 'L2 distance from secondary (NaN)' },
        { key: 'L4_x', value: Number.NaN, unit: '—', label: 'L4 x-coordinate (NaN)' },
        { key: 'L4_y', value: Number.NaN, unit: '—', label: 'L4 y-coordinate (NaN)' },
        { key: 'L5_x', value: Number.NaN, unit: '—', label: 'L5 x-coordinate (NaN)' },
        { key: 'L5_y', value: Number.NaN, unit: '—', label: 'L5 y-coordinate (NaN)' },
        { key: 'mass_ratio', value: Number.NaN, unit: '—', label: 'Mass ratio μ = M₂/(M₁+M₂) (NaN)' },
      ], steps: ['Error: m1 > 0 and m2 > 0 required'] };
    }
    const mu = m2 / (m1 + m2);  // mass ratio

    // Newton-Raphson for the collinear equilibrium (force balance in the
    // rotating frame). r is measured from the secondary:
    //   L1 (between masses): r in (0,1), f1 = (1-μ-r) − (1-μ)/(1−r)² + μ/r²
    //   L2 (beyond secondary): r > 0,      f2 = (1-μ+r) − (1-μ)/(1+r)² − μ/r²
    //   L3 (far side of primary): u = distance from primary,
    //       f3 = u + μ − (1-μ)/u² − μ/(u+1)²
    function solveNR(f: (r: number) => number, fp: (r: number) => number, init: number, maxIter = 50): number {
      let r = init;
      for (let i = 0; i < maxIter; i++) {
        const df = fp(r);
        if (!Number.isFinite(df) || Math.abs(df) < 1e-15) break;
        const dr = f(r) / df;
        r -= dr;
        if (!Number.isFinite(r) || Math.abs(dr) < 1e-15) break;
      }
      return r;
    }

    // L1: between primary and secondary, measured from secondary toward primary
    const f1 = (r: number) => (1 - mu - r) - (1 - mu) / Math.pow(1 - r, 2) + mu / (r * r);
    const f1p = (r: number) => -1 - 2 * (1 - mu) / Math.pow(1 - r, 3) - 2 * mu / Math.pow(r, 3);
    const rL1 = solveNR(f1, f1p, 1 - Math.pow(mu / 3, 1 / 3));

    // L2: beyond secondary, measured from secondary away from primary
    const f2 = (r: number) => (1 - mu + r) - (1 - mu) / Math.pow(1 + r, 2) - mu / (r * r);
    const f2p = (r: number) => 1 + 2 * (1 - mu) / Math.pow(1 + r, 3) + 2 * mu / Math.pow(r, 3);
    const rL2 = solveNR(f2, f2p, 1 + Math.pow(mu / 3, 1 / 3));

    // L3: on opposite side of primary from secondary, u = distance from primary
    const f3 = (u: number) => u + mu - (1 - mu) / (u * u) - mu / Math.pow(u + 1, 2);
    const f3p = (u: number) => 1 + 2 * (1 - mu) / Math.pow(u, 3) + 2 * mu / Math.pow(u + 1, 3);
    const uL3 = Math.abs(solveNR(f3, f3p, 1.0));

    // L4, L5: triangular points at ±60° from secondary
    // In rotating frame: x = 0.5 - mu, y = ±√3/2
    const xL4 = 0.5 - mu;
    const yL4 = Math.sqrt(3) / 2;

    return {
      result: rL1, unit: '— (normalized to orbital separation)',
      secondary: [
        { key: 'L1_from_secondary', value: rL1, unit: '—', label: 'L1 distance from secondary' },
        { key: 'L1_from_primary', value: 1 - rL1, unit: '—', label: 'L1 distance from primary' },
        { key: 'L2_from_secondary', value: rL2, unit: '—', label: 'L2 distance from secondary' },
        { key: 'L2_from_primary', value: 1 + rL2, unit: '—', label: 'L2 distance from primary' },
        { key: 'L3_from_primary', value: uL3, unit: '—', label: 'L3 distance from primary' },
        { key: 'L4_x', value: xL4, unit: '—', label: 'L4 x-coordinate' },
        { key: 'L4_y', value: yL4, unit: '—', label: 'L4 y-coordinate' },
        { key: 'L5_x', value: xL4, unit: '—', label: 'L5 x-coordinate' },
        { key: 'L5_y', value: -yL4, unit: '—', label: 'L5 y-coordinate' },
        { key: 'mass_ratio', value: mu, unit: '—', label: 'Mass ratio μ = M₂/(M₁+M₂)' },
      ],
      steps: [
        '── Lagrange Points L1-L5 (Lagrange 1772; Euler 1767) ──',
        `  Primary mass M₁ = ${m1.toExponential(3)} kg`,
        `  Secondary mass M₂ = ${m2.toExponential(3)} kg`,
        `  Mass ratio μ = M₂/(M₁+M₂) = ${mu.toExponential(6)}`,
        `  (Earth-Moon: μ ≈ 0.01215; Sun-Earth: μ ≈ 3.003×10⁻⁶)`,
        '',
        'Step 1 — Collinear points (L1, L2, L3) via Newton-Raphson:',
        `  L1: ${rL1.toFixed(6)} from secondary, ${(1 - rL1).toFixed(6)} from primary` ,
        `  L2: ${rL2.toFixed(6)} from secondary, ${(1 + rL2).toFixed(6)} from primary` ,
        `  L3: ${uL3.toFixed(6)} from primary (opposite side)` ,
        '',
        'Step 2 — Triangular points (L4, L5):',
        `  L4: (${xL4.toFixed(6)}, +${yL4.toFixed(6)}) — 60° ahead of secondary` ,
        `  L5: (${xL4.toFixed(6)}, −${yL4.toFixed(6)}) — 60° behind secondary` ,
        '',
        'Step 3 — Stability:',
        `  L1, L2, L3: UNSTABLE (saddle points — station-keeping required)` ,
        `  L4, L5: STABLE for μ < 0.0385 (Earth-Moon: μ=0.012 → stable!)` ,
        '',
        `  └ L1: SOHO, ACE, DSCOVR (Sun-Earth); L2: JWST, Planck, Gaia (Sun-Earth)` ,
        `  └ L4/L5: Trojan asteroids (Jupiter), Kordylewski dust clouds (Earth-Moon)` ,
      ]
    };
  },
  150: ({ px, py, pxy }) => {
    // Mutual Information (Shannon 1948; Cover & Thomas 2006)
    // For binary variables: I(X;Y) = H(X) + H(Y) − H(X,Y)
    // where H(X) = −p·log₂(p) − (1−p)·log₂(1−p) (binary entropy)
    // and H(X,Y) = −Σ p(x,y)·log₂(p(x,y)) over 4 joint outcomes
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pxy) || px <= 0 || px >= 1 || py <= 0 || py >= 1 || pxy < 0 || pxy > Math.min(px, py)) {
      return { result: NaN, unit: 'bits', secondary: [
        { key: 'entropy_x', value: Number.NaN, unit: 'bits', label: 'Entropy H(X) (NaN)' },
        { key: 'entropy_y', value: Number.NaN, unit: 'bits', label: 'Entropy H(Y) (NaN)' },
        { key: 'joint_entropy', value: Number.NaN, unit: 'bits', label: 'Joint Entropy H(X,Y) (NaN)' },
        { key: 'p00', value: Number.NaN, unit: '—', label: 'p(x=0,y=0) (NaN)' },
        { key: 'p01', value: Number.NaN, unit: '—', label: 'p(x=0,y=1) (NaN)' },
        { key: 'p10', value: Number.NaN, unit: '—', label: 'p(x=1,y=0) (NaN)' },
        { key: 'p11', value: Number.NaN, unit: '—', label: 'p(x=1,y=1) (NaN)' },
      ], steps: ['Error: px,py ∈ (0,1), 0 ≤ pxy ≤ min(px,py)'] };
    }

    // Binary entropy for marginals
    const Hx = -(px * Math.log2(px) + (1 - px) * Math.log2(1 - px));
    const Hy = -(py * Math.log2(py) + (1 - py) * Math.log2(1 - py));

    // Joint distribution for binary variables
    const p11 = pxy;           // p(x=1, y=1)
    const p10 = px - pxy;      // p(x=1, y=0)
    const p01 = py - pxy;      // p(x=0, y=1)
    const p00 = 1 - px - py + pxy;  // p(x=0, y=0)

    // Joint entropy H(X,Y)
    function Hb(p: number): number { return p > 0 ? -p * Math.log2(p) : 0; }
    const Hjoint = Hb(p11) + Hb(p10) + Hb(p01) + Hb(p00);

    // Mutual information
    const MI = Hx + Hy - Hjoint;

    return {
      result: MI, unit: 'bits',
      secondary: [
        { key: 'entropy_x', value: Hx, unit: 'bits', label: 'Entropy H(X)' },
        { key: 'entropy_y', value: Hy, unit: 'bits', label: 'Entropy H(Y)' },
        { key: 'joint_entropy', value: Hjoint, unit: 'bits', label: 'Joint Entropy H(X,Y)' },
        { key: 'p00', value: p00, unit: '—', label: 'p(x=0,y=0)' },
        { key: 'p01', value: p01, unit: '—', label: 'p(x=0,y=1)' },
        { key: 'p10', value: p10, unit: '—', label: 'p(x=1,y=0)' },
        { key: 'p11', value: p11, unit: '—', label: 'p(x=1,y=1)' },
      ],
      steps: [
        '── Mutual Information (Shannon 1948; Cover & Thomas 2006) ──',
        `  p(x=1) = ${px.toFixed(4)}, p(y=1) = ${py.toFixed(4)}`,
        `  p(x=1,y=1) = ${pxy.toFixed(4)}`,
        '',
        'Step 1 — Binary entropies:',
        `  H(X) = −${px.toFixed(4)}·log₂(${px.toFixed(4)}) − ${(1-px).toFixed(4)}·log₂(${(1-px).toFixed(4)}) = ${Hx.toFixed(4)} bits`,
        `  H(Y) = −${py.toFixed(4)}·log₂(${py.toFixed(4)}) − ${(1-py).toFixed(4)}·log₂(${(1-py).toFixed(4)}) = ${Hy.toFixed(4)} bits`,
        '',
        'Step 2 — Joint distribution:',
        `  p(1,1) = ${p11.toFixed(4)},  p(1,0) = ${p10.toFixed(4)}`,
        `  p(0,1) = ${p01.toFixed(4)},  p(0,0) = ${p00.toFixed(4)}`,
        '',
        'Step 3 — Joint entropy H(X,Y):',
        `  H(X,Y) = ${Hjoint.toFixed(4)} bits`,
        '',
        'Step 4 — Mutual information:',
        `  I(X;Y) = H(X) + H(Y) − H(X,Y) = ${Hx.toFixed(4)} + ${Hy.toFixed(4)} − ${Hjoint.toFixed(4)}`,
        `  I(X;Y) = ${MI.toFixed(4)} bits ${MI < 0.01 ? '(nearly independent)' : MI < 0.5 ? '(moderate dependence)' : '(strong dependence)'}`,
        '',
        `  └ I(X;Y) ≥ 0; I = 0 iff X,Y independent; I = min(H(X),H(Y)) iff one determines the other` ,
        `  └ NMI = I(X;Y) / √(H(X)·H(Y)) normalizes to [0, 1]`,
      ]
    };
  },
};
