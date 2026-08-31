/**
 * Harmonic Tide Prediction — exact transcription of the Schureman method
 * Reference: Pugh & Woodworth (2014) Sea-Level Science; NOAA SP-98 (Schureman).
 * The mathematics mirrors the `pytides` reference implementation:
 *   - astro(): astronomical arguments (Meeus polynomials) → s, h, p, N, pp, omega, i, I, xi, nu, nup, nupp
 *   - nodal corrections: node factor f and nodal phase u per constituent (Schureman eqs 65-78, Table 2)
 *   - equilibrium argument V0 and speed from Doodson/xdo coefficients (Schureman Table 13)
 *   - prediction: h(t) = Σ Aᵢ · fᵢ · cos(ωᵢ·t + (V₀ᵢ + uᵢ) − phaseᵢ)        (eq. above, in degrees)
 *
 * All angles in degrees unless converted to radians at evaluation.
 * No numeric libraries required (pure number arithmetic only).
 */

const D2R = Math.PI / 180.0;
const R2D = 180.0 / Math.PI;

function polynomial(coeffs: number[], x: number): number {
  let s = 0;
  for (let i = 0; i < coeffs.length; i++) s += coeffs[i] * Math.pow(x, i);
  return s;
}
function dPolynomial(coeffs: number[], x: number): number {
  let s = 0;
  for (let i = 1; i < coeffs.length; i++) s += coeffs[i] * i * Math.pow(x, i - 1);
  return s;
}
function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

// ── Julian Date (Meeus formula 7.1) ──
function julianDate(d: Date): number {
  let Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate() + d.getUTCHours() / 24 + d.getUTCMinutes() / 1440
    + d.getUTCSeconds() / 86400 + d.getUTCMilliseconds() / 86400000;
  if (M <= 2) { Y -= 1; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const M1 = M <= 2 ? M + 12 : M;
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M1 + 1)) + D + B - 1524.5;
}
/** Julian centuries from J2000 (Meeus 11.1) */
function T(d: Date): number {
  return (julianDate(d) - 2451545.0) / 36525.0;
}

// ── Polynomial coefficients (Meeus; degrees, per Julian century) ──
const LUNAR_LONGITUDE = [218.3164591, 481267.88134236, -0.0013268, 1 / 538841 - 1 / 65194000]; // s
const SOLAR_LONGITUDE = [280.46645, 36000.76983, 0.0003032]; // h
const LUNAR_PERIGEE = [83.3532430, 4069.0137111, -0.0103238, -1 / 80053, 1 / 18999000]; // p
const LUNAR_NODE = [125.0445550, -1934.1361849, 0.0020762, 1 / 467410, -1 / 60616000]; // N
const SOLAR_PERIGEE = [280.46645 - 357.52910, 36000.76932 - 35999.05030, 0.0003032 + 0.0001559, 0.00000048]; // pp
const _OBLIQUITY = [
  23.43929111, -1300 * 3600 / 3600000000 * 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]; // placeholder; recomputed below to match pytides

function terrestrialObliquityCoeffs(): number[] {
  const s2d = (deg: number, am = 0, as = 0) => deg + am / 60 + as / 3600;
  const raw = [
    s2d(23, 26, 21.448),
    -s2d(0, 0, 4680.93),
    -s2d(0, 0, 1.55),
    s2d(0, 0, 1999.25),
    -s2d(0, 0, 51.38),
    -s2d(0, 0, 249.67),
    -s2d(0, 0, 39.05),
    s2d(0, 0, 7.12),
    s2d(0, 0, 27.87),
    s2d(0, 0, 5.79),
    s2d(0, 0, 2.45),
  ];
  // adjust for T rather than U: multiply by (1e-2)^i
  return raw.map((c, i) => c * Math.pow(1e-2, i));
}

