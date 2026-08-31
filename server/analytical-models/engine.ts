/**
 * Analytical Models Engine — public registry.
 * The 150 equations live in equationParts/PART1..7 (extracted mechanically);
 * this file composes them and exposes the public API (EQUATION_ENGINE,
 * normalizeInputs, computeEquation, helpers) unchanged.
 */

import type { ComputeResult, ComputeFn } from './equationShared';
import { PART1 } from './equationParts/PART1';
import { PART2 } from './equationParts/PART2';
import { PART3 } from './equationParts/PART3';
import { PART4 } from './equationParts/PART4';
import { PART5 } from './equationParts/PART5';
import { PART6 } from './equationParts/PART6';
import { PART7 } from './equationParts/PART7';

export const EQUATION_ENGINE: Record<number, ComputeFn> = { ...PART1, ...PART2, ...PART3, ...PART4, ...PART5, ...PART6, ...PART7 };

// ── Public API re-exports (unchanged from the original monolithic engine) ──
export { schmidtNumberCO2, weissSolubilityCO2, wanninkhofK1992, teos10SpecVol, teos10SoundSpeed, gddMethods, faoYieldResponse } from './equationShared';
export type { ComputeResult, ComputeFn, Mat3, VariogramModel } from './equationShared';

/**
 * Maps the analytical-tool input symbols (often Unicode subscripts / Greek
 * letters, e.g. Rₙ, σₙ, T_air) to the plain-ASCII parameter names the
 * compute functions destructure. Without this every non-ASCII input arrives
 * as `undefined` and the result is NaN.
 */
