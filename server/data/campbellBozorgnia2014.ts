/**
 * Campbell–Bozorgnia (2014) NGA-West2 GMPE — PGA (scalar port).
 *
 * Transcribed exactly from the OpenQuake hazardlib reference
 * implementation (gem/oq-engine, module
 * openquake/hazardlib/gsim/campbell_bozorgnia_2014.py), which encodes the
 * published coefficients of:
 *
 *   Campbell, K. W. and Bozorgnia, Y. (2014). "NGA-West2 Ground Motion
 *   Model for the Average Horizontal Components of PGA, PGV, and 5%
 *   Damped Linear Acceleration Response Spectra", Earthquake Spectra
 *   30(3):1087-1115.
 *
 * This scalar port evaluates the mean PGA (ln, in g) of the exact
 * NGA-West2 functional form: magnitude scaling (eq. 2), geometric
 * attenuation (eq. 3), style-of-faulting (eqs. 4-6), hanging wall
 * (eqs. 7-16), shallow nonlinear site response (eqs. 17-19 + 31,
 * c = 1.88, n = 1.18), fault dip (eq. 24), hypocentral depth (eqs. 21-23)
 * and anelastic attenuation (eq. 25). Basin depth (eqs. 20, 33-34) is
 * handled by using the Vs30=1100 m/s reference depth (z2pt5_ref), which
 * makes the basin term exactly zero — no basin adjustment is applied.
 *
 * Site Vs30 is derived from the fetched terrain slope via the
 * Wald & Allen (2007) proxy: log10(Vs30) = 3.74 − 0.9·log10(slope)
 * (active crust, slope in m/m), clamped to [150, 1500] m/s.
 */

export interface CB14Input {
  mag: number;       // moment magnitude M
  rrup: number;      // rupture distance, km
  rjb: number;       // Joyner-Boore distance, km
  rx: number;        // horizontal distance from top edge (km, ≥0 on HW)
  vs30: number;      // time-averaged Vs in top 30 m (m/s)
  rake: number;      // slip rake (degrees)
  dip: number;       // fault dip (degrees)
  ztor: number;      // depth to top of rupture (km)
  width: number;     // down-dip rupture width (km)
  hypoDepth: number; // hypocentral depth (km)
}

// PGA coefficient row from the published table (OpenQuake "pga" row).
const C: Record<string, number> = {
  c0: -4.416, c1: 0.984, c2: 0.537, c3: -1.499, c4: -0.496, c5: -2.773,
  c6: 0.248, c7: 6.768, c8: 0, c9: -0.212, c10: 0.72, c11: 1.09,
  c12: 2.186, c13: 1.42, c14: -0.0064, c15: -0.202, c16: 0.393,
  c17: 0.0977, c18: 0.0333, c19: 0.00757, c20: -0.0055, Dc20: 0,
  a2: 0.167, h1: 0.241, h2: 1.474, h3: -0.715, h5: -0.337, h6: -0.27,
  k1: 865, k2: -1.186, k3: 1.839,
};
const _K3 = C.k3;
const HC = { h4: 1.0, c: 1.88, n: 1.18 };

function getFMag(mag: number): number {
  let f = C.c0 + C.c1 * mag;
  if (mag > 4.5) f += C.c2 * (mag - 4.5);
  if (mag > 5.5) f += C.c3 * (mag - 5.5);
  if (mag > 6.5) f += C.c4 * (mag - 6.5);
  return f;
}

function getGeomAttenuation(mag: number, rrup: number): number {
  return (C.c5 + C.c6 * mag) * Math.log(Math.sqrt(rrup * rrup + C.c7 * C.c7));
}

function getFflt(mag: number, rake: number): number {
  const frv = rake > 30 && rake < 150 ? 1 : 0;
  const fnm = rake > -150 && rake < -30 ? 1 : 0;
  const ffltF = C.c8 * frv + C.c9 * fnm;
  let m = mag - 4.5;
  if (mag <= 4.5) m = 0;
  if (mag > 5.5) m = 1;
  return ffltF * m;
}