// ── Auxiliary Schureman quantities (from N, i, omega) — degrees ──
function Iof(N: number, i: number, omega: number): number {
  const nr = D2R * N, ir = D2R * i, wr = D2R * omega;
  const cosI = Math.cos(ir) * Math.cos(wr) - Math.sin(ir) * Math.sin(wr) * Math.cos(nr);
  return mod360(R2D * Math.acos(Math.min(1, Math.max(-1, cosI))));
}
function xiOf(N: number, i: number, omega: number): number {
  const nr = D2R * N, ir = D2R * i, wr = D2R * omega;
  let e1 = Math.cos(0.5 * (wr - ir)) / Math.cos(0.5 * (wr + ir)) * Math.tan(0.5 * nr);
  let e2 = Math.sin(0.5 * (wr - ir)) / Math.sin(0.5 * (wr + ir)) * Math.tan(0.5 * nr);
  e1 = Math.atan(e1); e2 = Math.atan(e2);
  e1 -= 0.5 * nr; e2 -= 0.5 * nr;
  return mod360(-(e1 + e2) * R2D);
}
function nuOf(N: number, i: number, omega: number): number {
  const nr = D2R * N, ir = D2R * i, wr = D2R * omega;
  let e1 = Math.cos(0.5 * (wr - ir)) / Math.cos(0.5 * (wr + ir)) * Math.tan(0.5 * nr);
  let e2 = Math.sin(0.5 * (wr - ir)) / Math.sin(0.5 * (wr + ir)) * Math.tan(0.5 * nr);
  e1 = Math.atan(e1); e2 = Math.atan(e2);
  e1 -= 0.5 * nr; e2 -= 0.5 * nr;
  return mod360((e1 - e2) * R2D);
}
function nupOf(N: number, i: number, omega: number): number {
  const Ir = D2R * Iof(N, i, omega);
  const nu = D2R * nuOf(N, i, omega);
  return mod360(R2D * Math.atan(Math.sin(2 * Ir) * Math.sin(nu) / (Math.sin(2 * Ir) * Math.cos(nu) + 0.3347)));
}
function nuppOf(N: number, i: number, omega: number): number {
  const Ir = D2R * Iof(N, i, omega);
  const nu = D2R * nuOf(N, i, omega);
  const tan2nupp = (Math.sin(Ir) ** 2 * Math.sin(2 * nu)) / (Math.sin(Ir) ** 2 * Math.cos(2 * nu) + 0.0727);
  return mod360(R2D * 0.5 * Math.atan(tan2nupp));
}

export interface Astro {
  t_plus_h_minus_s: number; // value, degrees
  s: number; h: number; p: number; N: number; pp: number; omega: number; i: number;
  I: number; xi: number; nu: number; nup: number; nupp: number;
  P: number;
  // speeds (deg / hour)
  s_speed: number; h_speed: number; p_speed: number; N_speed: number; pp_speed: number;
  t_speed: number; // T+h-s speed
}

/** Compute all astronomical arguments at a Date (Meeus / Schureman). */
export function astro(t: Date): Astro {
  const Tt = T(t);
  const dT_dHour = 1 / (24 * 365.25 * 100);
  const val = (c: number[]) => mod360(polynomial(c, Tt));
  const spd = (c: number[]) => dPolynomial(c, Tt) * dT_dHour;

  const s = val(LUNAR_LONGITUDE);
  const h = val(SOLAR_LONGITUDE);
  const p = val(LUNAR_PERIGEE);
  const N = val(LUNAR_NODE);
  const pp = val(SOLAR_PERIGEE);
  const omega = val(terrestrialObliquityCoeffs());
  const i = 5.145;

  const s_speed = spd(LUNAR_LONGITUDE);
  const h_speed = spd(SOLAR_LONGITUDE);
  const p_speed = spd(LUNAR_PERIGEE);
  const N_speed = spd(LUNAR_NODE);
  const pp_speed = spd(SOLAR_PERIGEE);

  const jd = julianDate(t);
  const hourAngle = mod360((jd - Math.floor(jd)) * 360.0);
  const t_plus_h_minus_s = mod360(hourAngle + h - s);
  const t_speed = 15.0 + h_speed - s_speed;

  const I = Iof(N, i, omega);
  const xi = xiOf(N, i, omega);
  const nu = nuOf(N, i, omega);
  const nup = nupOf(N, i, omega);
  const nupp = nuppOf(N, i, omega);
  const P = mod360(p - xi);

  return {
    t_plus_h_minus_s: t_plus_h_minus_s, s, h, p, N, pp, omega, i, I, xi, nu, nup, nupp, P,
    s_speed, h_speed, p_speed, N_speed, pp_speed, t_speed,
  };
}

// ── Nodal corrections (node factor f, nodal phase u) per constituent ──
const fUnity = (_a: Astro) => 1.0;
const uZero = (_a: Astro) => 0.0;