const PARAM_ALIASES: Record<number, Record<string, string>> = {
  1: { 'T₁₀': 'T10', 'T₁₁': 'T11', 'ε₁₀': 'eps10', 'ε₁₁': 'eps11' },
  2: { 'λ': 'lambda' },
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
  21: { 'M': 'mag', 'R_rup': 'rrup', 'R_jb': 'rjb', 'R_x': 'rx', 'V_s30': 'vs30', 'λ': 'rake', 'D_ip': 'dip', 'Z_tor': 'ztor', 'W_id': 'width', 'H_d': 'hypoDepth' },
  22: { 'σₙ': 'sigmaN', 'tan φ': 'tanPhi' },
  23: { 'M₀': 'M0' },
  24: { 'M₀': 'M0' },
  25: { 'M_w': 'Mw' },
  32: { 'ε': 'eps', 'T_fire': 'Tfire', 'T_bg': 'Tbg' },
  33: { 'T_c': 'Tc', 'T_wet': 'Twet', 'T_dry': 'Tdry' },
  34: { 'T_air': 'Tair', 'T_base': 'Tbase' },
  35: { 'T_water': 'Twater', 'T_ice': 'Tice' },
  36: { 'lat₁': 'lat1', 'lon₁': 'lon1', 'lat₂': 'lat2', 'lon₂': 'lon2' },
  37: { 'λᵢ': 'weights' },
  38: { 'wᵢ': 'weights' },
  39: { 'σ_y': 'sigmaY', 'σ_z': 'sigmaZ' },
  40: { 'μ': 'mu', 'β': 'beta' },
  41: { 'ξ': 'xi', 'β': 'beta' },
  43: { 'θ_r': 'thetaR', 'θ_s': 'thetaS', 'α': 'alpha', 'ψ': 'psi' },
  44: { 'ψ_b': 'psib', 'ψ': 'psi', 'λ': 'lambda' },
  46: { 'R_base': 'Rbase', 'Q₁₀': 'Q10', 'T_base': 'Tbase' },
  47: { 'θ': 'theta', 'ρ_b': 'rhoB', 'OM%': 'omPct', 'q': 'sandFrac' },
  48: { 'κ': 'kappa', 'u_*': 'ustar', 'z₀': 'z0M' },
  49: { 'u_*': 'ustar', 'z₀': 'z0' },
  50: { 'g₀': 'g0', 'a₁': 'a1', 'hₛ': 'hs', 'cₛ': 'cs' },
  51: { 'ε': 'eps', 'fPAR': 'fpar', 'PAR': 'par' },
  52: { 'I₀': 'I0' },
  53: { 'R_eco': 'Reco' },
  54: { 'V_cmax': 'Vcmax', 'cᵢ': 'ci', 'Γ*': 'GammaStar', 'K_c': 'Kc', 'K_o': 'Ko' },
  55: { 'ρ': 'rho', 'D': 'DBH' },
  56: { 'K₀': 'K0', 'ΔpCO₂': 'dCO2' },
  57: { 'NO₃s': 'NO3s', 'NO₃d': 'NO3d' },
  58: { 'T_max': 'Tmax', 'T_min': 'Tmin', 'T_avg': 'Tavg', 'T_base': 'Tbase', 'T_upper': 'Tupper' },
  59: { 'α': 'alpha', 'Δ': 'delta', 'γ': 'gamma', 'Rₙ': 'Rn' },
  60: { 'Rₐ': 'Ra', 'T_max': 'Tmax', 'T_min': 'Tmin' },
  61: { 'Yₐ': 'Ya', 'Yₘ': 'Ym', 'K_y': 'Ky', 'ETₐ': 'ETa', 'ETₘ': 'ETm' },
  62: { 'μ₂₀': 'umax' },
  63: { 'ρ': 'rho', 'c_p': 'cp', 'T_s': 'Ts', 'T_a': 'Ta', 'r_a': 'ra', 'r_s': 'rs', 'e_s': 'es', 'e_a': 'ea', 'p': 'p' },
  64: { 'O₂': 'O2', 'J₁': 'J1', 'k₂': 'k2', 'J₃': 'J3', 'k₄': 'k4' },
  65: { '[OH]': 'OH' },
  66: { 'β': 'beta', 'ρ₀': 'rho0', '(∇×τ)_z': 'curlTau_z' },
  67: { 'β': 'beta' },
  68: { 'A_H': 'AH', 'β': 'beta', 'curlτ': 'curlTau', 'curl_z(τ)': 'curlTau' },
  69: { 'λ': 'lambda', 'δ': 'delta' },
  70: { 'Θ': 'Theta', 'S_A': 'S', 'SA': 'S' },
  71: { 'γ': 'gamma', 'ε': 'eps', 'N²': 'N2', '<(∇θ′)²>': 'gradVar', 'κ': 'kappa', '∂θ̄/∂z': 'dTdz' },
  72: { 'Δρ': 'drho', 'ΔV': 'dV', 'ρ₀': 'rho0' },
  73: { 'U₁₀': 'U', 'ω': 'omega', 'U10': 'U' },
  74: { 'H₀': 'H0', 'T₀': 'T0', 'β_f': 'betaF', 'βf': 'betaF' },
  75: { 'L*': 'L', 'h*': 'hstar' },
  76: { 'd_b': 'db' },
  77: { 'H_sb': 'Hsb', 'θ_b': 'thetaB', 'theta_b': 'thetaB' },
  79: { 'ω': 'omega', 'a': 'ka' },
  80: { 'α': 'alpha', 'g': 'g2', 'f_m': 'fm', 'γ': 'gamma' },
  84: { "c'": 'cprime', 'γz': 'gammaz', 'cosβ': 'cosB', "φ'": 'tanphi', 'sinβ': 'sinB', 'cos²β': 'cosB2', 'cos^2β': 'cosB2' },
  85: { 'μ': 'mu', 'σₙ': 'sigmaN', 'σ_n': 'sigmaN', 'ξ': 'xi' },
  86: { 'Aₛ': 'As', 'tan β': 'tanB' },
  87: { 'Aₛ': 'As', 'tan β': 'tanB' },
  88: { 'K_m': 'Km', 'e_w': 'ew', 'e_a': 'ea', 'u₉': 'u' },
  90: { 'Q₀': 'Q0' },
  91: { 'T_pos': 'Tpos' },
  93: { 'ρᵢ': 'rhoI', 'ρ_i': 'rhoI', 'ρ_f': 'rhoF' },
  95: { 'Q̇': 'Qdot', 'ρ_air': 'rhoAir', 'α': 'alpha' },
  96: { '∇²T': 'divDT' },
  97: { 'ΔF': 'dF', 'λ₀': 'lambda0' },
  98: { '∂R/∂T': 'dRdT' },
  99: { 'β': 'beta', 'k_x': 'kx', 'k_y': 'ky' },
  100: { '∂q/∂y': 'dpdy', '∂u/∂y': 'dudy' },
  101: { '∂u/∂z': 'dudy' },
  102: { 'ψ': 'psi', '∂²ψ/∂p²': 'dpp' },
  103: { 'u_bar': 'ubar', 'u_prime': 'uprime' },
  104: { 'K_m': 'Km' },
  105: { 'θ̄_v': 'thetaVbar', "w'θ'_v₀": 'wthetaV', 'z_i': 'zi' },
  106: { '|∇θ|': 'dtheta', 'β': 'cos2b', 'δ': 'delta', '|∂u/∂s|': 'dudy' },
  107: { 'ζ': 'zeta', '∇·V': 'div' },
  109: { 'N₀': 'N0', 'Λ': 'Lambda' },
  111: { 'x_p': 'xp', 'y_p': 'yp', "s'": 'sp', 's′': 'sp', 'GAST': 'gast', 'dX': 'dx', 'dY': 'dy', 'ωx': 'wx', 'ωy': 'wy', 'ωz': 'wz' },
  112: { 'h₂': 'hn', 'hₙ': 'hn', 'k₂': 'kn', 'V₂': 'Vn', 'Vₙ': 'Vn', 'φ': 'lat', 'R_e': 'Re' },
  113: { 'C_nm': 'Cnm', 'S_nm': 'Snm', 'P_nm': 'Pnm', 'λ': 'lam', 'φ': 'phi', 'R_e': 'Re', '∂P/∂φ': 'dPnm' },
  114: { 'ωx': 'wx', 'ωy': 'wy', 'ωz': 'wz', 'Rx': 'wx', 'Ry': 'wy', 'Rz': 'wz' },
  116: { 'nᵢ': 'ni', 'mᵢ': 'mi', 'T': 'T', 'z₀': 'z0' },
  117: { 'N_e': 'Ne', 'N_mF2': 'NmF2', 'h_mF2': 'hmF2' },
  119: { '⟨I⟩': 'Imean', 'σ_I': 'Istd' },
  120: { 'P_dyn': 'Pdyn', 'B_z': 'Bz' },
  121: { 'P_dyn': 'Pdyn' },
  122: { 'ε₀': 'eps0', 'k_B': 'kB', 'T_e': 'Te', 'n_e': 'ne' },
  123: { 'ρ': 'rho', 'C_D': 'CD' },
  124: { 'ρ': 'rho', 'C_D': 'CD' },
  125: { 'A₁': 'A1', 'A₂': 'A2', 'σ_x': 'sigmax', 'σ_y': 'sigmay' },
  126: { 'ρ2': 'rho2', 'ρ': 'rho2', 'σ': 'sigma', 'β': 'beta', 'γ': 'gamma' },
  127: { 'ẋ': 'xdot', 'ẏ': 'ydot', 'ż': 'zdot' },
  128: { 'wᵢ': 'wi', 'Kᵢ': 'Ki', 'Kp': 'kp' },
  129: { 'tr(H)': 'traceH', 'Q₁₁': 'Q11', 'Q₂₂': 'Q22', 'Q₃₃': 'Q33', 'Q₄₄': 'Q44' },
  130: { 'θ': 'Sc' },
  131: { 'h₁': 'h1', 'h₂': 'h2', 'r₁': 'r1', 'r₂': 'r2' },
  134: { 'f_c': 'fc', 'f₀': 'f0' },
  136: { 'D(P)': 'Parr' },
  137: { 'I_Hi': 'IHi', 'I_Lo': 'ILo', 'BP_Hi': 'BPHi', 'BP_Lo': 'BPLo', 'C_p': 'Cp' },
  138: { 'X̄': 'Xbar', 'K_p': 'Kp', 'σ_x': 'sigmaX' },
  139: { 'X_{i-1}': 'Xim1', 'Z': 'Zi', 'α': 'alpha' },
  140: { 'K₀': 'K0', 'V_res': 'Vres', 'h_b': 'hb' },
  141: { 'x_f': 'xf', 'P_f': 'Pf' },
  142: { 'x_b': 'xb' },
  144: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'Hxy' },
  145: { 'd_km': 'dKm', 'f_GHz': 'fGHz' },
  146: { 'A': 'alpha1', 'φ_m': 'phi_m' },
  147: { 'f₀': 'f0', 'v_rel': 'vrel' },
  148: { 'r₁': 'r1', 'r₂': 'r2' },
  150: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'pxy' },
};

export function normalizeInputs(id: number, inputs: Record<string, number>): Record<string, number> {
  const aliases = PARAM_ALIASES[id];
  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(inputs)) {
    const mapped = aliases ? (aliases[key] ?? key) : key;
    // Defensive numeric coercion: JSON transports inputs as strings (e.g.
    // "25" for T_max). Coerce a string that parses to a finite number; leave
    // objects, arrays, non-numeric strings (station refs, units), null/undefined.
    const value: unknown = rawValue;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      out[mapped] = Number(value) as number;
      continue;
    }
    out[mapped] = value as number;
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
  // Robustness (§5.5.1): a tool must NEVER throw — if an unexpected missing/
  // malformed input path slips past a per-tool guard, return honest NaN instead
  // of crashing the request. Genuine data is never fabricated here.
  try {
    return fn(normalizeInputs(id, inputs));
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
    return {
      result: Number.NaN,
      unit: '—',
      steps: [
        '── Analytical tool ──',
        `Computation failed on the supplied inputs: ${message}`,
        'Result: NaN (honest — no fabricated value substituted).',
      ],
    };
  }
}