function f1rx(rx: number, r1: number): number {
  const rxr1 = rx / r1;
  return C.h1 + C.h2 * rxr1 + C.h3 * rxr1 * rxr1;
}

function f2rx(rx: number, r1: number, r2: number): number {
  const drx = (rx - r1) / (r2 - r1);
  return HC.h4 + C.h5 * drx + C.h6 * drx * drx;
}

function getFHNG(rx: number, rrup: number, rjb: number, mag: number,
  ztor: number, width: number, dip: number): number {
  const r1 = width * Math.cos(dip * Math.PI / 180);
  const r2 = 62 * mag - 350;
  let fhngrx = 0;
  if (rx >= 0 && rx < r1) fhngrx = f1rx(rx, r1);
  else if (rx >= r1) fhngrx = Math.max(0, f2rx(rx, r1, r2));

  const fhngrrup = rrup > 0 ? (rrup - rjb) / rrup : 1;

  let fhngm = (mag - 5.5) * (1 + C.a2 * (mag - 6.5));
  if (mag < 5.5) fhngm = 0;
  if (mag > 6.5) fhngm = 1 + C.a2 * (mag - 6.5);

  let fhngz = 1 - 0.06 * ztor;
  if (ztor > 16.66) fhngz = 0;

  const fhngdip = (90 - dip) / 45;
  return C.c10 * fhngrx * fhngrrup * fhngm * fhngz * fhngdip;
}

function getFsite(vs30: number, pgaRock: number): number {
  const vsMod = vs30 / C.k1;
  let f = C.c11 * Math.log(vsMod);
  if (vs30 > C.k1) {
    f += C.k2 * HC.n * Math.log(vsMod);
  } else {
    f += C.k2 * (Math.log(pgaRock + HC.c * Math.pow(vsMod, HC.n))
      - Math.log(pgaRock + HC.c));
  }
  return f;
}

function getFaultDip(mag: number, dip: number): number {
  if (mag < 4.5) return C.c19 * dip;
  if (mag > 5.5) return 0;
  return C.c19 * (5.5 - mag) * dip;
}

function getHypoDepth(mag: number, hypoDepth: number): number {
  const fhypH = Math.max(0, Math.min(13, hypoDepth - 7));
  let fhypM = C.c17;
  if (mag > 5.5) fhypM = C.c17 + (C.c18 - C.c17) * (mag - 5.5);
  if (mag > 6.5) fhypM = C.c18;
  return fhypH * fhypM;
}

function getAtten(rrup: number): number {
  return rrup >= 80 ? (C.c20 + C.Dc20) * (rrup - 80) : 0;
}

/** Baseline terms independent of site (magnitude through anelastic). */
function baseTerms(i: CB14Input): {
  fMag: number; fAtt: number; fFault: number; fHNG: number;
  fDip: number; fHyp: number; fAtten: number;
} {
  return {
    fMag: getFMag(i.mag),
    fAtt: getGeomAttenuation(i.mag, i.rrup),
    fFault: getFflt(i.mag, i.rake),
    fHNG: getFHNG(i.rx, i.rrup, i.rjb, i.mag, i.ztor, i.width, i.dip),
    fDip: getFaultDip(i.mag, i.dip),
    fHyp: getHypoDepth(i.mag, i.hypoDepth),
    fAtten: getAtten(i.rrup),
  };
}

/** Vs30-derived basin depth, eq. 33 (California model): z2pt5 in km. */
function basinDepthVs30(vs30: number): number {
  return Math.exp(7.089 - 1.144 * Math.log(vs30));
}

/** Basin term, eq. 20. z2pt5 in km; zero between 1 and 3 km. */
function basinTerm(z2pt5: number): number {
  if (z2pt5 < 1) return C.c14 * (z2pt5 - 1);
  if (z2pt5 > 3) {
    const basinCoeffs = C.c16 * C.k3;
    return basinCoeffs * Math.exp(-0.75) * (1 - Math.exp(-0.25 * (z2pt5 - 3)));
  }
  return 0;
}