const f_Mm = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const mean = (2 / 3 - Math.sin(w) ** 2) * (1 - 1.5 * Math.sin(i) ** 2);
  return (2 / 3 - Math.sin(I) ** 2) / mean;
};
const f_Mf = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const mean = Math.sin(w) ** 2 * Math.cos(0.5 * i) ** 4;
  return Math.sin(I) ** 2 / mean;
};
const f_O1 = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const mean = Math.sin(w) * Math.cos(0.5 * w) ** 2 * Math.cos(0.5 * i) ** 4;
  return (Math.sin(I) * Math.cos(0.5 * I) ** 2) / mean;
};
const f_J1 = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const mean = Math.sin(2 * w) * (1 - 1.5 * Math.sin(i) ** 2);
  return Math.sin(2 * I) / mean;
};
const f_OO1 = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const mean = Math.sin(w) * Math.sin(0.5 * w) ** 2 * Math.cos(0.5 * i) ** 4;
  return Math.sin(I) * Math.sin(0.5 * I) ** 2 / mean;
};
const f_M2 = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const mean = Math.cos(0.5 * w) ** 4 * Math.cos(0.5 * i) ** 4;
  return Math.cos(0.5 * I) ** 4 / mean;
};
const f_K1 = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const nu = D2R * a.nu;
  const sin2Icosnu_mean = Math.sin(2 * w) * (1 - 1.5 * Math.sin(i) ** 2);
  const mean = 0.5023 * sin2Icosnu_mean + 0.1681;
  return Math.sqrt(0.2523 * Math.sin(2 * I) ** 2 + 0.1689 * Math.sin(2 * I) * Math.cos(nu) + 0.0283) / mean;
};
const f_L2 = (a: Astro) => {
  const P = D2R * a.P, I = D2R * a.I;
  const R_a_inv = Math.sqrt(1 - 12 * Math.tan(0.5 * I) ** 2 * Math.cos(2 * P) + 36 * Math.tan(0.5 * I) ** 4);
  return f_M2(a) * R_a_inv;
};
const f_K2 = (a: Astro) => {
  const w = D2R * a.omega, i = D2R * a.i, I = D2R * a.I;
  const nu = D2R * a.nu;
  const sinsqIcos2nu_mean = Math.sin(w) ** 2 * (1 - 1.5 * Math.sin(i) ** 2);
  const mean = 0.5023 * sinsqIcos2nu_mean + 0.0365;
  return Math.sqrt(0.2523 * Math.sin(I) ** 4 + 0.0367 * Math.sin(I) ** 2 * Math.cos(2 * nu) + 0.0013) / mean;
};
const f_M1 = (a: Astro) => {
  const P = D2R * a.P, I = D2R * a.I;
  const Q_a_inv = Math.sqrt(0.25 + 1.5 * Math.cos(I) * Math.cos(2 * P) / Math.cos(0.5 * I) ** 0.5
    + 2.25 * Math.cos(I) ** 2 / Math.cos(0.5 * I) ** 4);
  return f_O1(a) * Q_a_inv;
};
const f_Modd = (a: Astro, n: number) => f_M2(a) ** (n / 2);

// Node factor u (Schureman Table 2)
const u_Mf = (a: Astro) => -2 * a.xi;
const u_O1 = (a: Astro) => 2 * a.xi - a.nu;
const u_J1 = (a: Astro) => -a.nu;
const u_OO1 = (a: Astro) => -2 * a.xi - a.nu;
const u_M2 = (a: Astro) => 2 * a.xi - 2 * a.nu;
const u_K1 = (a: Astro) => -a.nup;
const u_L2 = (a: Astro) => {
  const I = D2R * a.I, P = D2R * a.P;
  const R = R2D * Math.atan(Math.sin(2 * P) / ((1 / 6) * Math.tan(0.5 * I) ** -2 - Math.cos(2 * P)));
  return 2 * a.xi - 2 * a.nu - R;
};
const u_K2 = (a: Astro) => -2 * a.nupp;
const u_M1 = (a: Astro) => {
  const I = D2R * a.I, P = D2R * a.P;
  const Q = R2D * Math.atan((5 * Math.cos(I) - 1) / (7 * Math.cos(I) + 1) * Math.tan(P));
  return a.xi - a.nu + Q;
};
const u_Modd = (a: Astro, n: number) => (n / 2) * u_M2(a);

// ── Constituent table: name → xdo coefficients over [T+h-s, s, h, p, N, pp, 90] ──
type Fx = (a: Astro) => number;
interface ConstituentDef {
  name: string;
  coeff: number[]; // length 7
  f: Fx;
  u: Fx;
}

