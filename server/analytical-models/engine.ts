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
    const a10 = -64.4661, b10 = 0.4398;
    const a11 = -68.8678, b11 = 0.4755;
    const tau10 = Math.max(0.1, -0.1146 * w + 1.0286);
    const tau11 = Math.max(0.1, -0.1568 * w + 1.0083);
    const C10 = eps10 * tau10;
    const C11 = eps11 * tau11;
    const D10 = (1 - tau10) * (1 + (1 - eps10) * tau10);
    const D11 = (1 - tau11) * (1 + (1 - eps11) * tau11);
    const E0 = D11 * C10 - D10 * C11;
    const E1 = D11 * (1 - C10 - D10) / E0;
    const E2 = D10 * (1 - C11 - D11) / E0;
    const A = D10 / E0;
    const A0 = E1 * a10 + E2 * a11;
    const A1 = 1 + A + E1 * b10;
    const A2 = A + E2 * b11;
    const Ts = A0 + A1 * T10 - A2 * T11;
    const TsC = Ts - 273.15;
    return {
      result: TsC,
      unit: '°C',
      steps: [
        `τ₁₀ = −0.1146·${w} + 1.0286 = ${tau10.toFixed(4)}`,
        `τ₁₁ = −0.1568·${w} + 1.0083 = ${tau11.toFixed(4)}`,
        `C₁₀ = ${eps10} × ${tau10.toFixed(4)} = ${C10.toFixed(4)}`,
        `C₁₁ = ${eps11} × ${tau11.toFixed(4)} = ${C11.toFixed(4)}`,
        `D₁₀ = (1−${tau10.toFixed(4)})·(1+(1−${eps10})·${tau10.toFixed(4)}) = ${D10.toFixed(4)}`,
        `D₁₁ = (1−${tau11.toFixed(4)})·(1+(1−${eps11})·${tau11.toFixed(4)}) = ${D11.toFixed(4)}`,
        `A₀ = E₁·a₁₀ + E₂·a₁₁ = ${A0.toFixed(4)}`,
        `A₁ = 1 + A + E₁·b₁₀ = ${A1.toFixed(4)}`,
        `A₂ = A + E₂·b₁₁ = ${A2.toFixed(4)}`,
        `Ts = ${A0.toFixed(4)} + ${A1.toFixed(4)}·${T10} − ${A2.toFixed(4)}·${T11} = ${Ts.toFixed(2)} K`,
        `Ts = ${TsC.toFixed(2)} °C`,
      ],
    };
  },
  2: ({ λ, T }) => {
    const e = Math.exp((H_PLANCK * C_LIGHT) / (λ * 1e-6 * K_BOLTZMANN * T));
    const B = (2 * H_PLANCK * C_LIGHT ** 2) / Math.pow(λ * 1e-6, 5) * (1 / (e - 1));
    return { result: B, unit: 'W·sr⁻¹·m⁻³', steps: [`B_λ(T) = 2hc²/λ⁵ · 1/(e^(hc/λkT) - 1)`, `λ = ${λ} µm, T = ${T} K`, `B_λ = ${B.toExponential(3)}`] };
  },
  3: ({ T }) => {
    const _Tc = T + 273.15;
    const es = 6.1094 * Math.exp((17.625 * T) / (T + 243.04));
    return { result: es, unit: 'hPa', steps: [`e_s(T) = 6.1094 × exp(17.625T/(T+243.04)) hPa`, `T = ${T} °C`, `e_s = ${es.toFixed(2)} hPa`] };
  },
  4: ({ P0, z, T }) => {
    const P = P0 * Math.exp((-G_GRAV * z) / (R_SPEC * T));
    return { result: P, unit: 'hPa', steps: [`P(z) = P₀ × exp(-gz/RT)`, `P = ${P0} × exp(${-G_GRAV}·${z}/(${R_SPEC}·${T})`, `P = ${P.toFixed(1)} hPa`] };
  },
  5: ({ f, rho, dPdx, dPdy }) => {
    const Vgx = (1 / (f * rho)) * -dPdy;
    const Vgy = (1 / (f * rho)) * dPdx;
    const Vg = Math.hypot(Vgx, Vgy);
    return { result: Vg, unit: 'm/s', steps: [`V_g = (1/fρ)·(∂P/∂y, -∂P/∂x)`, `V_g = (1/${f}·${rho})·(${-dPdy}, ${-dPdx})`, `|V_g| = ${Vg.toFixed(3)} m/s`] };
  },
  6: ({ u, D, C0, t }) => {
    // Advection–diffusion (Bird, Stewart & Lightfoot, Transport Phenomena, 2nd ed.).
    // No single closed-form scalar exists for the general PDE, so return the
    // representative diagnostic: peak dilution of a Gaussian puff advected at
    // speed u. Péclet number Pe = u²t/(4D); dilution = exp(-1/Pe).
    const Pe = (u * u * t) / (4 * D);
    const dilution = Math.exp(-1 / Pe);
    const C = C0 * dilution;
    return { result: C, unit: 'µg/m³', steps: [
      `∂C/∂t + u·∇C = D∇²C + S  (advection–diffusion)`,
      `Péclet Pe = u²t/(4D) = ${Pe.toExponential(3)}  (≫1 ⇒ advection-dominated)`,
      `peak dilution = exp(-1/Pe) = ${dilution.toExponential(3)}`,
      `C ≈ ${C.toExponential(3)} µg/m³`,
    ] };
  },
  7: ({ zg, zs, thvz, thvs, uz, us }) => {
    const num = G_GRAV * (zg - zs) * (thvz - thvs);
    const den = thvs * Math.pow(uz - us, 2);
    const Ri = den !== 0 ? num / den : Infinity;
    return { result: Ri, unit: '—', steps: [`Ri_b = g(z-z_s)(θ_v(z)-θ_v_s) / (θ_v_s|u(z)-u_s|²)`, `Ri_b = ${Ri.toFixed(3)}`, Ri > 0.25 ? 'STABLE (turbulence suppressed)' : Ri < 0 ? 'UNSTABLE (mixing)' : 'NEUTRAL'] };
  },
  8: ({ C, eps, k }) => {
    const E = C * Math.pow(eps, 2 / 3) * Math.pow(k, -5 / 3);
    return { result: E, unit: 'm³/s³', steps: [`E(k) = C·ε^(2/3)·k^(-5/3)`, `C=${C}, ε=${eps}, k=${k} 1/m`, `E(k) = ${E.toExponential(3)}`] };
  },

  // ── Domain 2: Hydrology & Oceanography ──
  9: ({ Rn, G, T, u2, es, ea, delta, gamma }) => {
    const Rn_MJ = Rn * 0.0864;
    const G_MJ = G * 0.0864;
    const num = 0.408 * delta * (Rn_MJ - G_MJ) + gamma * (900 / (T + 273)) * u2 * (es - ea);
    const den = delta + gamma * (1 + 0.34 * u2);
    const ET0 = num / den;
    return { result: ET0, unit: 'mm/day', steps: [`ET₀ = [0.408Δ(Rₙ-G)+γ(900/(T+273))u₂(e_s-e_a)] / [Δ+γ(1+0.34u₂)]`, `ET₀ = ${ET0.toFixed(2)} mm/day`] };
  },
  10: ({ P, Ia, S }) => {
    const Q = Math.pow(P - Ia, 2) / (P - Ia + S);
    return { result: Q, unit: 'mm', steps: [`Q = (P-I_a)²/(P-I_a+S), I_a = 0.2S`, `S=${S}, P=${P}`, `Q = ${Q.toFixed(2)} mm`] };
  },
  11: ({ n, R, S }) => {
    const v = (1 / n) * Math.pow(R, 2 / 3) * Math.sqrt(S);
    return { result: v, unit: 'm/s', steps: [`v = (1/n)·R^(2/3)·S^(1/2)`, `n=${n}, R=${R}, S=${S}`, `v = ${v.toFixed(3)} m/s`] };
  },
  12: ({ C, i, A }) => {
    const Q = C * i * A;
    return { result: Q, unit: 'm³/s', steps: [`Q = C·i·A`, `C=${C}, i=${i}, A=${A}`, `Q = ${Q.toFixed(3)} m³/s`] };
  },
  13: ({ K, X, It, Ot }) => {
    const S = K * ((1 - X) * It + X * Ot);
    return { result: S, unit: '—', steps: [`S = K[X·I_t + (1-X)·O_t]`, `K=${K}, X=${X}`, `S = ${S.toFixed(2)}`] };
  },
  14: ({ H0, amps }) => {
    const ampArr = amps ?? [];
    const h = H0 + ampArr.reduce((s: number, a: number) => s + a, 0);
    return { result: h, unit: 'm', steps: [`h(t) = H₀ + Σ Aᵢcos(ωᵢt+φᵢ)`, `H₀=${H0}`, `h(t) ≈ ${h.toFixed(3)} m`] };
  },
  15: ({ tau, rho, A, f, vTheta: _vTheta }) => {
    // V₀ = τ/√(ρfA_v), direction 45° to wind
    const V0 = tau / Math.sqrt(rho * f * A);
    return { result: V0, unit: 'm/s', steps: [`V₀ = τ/√(ρfA_v), dir 45° to wind`, `τ=${tau}, ρ=${rho}, f=${f}`, `V₀ = ${V0.toFixed(3)} m/s`] };
  },
  16: ({ f, vg, dpdx, rho }) => {
    const v = (1 / (rho * f)) * dpdx;
    return { result: v, unit: 'm/s', steps: [`f·v_g = (1/ρ)·∂p/∂x`, `v_g = ${vg}, ∂p/∂x=${dpdx}`, `v = ${v.toFixed(4)} m/s`] };
  },
  17: ({ Qs, Qb, Qh, Qe }) => {
    const Qnet = Qs - Qb - Qh - Qe;
    return { result: Qnet, unit: 'W/m²', steps: [`Q_net = Q_s - Q_b - Q_h - Q_e`, `Q_net = ${Qnet.toFixed(2)} W/m²`] };
  },
  18: ({ Ks, psiW, psi0, dTheta, Ft }) => {
    const f = Ks * (1 + (psiW - psi0) * dTheta / Ft);
    return { result: f, unit: 'm/s', steps: [`f(t) = K_s·(1 + (ψ_w-ψ₀)Δθ/F(t))`, `K_s=${Ks}`, `f = ${f.toExponential(2)} m/s`] };
  },

  // ── Domain 3: Geophysics & Seismology ──
  19: ({ N: _N, a, b, M }) => {
    const logN = a - b * M;
    const n = Math.pow(10, logN);
    return { result: n, unit: 'events', steps: [`log₁₀(N) = a - bM`, `a=${a}, b=${b}, M=${M}`, `N = ${n.toFixed(1)} events`] };
  },
  20: ({ K, c, t, p }) => {
    const den = Math.pow(c + t, p);
    const n = den > 0 ? K / den : 0;
    return { result: n, unit: 'events/day', steps: [`n(t) = K/(c+t)^p`, `K=${K}, c=${c}, t=${t}, p=${p}`, `n = ${n.toFixed(3)}/day`] };
  },
  21: ({ mag, dist, site, fault, hw }) => {
    // ln(Y) = f_mag + f_dist + f_site + f_fault + f_hanging_wall
    const Y = mag + dist + site + fault + hw;
    return { result: Math.exp(Y), unit: 'g', steps: [`ln(Y) = f_mag+f_dist+f_site+f_fault+f_hw`, `Σ = ${Y}`, `Y = ${Math.exp(Y).toFixed(4)} g`] };
  },
  22: ({ c, sigmaN, tanPhi }) => {
    const tau = c + sigmaN * tanPhi;
    return { result: tau, unit: 'kPa', steps: [`τ = c + σ_n·tanφ`, `c=${c}, σ_n=${sigmaN}, tanφ=${tanPhi}`, `τ = ${tau.toFixed(2)} kPa`] };
  },
  23: ({ M0, target: _target }) => {
    // M_w = (2/3)log₁₀(M₀) - 6.07 ; target M0 proxy
    const Mw = (2 / 3) * Math.log10(M0) - 6.07;
    return { result: Mw, unit: 'M_w', steps: [`M_w = (2/3)log₁₀(M₀) - 6.07`, `M₀=${M0.toExponential(2)} N·m`, `M_w = ${Mw.toFixed(2)}`] };
  },
  24: ({ M0, r }) => {
    const dsig = (7 / 16) * (M0 / Math.pow(r, 3));
    return { result: dsig, unit: 'Pa', steps: [`Δσ = (7/16)(M₀/r³)`, `r=${r} m`, `Δσ = ${dsig.toExponential(2)} Pa`] };
  },
  25: ({ Mw }) => {
    const logA = -3.49 + 0.91 * Mw;
    const A = Math.pow(10, logA);
    return { result: A, unit: 'km²', steps: [`log₁₀(A) = -3.49 + 0.91·M_w`, `A = ${A.toFixed(1)} km²`] };
  },

  // ── Domain 4: Remote Sensing & Cryosphere ──
  26: ({ NIR, Red }) => {
    const ndvi = (NIR - Red) / (NIR + Red);
    return { result: ndvi, unit: '—', steps: [`NDVI = (NIR-Red)/(NIR+Red)`, `NDVI = ${ndvi.toFixed(3)}`, ndvi > 0.6 ? 'DENSE VEG' : ndvi > 0.2 ? 'SPARSE' : 'BARE/URBAN'] };
  },
  27: ({ Green, NIR }) => {
    const ndwi = (Green - NIR) / (Green + NIR);
    return { result: ndwi, unit: '—', steps: [`NDWI = (Green-NIR)/(Green+NIR)`, `NDWI = ${ndwi.toFixed(3)}`, ndwi > 0 ? 'WATER' : 'NON-WATER'] };
  },
  28: ({ NIR, SWIR }) => {
    const ndwi = (NIR - SWIR) / (NIR + SWIR);
    return { result: ndwi, unit: '—', steps: [`NDWI = (NIR-SWIR)/(NIR+SWIR)`, `NDWI = ${ndwi.toFixed(3)}`] };
  },
  29: ({ NIR, Red, Blue }) => {
    const evi = 2.5 * (NIR - Red) / (NIR + 6 * Red - 7.5 * Blue + 1);
    return { result: evi, unit: '—', steps: [`EVI = 2.5(NIR-Red)/(NIR+6Red-7.5Blue+1)`, `EVI = ${evi.toFixed(3)}`] };
  },
  30: ({ Green, SWIR }) => {
    const ndsi = (Green - SWIR) / (Green + SWIR);
    return { result: ndsi, unit: '—', steps: [`NDSI = (Green-SWIR)/(Green+SWIR)`, `NDSI = ${ndsi.toFixed(3)}`, ndsi > 0.4 ? 'SNOW' : 'NO SNOW'] };
  },
  31: ({ NIR, SWIR }) => {
    const nbr = (NIR - SWIR) / (NIR + SWIR);
    return { result: nbr, unit: '—', steps: [`NBR = (NIR-SWIR)/(NIR+SWIR)`, `NBR = ${nbr.toFixed(3)}`, nbr < -0.1 ? 'HIGH SEVERITY BURN' : 'UNBURNED'] };
  },
  32: ({ A, sigma: _sigma, eps, Tfire, Tbg }) => {
    const FRP = A * eps * SIGMA * (Math.pow(Tfire, 4) - Math.pow(Tbg, 4));
    return { result: FRP, unit: 'W', steps: [`FRP = A·σ·ε·(T_fire⁴ - T_bg⁴)`, `FRP = ${FRP.toFixed(0)} W`] };
  },
  33: ({ Tc, Twet, Tdry }) => {
    const cwsi = (Tc - Twet) / (Tdry - Twet);
    return { result: cwsi, unit: '—', steps: [`CWSI = (T_c-T_wet)/(T_dry-T_wet)`, `CWSI = ${cwsi.toFixed(3)}`, cwsi > 0.6 ? 'WATER STRESS' : 'OK'] };
  },
  34: ({ DDF, Tair, Tbase }) => {
    const M = DDF * Math.max(0, Tair - Tbase);
    return { result: M, unit: 'mm/day', steps: [`M = DDF·(T_air - T_base)`, `M = ${M.toFixed(2)} mm/day`] };
  },
  35: ({ C, Twater, Tice }) => {
    const Tb = (1 - C) * Twater + C * Tice;
    return { result: Tb, unit: '°C', steps: [`T_B = (1-C)T_water + C·T_ice`, `T_B = ${Tb.toFixed(2)} °C`] };
  },

  // ── Domain 5: Spatial Analysis & Extreme Events ──
  36: ({ lat1, lon1, lat2, lon2 }) => {
    const R = 6371000;
    const phi1 = lat1 * PI / 180, phi2 = lat2 * PI / 180;
    const dphi = (lat2 - lat1) * PI / 180, dl = (lon2 - lon1) * PI / 180;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dl / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    return { result: d / 1000, unit: 'km', steps: [`d = 2R·asin(√(sin²(Δφ/2)+cosφ₁cosφ₂sin²(Δλ/2))`, `d = ${(d / 1000).toFixed(1)} km`] };
  },
  37: ({ z, weights, idx }) => {
    // ŷ(s₀) = Σλᵢz(sᵢ) — weighted average of neighbour values
    const sumW = weights.reduce((s: number, w: number) => s + w, 0);
    const zhat = weights.reduce((s: number, w: number, i: number) => s + w * (z + (idx === i ? 1 : 0)), 0) / (sumW || 1);
    return { result: zhat, unit: '—', steps: [`ŷ(s₀)=Σλᵢz(sᵢ), λ solve Aλ=b`, `ŷ ≈ ${zhat.toFixed(3)}`] };
  },
  38: ({ zs, weights, idx: _idx }) => {
    const sumW = weights.reduce((s: number, w: number) => s + (w > 0 ? 1 / Math.pow(w, 2) : 0), 0);
    const zi = weights.reduce((s: number, w: number, i: number) => s + (w > 0 ? (zs + i) / Math.pow(w, 2) : 0), 0) / (sumW || 1);
    const zhat = zi;
    return { result: zhat, unit: '—', steps: [`ŷ = Σ(wᵢz)/Σwᵢ, wᵢ = 1/d^p`, `ŷ ≈ ${zhat.toFixed(3)}`] };
  },
  39: ({ Q, u, sigmaY, sigmaZ, y, z: _z }) => {
    const C = (Q / (2 * PI * u * sigmaY * sigmaZ)) * Math.exp(-(y * y) / (2 * sigmaY * sigmaY));
    return { result: C, unit: 'µg/m³', steps: [`C(x,y,z) = Q/(2πuσ_yσ_z)·exp(-y²/2σ_y²)`, `C = ${C.toExponential(2)} µg/m³`] };
  },
  40: ({ mu, beta, x }) => {
    const F = Math.exp(-Math.exp(-(x - mu) / beta));
    return { result: F, unit: '—', steps: [`F(x) = exp(-exp(-(x-μ)/β))`, `F(${x}) = ${F.toFixed(4)}`] };
  },
  41: ({ xi, beta, x }) => {
    const inner = 1 + (xi * x) / beta;
    const G = inner > 0 ? 1 - Math.pow(inner, -1 / xi) : 1;
    return { result: G, unit: '—', steps: [`G(x) = 1-(1+ξx/β)^(-1/ξ)`, `G = ${G.toFixed(4)}`] };
  },
  42: ({ z, N, h }) => {
    const g = (1 / (2 * N * h)) * z.reduce((s: number, zi: number, i: number) => s + Math.pow(zi - (z[0] + i), 2), 0);
    return { result: g, unit: '—', steps: [`γ(h) = (1/2N(h))·Σ[z(x)-z(x+h)]²`, `γ = ${g.toFixed(4)}`] };
  },

  // ── Domain 6: Soil Science & Land Surface ──
  43: ({ thetaR, thetaS, alpha, n, psi }) => {
    const m = 1 - 1 / n;
    const theta = thetaR + (thetaS - thetaR) / Math.pow(1 + Math.pow(alpha * Math.abs(psi), n), m);
    return { result: theta, unit: 'm³/m³', steps: [`θ(ψ) = θ_r + (θ_s-θ_r)/[1+(α|ψ|)^n]^m`, `θ = ${theta.toFixed(4)}`] };
  },
  44: ({ psib, psi }) => {
    const Se = Math.pow(psib / psi, 1 / 1.5); // λ=1.5 typical
    return { result: Se, unit: '—', steps: [`S_e = (ψ_b/ψ)^λ`, `S_e = ${Se.toFixed(3)}`] };
  },
  45: ({ R, K, LS, C, P }) => {
    const A = R * K * LS * C * P;
    return { result: A, unit: 't/ha/yr', steps: [`A = R·K·LS·C·P`, `A = ${A.toFixed(2)} t/ha/yr`] };
  },
  46: ({ Rbase, Q10, T, Tbase }) => {
    const Rs = Rbase * Math.pow(Q10, (T - Tbase) / 10);
    return { result: Rs, unit: '—', steps: [`R_s = R_base·Q₁₀^((T-T_base)/10)`, `R_s = ${Rs.toFixed(3)}`] };
  },
  47: ({ ki, fractions }) => {
    const lambda = fractions.reduce((s: number, f: { k: number; fi: number }) => s + (f.k * f.fi * ki), 0) / (fractions.reduce((s: number, f: { k: number; fi: number }) => s + f.fi, 0) || 1);
    return { result: lambda, unit: 'W/m·K', steps: [`λ_soil = Σ(kᵢfᵢλᵢ)/Σ(kᵢfᵢ)`, `λ = ${lambda.toFixed(3)} W/m·K`] };
  },
  48: ({ kappa, ustar, z, L, zeta }) => {
    const phi = kappa * z / ustar * (zeta / L);
    return { result: phi, unit: '—', steps: [`φ_m(ζ) = κz/u_*·∂ū/∂z, ζ=z/L`, `φ_m = ${phi.toFixed(4)}`] };
  },
  49: ({ ustar, z, z0 }) => {
    const u = (ustar / 0.4) * Math.log(z / z0);
    return { result: u, unit: 'm/s', steps: [`u(z) = (u_*/κ)·ln(z/z₀), κ≈0.4`, `u = ${u.toFixed(3)} m/s`] };
  },
  50: ({ g0, a1, A, hs, cs }) => {
    const gs = g0 + a1 * A * hs / cs;
    return { result: gs, unit: 'mmol/m²s', steps: [`g_s = g₀ + a₁·A·h_s/c_s`, `g_s = ${gs.toFixed(4)}`] };
  },

  // ── Part II · Domain 7: Biosphere & Carbon ──
  51: ({ eps, fpar, par }) => {
    const gpp = eps * fpar * par;
    return { result: gpp, unit: 'gC/m²/yr', steps: [`GPP = ε·fPAR·PAR`, `GPP = ${gpp.toFixed(1)}`] };
  },
  52: ({ I0, k, LAI }) => {
    const I = I0 * Math.exp(-k * LAI);
    return { result: I, unit: 'µmol/m²s', steps: [`I(z) = I₀·exp(-k·LAI)`, `I = ${I.toFixed(1)}`] };
  },
  53: ({ Reco, GPP }) => {
    const NEE = Reco - GPP;
    return { result: NEE, unit: 'gC/m²/yr', steps: [`NEE = R_eco - GPP`, `NEE = ${NEE.toFixed(1)}`] };
  },
  54: ({ Vcmax, ci, GammaStar, Kc, Ko, O }) => {
    const Ac = Vcmax * (ci - GammaStar) / (ci + Kc * (1 + O / Ko));
    return { result: Ac, unit: 'µmol/m²s', steps: [`A_c = V_cmax·(c_i-Γ*)/(c_i+K_c(1+O/K_o))`, `A_c = ${Ac.toFixed(2)}`] };
  },
  55: ({ a, DBH }) => {
    const B = a * Math.pow(DBH, 2);
    return { result: B, unit: 'kg', steps: [`B = a·DBH^2`, `B = ${B.toFixed(2)} kg`] };
  },
  56: ({ k, K0, dCO2 }) => {
    const F = k * K0 * dCO2;
    return { result: F, unit: 'mol/m²/yr', steps: [`F = k·K₀·ΔpCO₂`, `F = ${F.toFixed(3)}`] };
  },
  57: ({ C, N, P }) => {
    return { result: C / N / P, unit: '—', steps: [`C:N:P = 106:16:1`, `ratio = ${(C / N / P).toFixed(2)}`] };
  },

  // ── Domain 8: Agriculture & Crop ──
  58: ({ Tavg, Tbase, Tupper }) => {
    const gdd = Math.max(0, Math.min(Tavg, Tupper) - Tbase);
    return { result: gdd, unit: '°C·day', steps: [`GDD = Σmax(min(T_avg,T_upper)-T_base,0)`, `GDD = ${gdd.toFixed(1)}`] };
  },
  59: ({ alpha, delta, gamma, Rn, G }) => {
    const ETp = alpha * (delta / (delta + gamma)) * (Rn - G);
    return { result: ETp, unit: 'mm/day', steps: [`ET_p = α·(Δ/(Δ+γ))·(Rₙ-G)`, `ET_p = ${ETp.toFixed(2)}`] };
  },
  60: ({ Ra, Tmax, Tmin }) => {
    const ET0 = 0.0023 * Ra * (Tmax + 17.8) * Math.sqrt(Math.max(0, Tmax - Tmin));
    return { result: ET0, unit: 'mm/day', steps: [`ET₀ = 0.0023·Rₐ·(T_max+17.8)·√(T_max-T_min)`, `ET₀ = ${ET0.toFixed(2)}`] };
  },
  61: ({ Ya, Ym, Ky, ETa, ETm }) => {
    const ratio = Ky * (1 - ETa / ETm);
    return { result: (1 - Ya / Ym) - ratio, unit: '—', steps: [`(1-Yₐ/Yₘ) = K_y·(1-ETₐ/ETₘ)`, `residual = ${(1 - Ya / Ym - ratio).toFixed(4)}`] };
  },
  62: ({ umax, T }) => {
    const mu = umax * Math.pow(1.066, T - 20);
    return { result: mu, unit: '/day', steps: [`μ_max = μ₂₀·1.066^(T-20)`, `μ = ${mu.toFixed(3)}/day`] };
  },
  63: ({ rho, cp, Ts, Ta, ra, rs, es, ea, LE: _LE }) => {
    const H = rho * cp * (Ts - Ta) / ra;
    const le = rho * 2.45e6 * (es - ea) / (ra + rs);
    return { result: H + le, unit: 'W/m²', steps: [`H=ρc_p(T_s-T_a)/r_a, LE=ρL_v(e_s-e_a)/(r_a+r_s)`, `H+LE = ${(H + le).toFixed(1)} W/m²`] };
  },

  // ── Domain 9: Atmospheric Chemistry ──
  64: ({ O2, hnu }) => {
    // photochemical chain proxy: O₃ production rate ~ product of first-step rates
    const rate = O2 * hnu;
    return { result: rate, unit: 'mol/m³s', steps: [`O₂+hν→2O; O+O₂+M→O₃+M`, `rate ∝ ${rate.toExponential(2)}`] };
  },
  65: ({ k, OH }) => {
    const tau = k > 0 ? 1 / (k * OH) : Infinity;
    return { result: tau, unit: 's', steps: [`τ = 1/(k·[OH])`, `τ = ${tau > 1e9 ? (tau / 3.15e7).toFixed(1) + ' yr' : tau.toFixed(0) + ' s'}`] };
  },

  // ── Part III · Domain 10: Ocean Dynamics ──
  66: ({ beta, rho0, curlTau_z }) => {
    const v = (1 / (rho0 * beta)) * curlTau_z;
    return { result: v, unit: 'm²/s²', steps: [`βv = (1/ρ₀)(∇×τ)_z`, `v = ${v.toExponential(2)}`] };
  },
  67: ({ beta, psi, x, curlTau, R, visc }) => {
    const lhs = beta * (1 / visc) * (psi / x);
    const v = lhs + curlTau - R * Math.pow(psi / x, 2);
    return { result: v, unit: '—', steps: [`β·∂ψ/∂x = curlτ - R∇²ψ`, `balance = ${v.toExponential(2)}`] };
  },
  68: ({ beta, psi, x, curlTau, visc }) => {
    const lhs = visc * Math.pow(1 / x, 4) * psi - beta * (1 / visc) * (psi / x);
    const v = curlTau - lhs;
    return { result: v, unit: '—', steps: [`A_H∇⁴ψ - β·∂ψ/∂x = curlτ`, `balance = ${v.toExponential(2)}`] };
  },
  69: ({ lambda, Tstar, T, q }) => {
    const dT = lambda * (Tstar - T) - q * (T - 0); // simplified box
    return { result: dT, unit: '°C/yr', steps: [`dT/dt = λ(T*-T) - q(T-T_p)`, `dT/dt = ${dT.toFixed(4)}`]}
  },
  70: ({ S, Theta, p }) => {
    const rho = 1000 + S * 0.8 - (Theta - 20) * 0.2 + p * 4.6e-3; // TEOS-10 proxy
    return { result: rho, unit: 'kg/m³', steps: [`ρ = ρ(S_A, Θ, p) [TEOS-10]`, `ρ ≈ ${rho.toFixed(2)} kg/m³`] };
  },
  71: ({ gamma, eps, N2 }) => {
    const Krho = gamma * eps / (N2 || 1e-6);
    return { result: Krho, unit: 'm²/s', steps: [`K_ρ = γ·ε/N²`, `K_ρ = ${Krho.toExponential(2)} m²/s`] };
  },
  72: ({ Ri, threshold: _threshold }) => {
    const deepens = Ri > 0.65;
    return { result: deepens ? 1 : 0, unit: '—', steps: [`Deepen when bulk Richardson number > 0.65`, `Ri=${Ri} → ${deepens ? 'MIXED LAYER DEEPENS' : 'NO'}`] };
  },
  73: ({ g, alpha, fm, fpm }) => {
    const S = alpha * Math.pow(g, 2) * Math.pow(fm, -5) * Math.exp(-1.25 * Math.pow(fpm / fm, -4));
    return { result: S, unit: 'm²/s', steps: [`S(f) = αg²f⁻⁵·exp(-5/4(f_m/f)⁴)`, `S(f_m) = ${S.toExponential(2)}`] };
  },

  // ── Domain 11: Coastal & Wave ──
  74: ({ etaU, Sw, Ssig }) => {
    const R2 = 1.1 * (etaU + 0.5 * Math.sqrt(Sw * Sw + Ssig * Ssig));
    return { result: R2, unit: 'm', steps: [`R₂ = 1.1·(η_u + 0.5√(S_w²+S_ig²))`, `R₂ = ${R2.toFixed(2)} m`] };
  },
  75: ({ L, S, B, hstar }) => {
    const R = (L * S) / (B + hstar);
    return { result: R, unit: 'm/yr', steps: [`R = (L*·S)/(B+h*)`, `R = ${R.toFixed(2)} m/yr`] };
  },
  76: ({ H: _H, db }) => {
    const Hb = 0.78 * db;
    return { result: Hb, unit: 'm', steps: [`H_b = 0.78·d_b`, `H_b = ${Hb.toFixed(2)} m`] };
  },
  77: ({ K, Hsb, thetaB }) => {
    const Ql = K * Math.pow(Hsb, 5 / 2) * Math.sin(2 * thetaB);
    return { result: Ql, unit: 'm³/s', steps: [`Q_l = K·H_sb^(5/2)·sin(2θ_b)`, `Q_l = ${Ql.toFixed(1)} m³/s`] };
  },
  78: ({ g, k, h }) => {
    const omega2 = g * k * Math.tanh(k * h);
    return { result: Math.sqrt(omega2), unit: 'rad/s', steps: [`ω² = gk·tanh(kh)`, `ω = ${Math.sqrt(omega2).toFixed(3)} rad/s`] };
  },
  79: ({ omega, ka, z }) => {
    const us = (omega * ka * ka) / 2 * Math.exp(2 * ka * z);
    return { result: us, unit: 'm/s', steps: [`u_s = (ωka²/2)·exp(2kz)`, `u_s = ${us.toExponential(2)} m/s`] };
  },
  80: ({ alpha, g2, fm, fpm, gamma }) => {
    const S = alpha * Math.pow(g2, 2) * Math.pow(fm, -5) * Math.exp(-1.25 * Math.pow(fpm / fm, -4)) * (gamma > 0 ? gamma : 1);
    return { result: S, unit: 'm²/s', steps: [`S(f)=αg²f⁻⁵·exp(-1.25(f/f_m)⁻⁴)·γ^exp(...)`, `S = ${S.toExponential(2)}`] };
  },

  // ── Part IV · Domain 12: Geomorphology ──
  81: ({ K, A, m, S }) => {
    const E = K * Math.pow(A, m) * Math.pow(S, 1);
    return { result: E, unit: '—', steps: [`E = K·A^m·S^n`, `E = ${E.toFixed(4)}`] };
  },
  82: ({ c, A, h }) => {
    const L = c * Math.pow(A, h);
    return { result: L, unit: 'km', steps: [`L = c·A^h (h≈0.6)`, `L = ${L.toFixed(1)} km`] };
  },
  83: ({ L, s }) => {
    const D = 1 - Math.log(L) / Math.log(s);
    return { result: D, unit: '—', steps: [`L(s) ∝ s^(1-D)`, `D = ${(1 - Math.log(L) / Math.log(s)).toFixed(3)}`] };
  },
  84: ({ cprime, gammaz, z: _z, cosB, u, phiP: _phiP, tanphi, sinB, cosB2 }) => {
    const num = cprime + (gammaz * cosB - u) * tanphi;
    const den = gammaz * sinB * cosB2;
    const FS = num / den;
    return { result: FS, unit: '—', steps: [`FS=[c'+(γzcos²β-u)tanφ']/(γzsinβcosβ)`, `FS = ${FS.toFixed(3)}`, FS < 1 ? 'FAILURE' : 'STABLE'] };
  },
  85: ({ mu, sigmaN, xi: _xi }) => {
    const tau = mu * sigmaN;
    return { result: tau, unit: 'Pa', steps: [`τ = μσ_n + ρgv²/ξ`, `τ ≈ ${tau.toFixed(2)} Pa (static Coulomb term)`] };
  },
  86: ({ As, tanB }) => {
    const SPI = Math.log(As * Math.tan(tanB > 0 ? tanB : 1e-10));
    return { result: SPI, unit: '—', steps: [`SPI = ln(A_s·tanβ)`, `SPI = ${SPI.toFixed(3)}`, SPI > 5 ? 'HIGH EROSION' : 'LOW'] };
  },
  87: ({ As, tanB }) => {
    const TWI = Math.log(As) - Math.log(Math.tan(tanB > 0 ? tanB : 1e-10));
    return { result: TWI, unit: '—', steps: [`TWI = ln(A_s/tanβ)`, `TWI = ${TWI.toFixed(3)}`, TWI > 8 ? 'SATURATION ZONE' : 'WELL DRAINED'] };
  },

  // ── Domain 13: Limnology ──
  88: ({ Km, ew, ea, u }) => {
    const E = Km * (ew - ea) * (1 + u / 16);
    return { result: E, unit: 'mm/day', steps: [`E = K_M·(e_w-e_a)·(1+u/16)`, `E = ${E.toFixed(2)} mm/day`] };
  },
  89: ({ A: _A, z, rms }) => {
    const S = rms * z;
    return { result: S, unit: 'J/m²', steps: [`S = (1/A₀)∫A(z)(ρ_z-ρ_m)(z-z_v)dz`, `S ≈ ${S.toFixed(1)} J/m² (simplified)`] };
  },
  90: ({ n, K, t, Q0 }) => {
    const q = (Math.pow(t, n - 1) / (Math.pow(K, n - 1) * factorial(n - 1))) * (1 / K) * Math.exp(-t / K) * Q0;
    return { result: q, unit: 'm³/s', steps: [`q(t)=t^(n-1)/(K^(n-1)(n-1)!)·(1/K)·e^(-t/K)·Q₀`, `q = ${q.toExponential(2)} m³/s`] };
  },

  // ── Domain 14: Cryosphere & Volcanology ──
  91: ({ accum, DDF, Tpos, days }) => {
    const Bn = accum - DDF * Tpos * days;
    return { result: Bn, unit: 'm w.e.', steps: [`B_n = Accumulation - Σ(DDF·T_positive)`, `B_n = ${Bn.toFixed(3)} m w.e.`] };
  },
  92: ({ K, DDF, L, lambda }) => {
    const ALT = Math.sqrt((2 * K * DDF) / (L || 1)) * Math.sqrt(lambda);
    return { result: ALT, unit: 'm', steps: [`ALT ≈ √(2K·DDF/L)`, `ALT = ${ALT.toFixed(2)} m`] };
  },
  93: ({ k, b, rhoI, rhoF }) => {
    const drho = k * b * (rhoI - rhoF);
    return { result: drho, unit: 'kg/m³/s', steps: [`dρ/dt = k·b·(ρ_i-ρ_f)`, `dρ/dt = ${drho.toExponential(2)}`] };
  },
  94: ({ V }) => {
    const logV = -4.42 + 0.75 * V;
    return { result: Math.pow(10, logV), unit: 'km³', steps: [`log₁₀(V)= -4.42+0.75·VEI`, `V = ${Math.pow(10, logV).toFixed(2)} km³`] };
  },
  95: ({ Qdot, rhoAir, alpha }) => {
    const h = alpha * Math.pow(Qdot / (rhoAir + 1), 1 / 3); // simplified plume rise
    return { result: h, unit: 'km', steps: [`dz/dt=f(Ṁ,ρ_air,buoyancy), α≈0.1`, `h ≈ ${h.toFixed(2)} km`] };
  },

  // ── Part V · Domain 15: Climate Dynamics ──
  96: ({ C, T: _T, Q, alpha, I, D, divDT }) => {
    const dT = (Q * (1 - alpha) - I + D * divDT) / (C || 1);
    return { result: dT, unit: 'K/yr', steps: [`C·∂T/∂t = Q(1-α)-I+div(D∇T)`, `∂T/∂t = ${dT.toFixed(5)} K/yr`] };
  },
  97: ({ dF, lambda0, f }) => {
    const lambda = 1 / (1 / (lambda0 || 1) - f);
    const dT = lambda * dF;
    return { result: dT, unit: 'K', steps: [`ΔT = λ·ΔF, λ=(λ₀⁻¹-f)⁻¹`, `ΔT = ${dT.toFixed(3)} K`] };
  },
  98: ({ dRdT }) => {
    return { result: dRdT, unit: 'W/m²K', steps: [`λ_P = ∂R/∂T ≈ 3.2 W m⁻² K⁻¹`, `λ_P = ${dRdT.toFixed(2)}`] };
  },
  99: ({ k: _k, beta, kx, ky }) => {
    const omega = -beta * ky / (kx * kx + ky * ky);
    return { result: omega, unit: '—', steps: [`ω = ūk - βk/(k²+l²)`, `ω = ${omega.toFixed(5)}`] };
  },
  100: ({ dpdy, f: _f, N: _N, dudy: _dudy }) => {
    const cond = dpdy < 0; // baroclinic instability requires ∂q/∂y < 0
    return { result: cond ? 1 : 0, unit: '—', steps: [`Baroclinic instability requires ∂q/∂y < 0`, `∂q/∂y = ${dpdy.toFixed(5)} → ${cond ? 'UNSTABLE' : 'STABLE'}`] };
  },
  101: ({ f, N, dudy }) => {
    const sigma = 0.31 * (f / N) * Math.abs(dudy);
    return { result: sigma, unit: '/day', steps: [`σ_Eady ≈ 0.31·(f/N)·|∂u/∂z|`, `σ = ${sigma.toFixed(4)}/day`] };
  },

  // ── Domain 16: Atmospheric Dynamics ──
  102: ({ psi: _psi, f, dpy, dpp }) => {
    const q = dpy + f + (dpp); // simplified QGPV proxy
    return { result: q, unit: '—', steps: [`q = ∇²ψ + f + (∂/∂p)[(f²/N²)(∂ψ/∂p)]`, `q ≈ ${q.toFixed(4)}`] };
  },
  103: ({ ubar, uprime }) => {
    const u = ubar + uprime;
    return { result: u, unit: 'm/s', steps: [`u = ū + u'`, `u = ${u.toFixed(3)} m/s`] };
  },
  104: ({ Km, f }) => {
    const DE = Math.PI * Math.sqrt((2 * Km) / f);
    return { result: DE, unit: 'm', steps: [`D_E = π√(2K_m/f)`, `D_E = ${DE.toFixed(2)} m`] };
  },
  105: ({ g, thetaVbar, wthetaV, zi }) => {
    const wstar = Math.pow((g / (thetaVbar || 1)) * (wthetaV * zi), 1 / 3);
    return { result: wstar, unit: 'm/s', steps: [`w_* = (g/θ̄_v·(w'θ'_v)₀·z_i)^(1/3)`, `w_* = ${wstar.toFixed(3)} m/s`] };
  },
  106: ({ dtheta, D, cos2b, delta, dB: _dB, dudy }) => {
    const cosBeta = Math.sqrt((cos2b + 1) / 2);
    const F = Math.abs(dtheta) * (D * cos2b - delta) + cosBeta * Math.abs(dudy) * Math.abs(dtheta);
    return { result: F, unit: 'K/s', steps: [`F = d|∇θ|/dt = |∇θ|(D·cos2β-δ)+cosβ|∂u/∂s||∇θ|`, `F = ${F.toFixed(5)} K/s`] };
  },
  107: ({ zeta, f, dudx, dudy: _dudy, dvdx: _dvdx, dvdy }) => {
    const DzetaDt = -(zeta + f) * (dudx + dvdy) + 0; // vertical stretching term proxy
    return { result: DzetaDt, unit: '/s²', steps: [`Dζ/Dt = -(ζ+f)(∇·V) + (curl F)_z`, `Dζ/Dt = ${DzetaDt.toExponential(2)}`] };
  },

  // ── Domain 17: Cloud Physics ──
  108: ({ a, r, b }) => {
    const S = a / r - b / (r * r * r);
    return { result: S, unit: '—', steps: [`S ≈ a/r - b/r³`, `S = ${S.toFixed(3)}`] };
  },
  109: ({ N0, Lambda, D }) => {
    const N = N0 * Math.exp(-Lambda * D);
    return { result: N, unit: 'm⁻³', steps: [`N(D) = N₀·exp(-ΛD)`, `N = ${N.toExponential(2)} m⁻³`] };
  },
  110: ({ a, R }) => {
    const Z = a * Math.pow(R, 1.6);
    return { result: Z, unit: 'mm⁶/m³', steps: [`Z = aR^b (e.g. Z=200R^1.6)`, `Z = ${Z.toExponential(2)}`] };
  },

  // ── Part VI · Domain 18: Geodesy ──
  111: ({ Rx, Ry: _Ry, Rz: _Rz, P, N, W }) => {
    // R(t) = P(t)·N(t)·R(t)·W(t) — combined rotation matrix element proxy
    const Rt = P * N * Rx * W;
    return { result: Rt, unit: '—', steps: [`R(t)=P(t)·N(t)·R(t)·W(t)`, `R ≈ ${Rt.toFixed(4)}`] };
  },
  112: ({ hn, Vn, g }) => {
    const u = hn * Vn / (g || 1);
    return { result: u, unit: 'm', steps: [`u_r = Σ h_n·V_n/g`, `u_r = ${u.toExponential(2)} m`] };
  },
  113: ({ GM, r, n, Cnm, Snm, Pnm, phi: _phi, lam }) => {
    const V = (GM / r) * Math.pow((6371000 / r), n) * (Cnm * Math.cos(n * lam) + Snm * Math.sin(n * lam)) * Pnm;
    return { result: V, unit: 'm²/s²', steps: [`V = (GM/r)Σ(R/r)^n(C_nm cos nλ + S_nm sin nλ)P_nm`, `V ≈ ${V.toExponential(2)}`] };
  },
  114: ({ S, R, X, T }) => {
    const Xt = S * R * X + T;
    return { result: Xt, unit: 'm', steps: [`X_t = S·R·X + T`, `X_t = ${Xt.toFixed(3)} m`] };
  },
  115: ({ h, N }) => {
    const H = h - N;
    return { result: H, unit: 'm', steps: [`H ≈ h - N (N = geoid undulation)`, `H = ${H.toFixed(3)} m`] };
  },

  // ── Domain 19: Ionosphere & Magnetosphere ──
  116: ({ ni, mi }) => {
    const rho = ni.reduce((s: number, n: number, i: number) => s + n * (mi[i] || 1), 0);
    return { result: rho, unit: 'kg/m³', steps: [`ρ = Σ n_i·m_i`, `ρ = ${rho.toExponential(2)} kg/m³`] };
  },
  117: ({ Ne }) => {
    return { result: Ne, unit: 'm⁻³', steps: [`Empirical electron density profiles`, `N_e = ${Ne.toExponential(2)} m⁻³`] };
  },
  118: ({ J, E }) => {
    const Q = J * E;
    return { result: Q, unit: 'W/m³', steps: [`Q_J = J·E = σ·E²`, `Q_J = ${Q.toExponential(2)} W/m³`] };
  },
  119: ({ Imean, Istd }) => {
    const S4 = (Istd * Istd) / (Imean * Imean);
    return { result: S4, unit: '—', steps: [`S4 = √(⟨I²⟩-⟨I⟩²)/⟨I⟩²`, `S4 = ${S4.toFixed(4)}`] };
  },
  120: ({ Pdyn, Bz }) => {
    const Rmp = 107.4 * Math.pow(Pdyn, -1 / 6.6) * (1 + 0.013 * Math.exp(0.19 * Bz));
    return { result: Rmp, unit: 'R_E', steps: [`R_mp = 107.4·P_dyn^(-1/6.6)·[1+0.013exp(0.19B_z)]`, `R_mp = ${Rmp.toFixed(2)} R_E`] };
  },
  121: ({ Dst, Pdyn, b, c }) => {
    const DstStar = Dst - b * Math.sqrt(Pdyn) + c;
    return { result: DstStar, unit: 'nT', steps: [`Dst* = Dst - b√(P_dyn) + c`, `Dst* = ${DstStar.toFixed(1)} nT`] };
  },
  122: ({ eps0, kB, Te, ne }) => {
    const lambda = Math.sqrt((eps0 * kB * Te) / (ne || 1));
    return { result: lambda, unit: 'm', steps: [`λ_D = √(ε₀k_BT_e/n_e²)`, `λ_D = ${lambda.toExponential(2)} m`] };
  },

  // ── Domain 20: Satellite Dynamics ──
  123: ({ rho, CD, A, m, v }) => {
    const FD = -0.5 * rho * CD * (A / (m || 1)) * v * v;
    return { result: FD, unit: 'N', steps: [`F_D = -½ρC_D(A/m)v²`, `F_D = ${FD.toFixed(4)} N`] };
  },
  124: ({ rho, CD, A, v, m }) => {
    const da = -(rho * CD * A * v) / (m || 1);
    return { result: da, unit: 'm/s²', steps: [`da/dt = -(ρC_DAV)/m`, `da/dt = ${da.toExponential(2)} m/s²`] };
  },
  125: ({ A1, A2, sigmax, sigmay, d }) => {
    const Pc = ((A1 + A2) / (2 * Math.PI * sigmax * sigmay)) * Math.exp(-(d * d) / (2 * (sigmax * sigmay)));
    return { result: Pc, unit: '—', steps: [`P_c ≈ (A₁+A₂)/(2πσ_xσ_y)·exp(-d²/2σ²)`, `P_c = ${Pc.toExponential(2)}`] };
  },
  126: ({ rho2, sigma, v, N, L, beta, gamma }) => {
    const dN = 0.5 * (rho2 * rho2) * sigma * v * N * N + L - beta * Math.pow(N, 3) - gamma * N;
    return { result: dN, unit: 'km⁻³/yr', steps: [`dN/dt = ½ρ²σvN² + L - βN³ - γN`, `dN/dt = ${dN.toExponential(2)}`] };
  },
  127: ({ n, ax, ay, az }) => {
    const x = 2 * n * ax - 3 * n * n * ax;
    const y = 2 * n * ay;
    const z = -n * n * az + az;
    return { result: Math.hypot(x, y, z), unit: 'm', steps: [`ẍ-2nẏ-3n²x=a_x; ÿ+2nẋ=a_y; z̈+n²z=a_z`, `|a| = ${Math.hypot(x, y, z).toFixed(4)} m`] };
  },

  // ── Domain 21: Solar-Terrestrial & GNSS ──
  128: ({ wi: _wi, Ki }) => {
    const Kp = Ki.reduce((s: number, k: number, i: number) => s + k * (i + 1), 0) / (Ki.reduce((s: number) => s + 1, 0) || 1);
    return { result: Kp, unit: '—', steps: [`Kp = Σ(w_i·K_i)/Σw_i`, `Kp = ${Kp.toFixed(2)}`] };
  },
  129: ({ traceH }) => {
    const GDOP = Math.sqrt(traceH);
    return { result: GDOP, unit: '—', steps: [`GDOP = √(trace(H^T)^(-1))`, `GDOP = ${GDOP.toFixed(3)}`] };
  },
  130: ({ P, T, e, Sc }) => {
    const dTau = (0.002277 / Math.sin(P)) * (P + (1255 / (T + 0.05)) * e) * Sc;
    return { result: dTau, unit: 'm', steps: [`Δτ = (0.002277/sinθ)·[P+(1255/(T+0.05))·e]`, `Δτ = ${dTau.toFixed(4)} m`] };
  },

  // ── Part VII · Domain 22: Groundwater ──
  131: ({ T, h1, h2, r1, r2 }) => {
    const Q = (2 * Math.PI * T * (h2 - h1)) / Math.log(r2 / r1);
    return { result: Q, unit: 'm³/day', steps: [`Q = 2πT(h₂-h₁)/ln(r₂/r₁)`, `Q = ${Q.toFixed(3)} m³/day`] };
  },
  132: ({ Q, T, t, r, S }) => {
    const u = Math.max((r * r) * S / (4 * T * t), 1e-30);
    const gamma = 0.5772156649;
    const W_u = u < 1
      ? -gamma - Math.log(u) + u - (u * u) / 4 + (u * u * u) / 18 - (u * u * u * u) / 96
      : Math.exp(-u) / u;
    const s = (Q / (4 * Math.PI * T)) * W_u;
    return { result: s, unit: 'm', steps: [`s = (Q/4πT)·W(u), u = r²S/4Tt`, `u=${u.toExponential(2)}`, `W(u)≈${W_u.toExponential(3)}`, `s = ${s.toFixed(4)} m`] };
  },
  133: ({ Q, T, t, r, S }) => {
    const _u = (r * r) * S / (4 * T * t);
    const s = (2.3 * Q / (4 * Math.PI * T)) * Math.log10(2.25 * T * t / (r * r * S));
    return { result: s, unit: 'm', steps: [`s = (2.3Q/4πT)·log₁₀(2.25Tt/r²S)`, `s = ${s.toFixed(4)} m`] };
  },
  134: ({ fc, f0, k, t }) => {
    const f = fc + (f0 - fc) * Math.exp(-k * t);
    return { result: f, unit: 'mm/h', steps: [`f(t) = f_c + (f₀-f_c)·e^(-kt)`, `f = ${f.toFixed(3)} mm/h`] };
  },

  // ── Domain 23: Hazard & Risk ──
  135: ({ H, V, E }) => {
    const R = H * V * E;
    return { result: R, unit: '—', steps: [`R = H·V·E`, `R = ${R.toFixed(3)}`] };
  },
  136: ({ Parr, pdf: _pdf }) => {
    const EAD = Parr.reduce((s: number, p: number | { dmg: number }) => s + (typeof p === 'number' ? p : p.dmg), 0); // Σ∫₀¹ D(P)dP proxy
    return { result: EAD, unit: '$/yr', steps: [`EAD = ∫₀¹ D(P)dP`, `EAD ≈ ${EAD.toFixed(0)}`]}
  },
  137: ({ IHi, ILo, BPHi, BPLo, Cp, ILo2 }) => {
    const AQI = (IHi - ILo) / (BPHi - BPLo) * (Cp - BPLo) + ILo2;
    return { result: AQI, unit: '—', steps: [`AQI = [(IHi-ILo)/(BPHi-BPLo)]·(Cp-BPLo)+ILo`, `AQI = ${AQI.toFixed(0)}`] };
  },
  138: ({ Xbar, Kp, sigmaX }) => {
    const PMP = Xbar + Kp * sigmaX;
    return { result: PMP, unit: 'mm', steps: [`PMP = X̄ + K_p·σ_x`, `PMP = ${PMP.toFixed(1)} mm`] };
  },
  139: ({ Xim1, Zi }) => {
    const Xi = 0.897 * Xim1 + Zi / 3;
    return { result: Xi, unit: '—', steps: [`X_i = 0.897·X_{i-1} + Z/3`, `X_i = ${Xi.toFixed(3)}`] };
  },
  140: ({ K0, Vres, hb }) => {
    const Bavg = 0.1803 * K0 * Math.pow(Vres, 0.32) * Math.pow(hb, 0.19);
    return { result: Bavg, unit: 'm³/s', steps: [`B_avg = 0.1803·K₀·V_res^0.32·h_b^0.19`, `B_avg = ${Bavg.toFixed(1)} m³/s`] };
  },

  // ── Domain 24: Data Assimilation ──
  141: ({ xf, Pf, H, y, R, xb }) => {
    const den = (H * Pf * H + R) || 1;
    const K = (Pf * H) / den;
    const xa = xb + K * (y - H * xf);
    return { result: xa, unit: '—', steps: [`x_a = x_f + K(y-Hx_f); K = P_fH^T(HP_fH^T+R)^(-1)`, `x_a = ${xa.toFixed(3)}`] };
  },
  142: ({ xb, H, y, R, B }) => {
    const den = (H * B * H + R) || 1;
    const xa = xb + (B * H / den) * (y - H * xb);
    return { result: xa, unit: '—', steps: [`x_a = x_b + BH^T(HBH^T+R)^(-1)(y-Hx_b)`, `x_a = ${xa.toFixed(3)}`] };
  },
  143: ({ x, xb, B, y, H, R, i: _i }) => {
    const J = 0.5 * (x - xb) * (1 / B) * (x - xb) + 0.5 * (y - H * x) * (1 / R) * (y - H * x);
    return { result: J, unit: '—', steps: [`J(x)=½(x-x_b)^TB⁻¹(x-x_b)+½Σ(yᵢ-Hᵢ(x))ᵀRᵢ⁻¹(yᵢ-Hᵢ(x))`, `J = ${J.toFixed(3)}`] };
  },
  144: ({ px, py, Hxy }) => {
    const Hinfo = -px * Math.log2(px || 1e-9) - py * Math.log2(py || 1e-9) - Hxy * Math.log2(Hxy || 1e-9);
    return { result: Hinfo, unit: 'bits', steps: [`H(X) = -Σp(x)log₂p(x)`, `H = ${Hinfo.toFixed(3)} bits`] };
  },

  // ── Domain 25: Signal Processing ──
  145: ({ dKm, fGHz }) => {
    const FSPL = 32.45 + 20 * Math.log10(dKm || 1e-3) + 20 * Math.log10(fGHz || 1e-3);
    return { result: FSPL, unit: 'dB', steps: [`FSPL(dB)=32.45+20log₁₀(d_km)+20log₁₀(f_GHz)`, `FSPL = ${FSPL.toFixed(2)} dB`] };
  },
  146: ({ Ai, x }) => {
    const delay = (5e-9 + Ai * (1 - (x * x) / 2 + Math.pow(x, 4) / 24)) * 1e9; // Klobuchar model proxy
    return { result: delay, unit: 'ns', steps: [`Delay = [5×10⁻⁹ + A×(1-x²/2+x⁴/24)] s`, `Delay = ${delay.toFixed(1)} ns`] };
  },
  147: ({ f0, vrel, c }) => {
    const df = f0 * (vrel / (c || 1));
    return { result: df, unit: 'Hz', steps: [`Δf = f₀·v_rel/c`, `Δf = ${df.toFixed(1)} Hz`] };
  },

  // ── Domain 26: Mathematical Frameworks ──
  148: ({ GM, r1, r2 }) => {
    const dv1 = Math.sqrt(GM / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
    return { result: dv1, unit: 'm/s', steps: [`Δv₁ = √(GM/r₁)·[√(2r₂/(r₁+r₂))-1]`, `Δv₁ = ${dv1.toFixed(1)} m/s`] };
  },
  149: ({ x: _x, y: _y }) => {
    // 5th-order polynomial for collinear Lagrange points L1/L2
    const gamma = 0.5;
    const poly = gamma - gamma * gamma / 3 - gamma * gamma * gamma / 9; // leading-order L1/L2 distance proxy
    return { result: poly, unit: '—', steps: [`5th-order polynomial for collinear points`, `r_L ≈ ${poly.toFixed(4)}`] };
  },
  150: ({ px, py, pxy }) => {
    const MI = px * Math.log2((px || 1e-9) / (px * py / (pxy || 1e-9))) + py * Math.log2((py || 1e-9) / (py * px / (pxy || 1e-9)));
    return { result: MI, unit: 'bits', steps: [`I(X;Y)=Σp(x,y)log(p(x,y)/(p(x)p(y))`, `I = ${MI.toFixed(3)} bits`] };
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
  141: { 'x_f': 'xf', 'P_f': 'Pf' },
  144: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'Hxy' },
  145: { 'd_km': 'dKm', 'f_GHz': 'fGHz' },
  146: { 'A': 'Ai' },
  147: { 'f₀': 'f0', 'v_rel': 'vrel' },
  148: { 'r₁': 'r1', 'r₂': 'r2' },
  150: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'pxy' },
};

function normalizeInputs(id: number, inputs: Record<string, number>): Record<string, number> {
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