/**
 * Mean ln(PGA) [g] — exact OpenQuake two-step flow:
 *   step 1: pga1100 = exp(mean at reference Vs30 = 1100 m/s with the
 *           reference-basin term; the site term is purely linear there
 *           (c11 + k2·n)·ln(1100/k1).
 *   step 2: mean = base + basin(z2.5(Vs30)) + nonlinear site(Vs30, pga1100).
 */
export function cb2014MeanLnPGA(i: CB14Input): number {
  const b = baseTerms(i);
  const base = b.fMag + b.fAtt + b.fFault + b.fHNG + b.fDip + b.fHyp + b.fAtten;
  const fbRef = basinTerm(basinDepthVs30(1100));
  const site1100 = (C.c11 + C.k2 * HC.n) * Math.log(1100 / C.k1);
  const pga1100 = Math.exp(base + fbRef + site1100);
  const fbVs = basinTerm(basinDepthVs30(i.vs30));
  return base + fbVs + getFsite(i.vs30, pga1100);
}

export interface CB14Terms extends ReturnType<typeof baseTerms> {
  fSite: number;
  fBasin: number;
  pga1100: number;
  lnPGA: number;
  pga: number;
}

/** Every NGA-West2 functional term for transparent reporting. */
export function cb2014Terms(i: CB14Input): CB14Terms {
  const b = baseTerms(i);
  const base = b.fMag + b.fAtt + b.fFault + b.fHNG + b.fDip + b.fHyp + b.fAtten;
  const fbRef = basinTerm(basinDepthVs30(1100));
  const site1100 = (C.c11 + C.k2 * HC.n) * Math.log(1100 / C.k1);
  const pga1100 = Math.exp(base + fbRef + site1100);
  const fBasin = basinTerm(basinDepthVs30(i.vs30));
  const fSite = getFsite(i.vs30, pga1100);
  const lnPGA = base + fBasin + fSite;
  return { ...b, fSite, fBasin, pga1100, lnPGA, pga: Math.exp(lnPGA) };
}

/**
 * Estimate Vs30 (m/s) from topographic slope (m/m) via Wald & Allen
 * (2007), BSSA 97(6):1969-1986, "active crust" (California proxy):
 *   log10(Vs30) = 3.74 − 0.9·log10(s).
 * Slope = 0 (flat basin/alluvium) maps to the NEHRP C/D boundary
 * (Vs30 ≈ 360 m/s). Clamped to [150, 1500] m/s.
 */
export function vs30FromSlope(slopeDeg: number): number {
  if (!Number.isFinite(slopeDeg) || slopeDeg <= 0) return 360;
  const slopeMM = Math.tan(slopeDeg * Math.PI / 180); // m/m
  const vs30 = Math.pow(10, 3.74 - 0.9 * Math.log10(slopeMM));
  return Math.max(150, Math.min(1500, vs30));
}

/**
 * Width estimation — Equation 39 of Campbell & Bozorgnia (2014):
 * log10(W) = (M − 4.07)/0.98; limited by the seismogenic layer.
 */
export function cb2014RuptureWidth(mag: number, dip: number, ztor: number, zbot = 15): number {
  const w = Math.sqrt(Math.pow(10, (mag - 4.07) / 0.98));
  const sinDip = Math.abs(Math.sin(dip * Math.PI / 180));
  if (sinDip > 0) return Math.min(w, Math.max(0, (zbot - ztor)) / sinDip);
  return w;
}

/**
 * ZTOR estimation — Eq. 4-5 of Chiou & Youngs (2014), exactly as used by
 * the OpenQuake CB2014 `estimate_ztor` option: reverse faults (30 < rake
 * < 150) vs all other styles.
 */
export function cb2014EstimateZtor(mag: number, rake: number): number {
  if (rake > 30 && rake < 150) {
    return Math.pow(Math.max(2.704 - 1.226 * Math.max(mag - 5.849, 0), 0), 2);
  }
  return Math.pow(Math.max(2.673 - 1.136 * Math.max(mag - 4.970, 0), 0), 2);
}