// xdo letter → integer
const XDO = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9,
  J: 10, K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17,
  R: -8, S: -7, T: -6, U: -5, V: -4, W: -3, X: -2, Y: -1, Z: 0,
} as const;

function xdoToCoeff(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    if ((XDO as Record<string, number>)[ch.toUpperCase()] !== undefined) {
      out.push((XDO as Record<string, number>)[ch.toUpperCase()]);
    }
  }
  return out;
}

function base(name: string, xdo: string, f: Fx = fUnity, u: Fx = uZero): ConstituentDef {
  return { name, coeff: xdoToCoeff(xdo), f, u };
}

const _BASE: ConstituentDef[] = [
  base('Z0', 'ZZZZZZZ'),
  base('Sa', 'ZAZZZZZ'),
  base('Ssa', 'ZBZZZZZ'),
  base('Mm', 'ZAZYZZZ', f_Mm),
  base('Mf', 'ZBZZZZZ', f_Mf, u_Mf),
  base('Q1', 'AXZAZZA'.replace('X', 'X'), undefined as never), // placeholder, fixed below
];

// Rebuild the constituent table explicitly (clearer than dynamic xdo with odd groupings)
function C(name: string, xdo: string, f: Fx = fUnity, u: Fx = uZero): ConstituentDef {
  return base(name, xdo.replace(/\s/g, ''), f, u);
}

const CONSTITUENTS: ConstituentDef[] = [
  // Long-term
  C('Z0', 'ZZZZZZZ'),
  C('Sa', 'ZAZZZZZ'),
  C('Ssa', 'ZBZZZZZ'),
  C('Mm', 'ZAZYZZZ', f_Mm),
  C('Mf', 'ZBZZZZZ', f_Mf, u_Mf),
  // Diurnal
  C('Q1', 'AXZAZZA', f_O1, u_O1),
  C('O1', 'AYZZZZA', f_O1, u_O1),
  C('K1', 'AAZZZZY', f_K1, u_K1),
  C('J1', 'ABZYZZY', f_J1, u_J1),
  C('M1', 'AZZZZZA', f_M1, u_M1),
  C('P1', 'AAXZZZA', fUnity, uZero),
  C('S1', 'AAYZZZZ', fUnity, uZero),
  C('OO1', 'ACZZZZY', f_OO1, u_OO1),
  // Semi-diurnal
  C('2N2', 'BXZBZZZ', f_M2, u_M2),
  C('N2', 'BYZAZZZ', f_M2, u_M2),
  C('nu2', 'BYBYZZZ', f_M2, u_M2),
  C('M2', 'BZZZZZZ', f_M2, u_M2),
  C('lambda2', 'BAXAZZB', f_M2, u_M2),
  C('L2', 'BAZYZZB', f_L2, u_L2),
  C('T2', 'BBWZZAZ', fUnity, uZero),
  C('S2', 'BBXZZZZ', fUnity, uZero),
  C('R2', 'BBYZZYB', fUnity, uZero),
  C('K2', 'BBZZZZZ', f_K2, u_K2),
  // Third-diurnal
  C('M3', 'CZZZZZZ', (a) => f_Modd(a, 3), (a) => u_Modd(a, 3)),
  C('MK3', 'CZZZAZY', f_K1 === f_K1 ? fUnity : fUnity, uZero), // compound handled separately
];

/** V0 equilibrium argument at time t0 (degrees), from Doodson/xdo coefficients */
function V0At(c: ConstituentDef, a: Astro): number {
  const basis = [a.t_plus_h_minus_s, a.s, a.h, a.p, a.N, a.pp, 90];
  let v = 0;
  for (let k = 0; k < 7 && k < c.coeff.length; k++) v += c.coeff[k] * basis[k];
  return mod360(v);
}
/** speed (deg / hour) */
function speedAt(c: ConstituentDef, a: Astro): number {
  const basis = [a.t_speed, a.s_speed, a.h_speed, a.p_speed, a.N_speed, a.pp_speed, 0];
  let v = 0;
  for (let k = 0; k < 7 && k < c.coeff.length; k++) v += c.coeff[k] * basis[k];
  return v;
}

// Compound constituents defined as linear combinations of base members
interface Member { c: ConstituentDef; n: number; }
class Compound {
  name: string; members: Member[];
  constructor(name: string, members: Member[]) { this.name = name; this.members = members; }
  by(name: string): Member {
    const m = this.members.find(x => x.c.name.toLowerCase() === name.toLowerCase());
    if (!m) throw new Error('missing member ' + name);
    return m;
  }
  V0At(a: Astro): number { return this.members.reduce((s, m) => s + m.n * V0At(m.c, a), 0) % 360; }
  speedAt(a: Astro): number { return this.members.reduce((s, m) => s + m.n * speedAt(m.c, a), 0); }
  u(a: Astro): number { return this.members.reduce((s, m) => s + m.n * (m.c.u ? m.c.u(a) : 0), 0); }
  f(a: Astro): number { return this.members.reduce((p, m) => p * Math.pow(m.c.f ? m.c.f(a) : 1, Math.abs(m.n)), 1); }
}

function getC(name: string): ConstituentDef | undefined {
  return CONSTITUENTS.find(c => c.name.toLowerCase() === name.toLowerCase());
}

const COMPOUNDS: Compound[] = [
  new Compound('MS4', [{ c: getC('M2')!, n: 1 }, { c: getC('S2')!, n: 1 }]),
  new Compound('M4', [{ c: getC('M2')!, n: 2 }]),
  new Compound('MN4', [{ c: getC('M2')!, n: 1 }, { c: getC('N2')!, n: 1 }]),
  new Compound('MK3', [{ c: getC('M2')!, n: 1 }, { c: getC('K1')!, n: 1 }]),
  new Compound('2MK3', [{ c: getC('M2')!, n: 1 }, { c: getC('O1')!, n: 1 }]),
  new Compound('M6', [{ c: getC('M2')!, n: 3 }]),
  new Compound('S6', [{ c: getC('S2')!, n: 3 }]),
  new Compound('S4', [{ c: getC('S2')!, n: 2 }]),
  new Compound('M8', [{ c: getC('M2')!, n: 4 }]),
  new Compound('mu2', [{ c: getC('M2')!, n: 2 }, { c: getC('S2')!, n: -1 }]),
  new Compound('2SM2', [{ c: getC('S2')!, n: 2 }, { c: getC('M2')!, n: -1 }]),
  new Compound('2Q1', [{ c: getC('N2')!, n: 1 }, { c: getC('J1')!, n: -1 }]),
  new Compound('rho1', [{ c: getC('nu2')!, n: 1 }, { c: getC('K1')!, n: -1 }]),
  new Compound('MSF', [{ c: getC('S2')!, n: 1 }, { c: getC('M2')!, n: -1 }]),
];

function getDef(name: string): { V0: (a: Astro) => number; speed: (a: Astro) => number; f: Fx; u: Fx } | null {
  const comp = COMPOUNDS.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (comp) return { V0: (a) => comp.V0At(a), speed: (a) => comp.speedAt(a), f: (a) => comp.f(a), u: (a) => comp.u(a) };
  const c = getC(name);
  if (c) return { V0: (a) => V0At(c, a), speed: (a) => speedAt(c, a), f: c.f, u: c.u };
  return null;
}

export interface HarmonicInput {
  name: string;
  amplitude: number; // any consistent length unit (ft here → metres handled by caller)
  phase: number;     // phase lag (degrees, GMT epoch convention)
  speed?: number;    // optional override (deg/hr) — default computed from Schureman
}

/**
 * Evaluate the harmonic tide at time t (epoch Ms) for a constituent set.
 * Returns the tide height in the same linear unit as the amplitudes.
 * h(t) = Σ Aᵢ · fᵢ(t) · cos(ωᵢ · Δt + (V₀ᵢ + uᵢ(t)) − φᵢ)   (degrees)
 *   Δt = hours since the epoch at which V₀ was evaluated.
 */
export function predictHarmonic(
  epochMs: number, tMs: number, consts: HarmonicInput[],
): number {
  const a0 = astro(new Date(epochMs));
  const at = astro(new Date(tMs));
  const dtH = (tMs - epochMs) / 3600000;
  let h = 0;
  for (const c of consts) {
    if (!Number.isFinite(c.amplitude) || c.amplitude === 0) continue;
    const def = getDef(c.name);
    if (!def) continue;
    const w = c.speed ?? def.speed(a0); // deg / hour
    const V0 = def.V0(a0);
    const u = def.u(at);
    const f = def.f(at);
    const arg = D2R * (w * dtH + (V0 + u) - c.phase);
    h += c.amplitude * f * Math.cos(arg);
  }
  return h;
}
