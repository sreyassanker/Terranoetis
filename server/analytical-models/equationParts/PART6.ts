/**
 * PART6 — analytical equations (extracted from original engine.ts).
 * Equations unchanged; imports computed from real usage.
 */
import { ARCSEC2RAD, EPS0, G_GRAV, K_BOLTZMANN, RAD2ARCSEC, mat3Det, mat3Mul, mat3Trace, mat3Vec, rot1, rot2, rot3 } from '../equationShared';
import type { ComputeFn } from '../equationShared';

export const PART6: Record<number, ComputeFn> = {

  // ── Part VI · Domain 18: Geodesy ──
  111: ({ xp, yp, sp, gast, dx, dy }) => {
    // IERS Conventions (2010) §5 — CIO-based Earth rotation matrix.
    //   W(t) = R₃(−s′)·R₂(x_p)·R₁(y_p)   (polar motion + TIO locator)
    //   R(t) = W(t)·R₃(GAST)             (Earth rotation)
    // x_p, y_p in arcsec; s′ (TIO locator) in arcsec; GAST in radians;
    // dX, dY (celestial pole offsets) in milliarcsec. The returned scalar
    // is det(R) — an orthonormality diagnostic that equals 1 for a valid
    // rotation matrix (trace tr(R) = 1 + 2·cos(angle) is secondary).
    const allFinite = [xp, yp, sp, gast].every(Number.isFinite);
    if (!allFinite) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'trace_R', value: Number.NaN, unit: '—', label: 'Trace tr(R) = 1+2cosθ' },
          { key: 'celestial_pole_offset', value: Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : Number.NaN, unit: 'mas', label: 'Celestial Pole Offset √(dX²+dY²)' },
        ],
        steps: [
          '── CIO-Based Earth Rotation Matrix (IERS Conventions 2010, §5) ──',
          'Polar motion x_p, y_p, TIO locator s′, or GAST is non-finite.',
          'No fabricated substitution — supply finite arcsec/radian inputs.',
          '',
          '  W = R₃(−s′)·R₂(x_p)·R₁(y_p)',
          '  R = W·R₃(GAST)   (TRS → CRS)',
        ],
      };
    }
    const xpR = xp * ARCSEC2RAD;
    const ypR = yp * ARCSEC2RAD;
    const spR = sp * ARCSEC2RAD;
    const W = mat3Mul(mat3Mul(rot3(-spR), rot2(xpR)), rot1(ypR));
    const R = mat3Mul(W, rot3(gast));
    const detR = mat3Det(R);
    const trR = mat3Trace(R);
    const cpo = Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : Number.NaN;
    return {
      result: detR, unit: '—',
      secondary: [
        { key: 'trace_R', value: trR, unit: '—', label: 'Trace tr(R) = 1+2cosθ' },
        { key: 'x_polar_motion', value: xp, unit: 'arcsec', label: 'Polar motion x_p' },
        { key: 'y_polar_motion', value: yp, unit: 'arcsec', label: 'Polar motion y_p' },
        { key: 'tio_locator', value: sp, unit: 'arcsec', label: 'TIO locator s′' },
        { key: 'gast', value: gast, unit: 'rad', label: 'Greenwich Apparent Sidereal Time' },
        { key: 'celestial_pole_offset', value: cpo, unit: 'mas', label: 'Celestial Pole Offset √(dX²+dY²)' },
      ],
      steps: [
        '── CIO-Based Earth Rotation Matrix (IERS Conventions 2010, §5) ──',
        `Polar motion x_p = ${xp}″, y_p = ${yp}″; TIO locator s′ = ${sp}″`,
        `GAST = ${gast} rad; celestial pole offset dX = ${Number.isFinite(dx) ? dx : 'NaN'}, dY = ${Number.isFinite(dy) ? dy : 'NaN'} mas`,
        '',
        'Step 1 — Polar-motion matrix (arcsec → rad, ×4.848×10⁻⁶):',
        `  W = R₃(−s′)·R₂(x_p)·R₁(y_p)`,
        `  W = R₃(−${spR.toExponential(4)})·R₂(${xpR.toExponential(4)})·R₁(${ypR.toExponential(4)})`,
        '',
        'Step 2 — Full Earth rotation:',
        `  R = W·R₃(GAST) = W·R₃(${gast.toFixed(6)})`,
        '',
        'Step 3 — Orthonormality diagnostic:',
        `  det(R) = ${detR.toFixed(12)} ${Math.abs(detR - 1) < 1e-9 ? '✓ (valid rotation matrix)' : '⚠ (deviates from 1)'}`,
        `  tr(R) = ${trR.toFixed(6)} = 1 + 2·cos(rotation angle)`,
        '',
        `  └ Full CIO chain: R(t) = Q(t)·R(t)·W(t) transforms ITRS → GCRS`,
        `  └ Celestial pole offset magnitude = ${Number.isFinite(cpo) ? cpo.toFixed(3) : 'NaN'} mas (IAU 2000A residuals)`,
      ],
    };
  },
  112: ({ hn, kn, Vn, g, lat, Re }) => {
    // Solid Earth tides (Love, 1911; Wahr, 1981). Degree-2 tidal potential
    // V₂ (m²/s²) with Love numbers h₂ (radial) and k₂ (potential):
    //   u_r = h₂·V₂/g   (radial displacement, m)
    //   Δg  = k₂·V₂/R_e (gravity perturbation, m/s²)
    // When V₂ is not supplied, the sub-lunar degree-2 potential of the
    // Moon is used: V₂ = G·M_moon·R_e²/D³ (Moon directly overhead).
    const G_MOON = 4.9028e12; // G·M_moon (m³/s²), DE421
    const D_MOON = 3.844e8;   // mean Earth–Moon distance (m)
    const ReEff = Re === undefined ? 6371000 : (Number.isFinite(Re) ? Re : Number.NaN);
    const h2 = hn === undefined ? 0.603 : (Number.isFinite(hn) ? hn : Number.NaN);
    const k2 = kn === undefined ? 0.298 : (Number.isFinite(kn) ? kn : Number.NaN);
    const gv = g === undefined ? G_GRAV : (Number.isFinite(g) ? g : Number.NaN);
    const latDeg = lat === undefined ? 45 : (Number.isFinite(lat) ? lat : Number.NaN);
    const latRad = Number.isFinite(latDeg) ? latDeg * Math.PI / 180 : Number.NaN;
    // Degree-2 latitude factor: V₂(φ) = V₂_eq · (3·sin²φ − 1)/2
    // (Wahr 1981; Pugh & Woodworth 2014). At φ=45° the factor is 0.5.
    const latFactor = Number.isFinite(latRad) ? (3 * Math.sin(latRad) * Math.sin(latRad) - 1) / 2 : Number.NaN;
    const V2 = Vn === undefined || Vn === 0
      ? (G_MOON * ReEff * ReEff) / (D_MOON * D_MOON * D_MOON) * (Number.isFinite(latFactor) ? latFactor : 1)
      : (Number.isFinite(Vn) ? Vn : Number.NaN);
    if (![ReEff, h2, k2, gv, latDeg, V2].every(Number.isFinite) || gv <= 0 || ReEff <= 0) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'tidal_potential', value: Number.isFinite(V2) ? V2 : Number.NaN, unit: 'm²/s²', label: 'Degree-2 Tidal Potential V₂' },
          { key: 'gravity_perturbation', value: Number.NaN, unit: 'm/s²', label: 'Gravity Perturbation Δg = k₂·V₂/R_e' },
        ],
        steps: [
          '── Earth Tides (Love 1911; Wahr 1981) ──',
          'A Love number (h₂/k₂), the tidal potential V₂, g, or R_e is',
          'non-finite, or g ≤ 0 / R_e ≤ 0. Result is NaN (honest — never',
          'fabricated). Supply h₂ ≈ 0.603, k₂ ≈ 0.298, V₂ (m²/s²), g (m/s²).',
        ],
      };
    }
    const u = h2 * V2 / gv;              // radial displacement (m)
    const dg = k2 * V2 / ReEff;          // gravity perturbation (m/s²)
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let phiDeg = -90; phiDeg <= 90; phiDeg += 5) {
      const sinPhi = Math.sin(phiDeg * Math.PI / 180);
      seriesPoints.push({ x: phiDeg, y: V2 * 0.5 * (3 * sinPhi * sinPhi - 1) });
    }
    return {
      result: u, unit: 'm',
      secondary: [
        { key: 'tidal_potential', value: V2, unit: 'm²/s²', label: 'Degree-2 Tidal Potential V₂' },
        { key: 'solid_earth_tide_height', value: u * 100, unit: 'cm', label: 'Solid Earth Tide Height (cm)' },
        { key: 'gravity_perturbation', value: dg, unit: 'm/s²', label: 'Gravity Perturbation Δg = k₂·V₂/R_e' },
        { key: 'love_number_h2', value: h2, unit: '—', label: 'Love number h₂' },
        { key: 'love_number_k2', value: k2, unit: '—', label: 'Love number k₂' },
      ],
      series: [{
        label: 'Degree-2 zonal tidal potential V₂(φ)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Earth Tides (Love 1911; Wahr 1981) ──',
        `Love numbers h₂ = ${h2}, k₂ = ${k2}; tidal potential V₂ = ${V2.toFixed(4)} m²/s²`,
        `Surface gravity g = ${gv.toFixed(4)} m/s², Earth radius R_e = ${ReEff.toFixed(0)} m`,
        '',
        'Step 1 — Radial solid-Earth tide displacement:',
        `  u_r = h₂·V₂/g = ${h2} × ${V2.toFixed(4)} / ${gv.toFixed(4)}`,
        `  u_r = ${u.toFixed(4)} m (${(u * 1000).toFixed(2)} mm, ${(u * 100).toFixed(1)} cm)`,
        '',
        'Step 2 — Gravity perturbation:',
        `  Δg = k₂·V₂/R_e = ${k2} × ${V2.toFixed(4)} / ${ReEff.toFixed(0)}`,
        `  Δg = ${dg.toExponential(3)} m/s² (${(dg * 1e5).toExponential(3)} mGal)`,
        '',
        `  └ Moon-overhead V₂ = G·M_moon·R_e²/D³ ≈ ${V2.toFixed(3)} m²/s²`,
        `  └ At ${latDeg.toFixed(0)}° latitude the zonal factor (3sin²φ−1)/2 = ${(0.5 * (3 * Math.pow(Math.sin(latDeg * Math.PI / 180), 2) - 1)).toFixed(3)}`,
        `  └ h₂ ≈ 0.603, k₂ ≈ 0.298 (PREM) — ocean loading adds ~2× in coastal zones`,
      ],
    };
  },
  113: ({ GM, r, n, m, Cnm, Snm, Pnm, phi, lam, Re, dPnm }) => {
    // Single harmonic of the EGM2008-style spherical-harmonic expansion.
    // Disturbing potential:  T = (GM/r)·(R_e/r)^n·(C_nm cos mλ + S_nm sin mλ)·P_nm(sinφ)
    // Gravity anomaly (spherical, free-air): Δg = −∂T/∂r − (2/r)T = (n−1)(GM/r²)·(R_e/r)^n·Y·P_nm
    // Deflections: η = −(1/(g·r·cosφ))·∂T/∂λ (exact), ξ = −(1/(g·r))·∂T/∂φ (needs ∂P/∂φ).
    const ReEff = Re === undefined ? 6371000 : (Number.isFinite(Re) ? Re : Number.NaN);
    const gmv = GM === undefined ? 3.986004418e14 : (Number.isFinite(GM) ? GM : Number.NaN);
    const rv = r === undefined ? 6371000 : (Number.isFinite(r) ? r : Number.NaN);
    const nv = n === undefined ? 2 : (Number.isFinite(n) ? n : Number.NaN);
    const mv = m === undefined ? 0 : (Number.isFinite(m) ? m : Number.NaN);
    const cnm = Cnm === undefined ? 1e-6 : (Number.isFinite(Cnm) ? Cnm : Number.NaN);
    const snm = Snm === undefined ? 0 : (Number.isFinite(Snm) ? Snm : Number.NaN);
    const pnm = Pnm === undefined ? 1 : (Number.isFinite(Pnm) ? Pnm : Number.NaN);
    const phiv = phi === undefined ? 0 : (Number.isFinite(phi) ? phi : Number.NaN);
    const lamv = lam === undefined ? 0 : (Number.isFinite(lam) ? lam : Number.NaN);
    const dPnmv = dPnm === undefined ? Number.NaN : (Number.isFinite(dPnm) ? dPnm : Number.NaN);
    if (![ReEff, gmv, rv, nv, mv, cnm, snm, pnm, phiv, lamv].every(Number.isFinite)
      || rv <= 0 || nv < 0 || mv < 0 || mv > nv) {
      return {
        result: Number.NaN, unit: 'mGal',
        secondary: [
          { key: 'disturbing_potential', value: Number.NaN, unit: 'm²/s²', label: 'Disturbing Potential T' },
          { key: 'deflection_eta', value: Number.NaN, unit: 'arcsec', label: 'Prime-vertical deflection η (east)' },
          { key: 'deflection_xi', value: Number.NaN, unit: 'arcsec', label: 'Meridian deflection ξ (north)' },
        ],
        steps: [
          '── Spherical Harmonic Gravity Field (Heiskanen & Moritz 1967; EGM2008) ──',
          'GM, r, n, m, C_nm, S_nm, P_nm, φ or λ is non-finite, or 0 ≤ m ≤ n',
          'and r > 0 are violated. Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const ratio = ReEff / rv;
    const scale = Math.pow(ratio, nv);
    const Y = cnm * Math.cos(mv * lamv) + snm * Math.sin(mv * lamv);
    const T = (gmv / rv) * scale * Y * pnm;                 // disturbing potential (m²/s²)
    const gAnom = (nv - 1) * (gmv / (rv * rv)) * scale * Y * pnm; // gravity anomaly (m/s²)
    const gAnomMG = gAnom * 1e5;                             // mGal (1 mGal = 10⁻⁵ m/s²)
    const gNorm = gmv / (rv * rv);                           // normal gravity (m/s²)
    const cosPhi = Math.cos(phiv);
    let eta = Number.NaN;
    if (Math.abs(cosPhi) > 1e-9) {
      const dTdL = (gmv / rv) * scale * mv * (-cnm * Math.sin(mv * lamv) + snm * Math.cos(mv * lamv)) * pnm;
      eta = -(1 / (gNorm * rv * cosPhi)) * dTdL * RAD2ARCSEC;
    }
    const xi = Number.isFinite(dPnmv)
      ? -(1 / (gNorm * rv)) * (gmv / rv) * scale * Y * dPnmv * RAD2ARCSEC
      : Number.NaN;
    return {
      result: gAnomMG, unit: 'mGal',
      secondary: [
        { key: 'disturbing_potential', value: T, unit: 'm²/s²', label: 'Disturbing Potential T' },
        { key: 'deflection_eta', value: Number.isFinite(eta) ? eta : Number.NaN, unit: 'arcsec', label: 'Prime-vertical deflection η (east)' },
        { key: 'deflection_xi', value: Number.isFinite(xi) ? xi : Number.NaN, unit: 'arcsec', label: 'Meridian deflection ξ (north, needs ∂P_nm/∂φ)' },
        { key: 'degree', value: nv, unit: '—', label: 'Degree n' },
        { key: 'order', value: mv, unit: '—', label: 'Order m' },
      ],
      steps: [
        '── Spherical Harmonic Gravity Field (Heiskanen & Moritz 1967; EGM2008) ──',
        `GM = ${gmv.toExponential(4)} m³/s², r = ${rv.toFixed(0)} m, R_e = ${ReEff.toFixed(0)} m`,
        `Degree n = ${nv}, order m = ${mv}; C_nm = ${cnm.toExponential(4)}, S_nm = ${snm.toExponential(4)}`,
        `P_nm(sinφ) = ${pnm.toExponential(4)}, φ = ${phiv.toFixed(4)} rad, λ = ${lamv.toFixed(4)} rad`,
        '',
        'Step 1 — Radial scale factor:',
        `  (R_e/r)^n = (${ReEff.toFixed(0)}/${rv.toFixed(0)})^${nv} = ${scale.toExponential(4)}`,
        '',
        'Step 2 — Surface spherical harmonic:',
        `  Y = C_nm·cos(mλ) + S_nm·sin(mλ) = ${Y.toExponential(4)}`,
        '',
        'Step 3 — Disturbing potential:',
        `  T = (GM/r)·(R_e/r)^n·Y·P_nm = ${T.toExponential(4)} m²/s²`,
        '',
        'Step 4 — Gravity anomaly (free-air, single harmonic):',
        `  Δg = (n−1)·(GM/r²)·(R_e/r)^n·Y·P_nm = ${gAnom.toExponential(4)} m/s²`,
        `  Δg = ${gAnomMG.toFixed(4)} mGal`,
        '',
        'Step 5 — Deflections of the vertical:',
        `  η = −(1/(g·r·cosφ))·∂T/∂λ = ${Number.isFinite(eta) ? eta.toFixed(4) : 'NaN'}″ (east)`,
        `  ξ = −(1/(g·r))·∂T/∂φ = ${Number.isFinite(xi) ? xi.toFixed(4) : 'NaN'}″ (north; needs ∂P_nm/∂φ)`,
        '',
        `  └ Full field: Δg = (GM/r²)·Σ (n−1)(R_e/r)^n·(C_nm cos mλ + S_nm sin mλ)·P_nm(sinφ)`,
        `  └ EGM2008 complete to degree/order 2190 (~5′ resolution)`,
      ],
    };
  },
  114: ({ X, T, S, s, wx, wy, wz, Xobs }) => {
    // Helmert 7-parameter similarity transformation (Helmert 1880;
    // Molodensky 1962):  X′ = T + (1+s)·R·X
    //   T    — 3 translations [tx, ty, tz] (m)
    //   s    — scale factor in ppm (or S as an explicit multiplier, 1+ppm)
    //   ωx,ωy,ωz — rotations about x,y,z axes (arcsec)
    // The returned scalar is |X′| (norm of the transformed vector, m).
    const toVec = (v: unknown): [number, number, number] => {
      if (Array.isArray(v) && v.length >= 1) {
        const a = [Number(v[0]), Number(v[1]), Number(v[2])];
        if (a.every(Number.isFinite)) return [a[0], a[1], a[2]];
        return [Number.NaN, Number.NaN, Number.NaN];
      }
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isFinite(n)) return [n, 0, 0];
      return [Number.NaN, Number.NaN, Number.NaN];
    };
    const Xv = toVec(X);
    const Tv = toVec(T);
    const scale = S === undefined ? Number.NaN : (Number.isFinite(S) ? S : Number.NaN);
    const spm = s === undefined ? Number.NaN : (Number.isFinite(s) ? s : Number.NaN);
    const scaleEff = Number.isFinite(scale) ? scale : (Number.isFinite(spm) ? 1 + spm * 1e-6 : Number.NaN);
    const wxv = wx === undefined ? 0 : (Number.isFinite(wx) ? wx : Number.NaN);
    const wyv = wy === undefined ? 0 : (Number.isFinite(wy) ? wy : Number.NaN);
    const wzv = wz === undefined ? 0 : (Number.isFinite(wz) ? wz : Number.NaN);
    if (!Xv.every(Number.isFinite) || !Tv.every(Number.isFinite)
      || !Number.isFinite(scaleEff) || scaleEff <= 0
      || ![wxv, wyv, wzv].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'scale_ppm', value: Number.NaN, unit: 'ppm', label: 'Scale factor (ppm)' },
          { key: 'rotation_x', value: Number.NaN, unit: 'arcsec', label: 'Rotation ωx' },
          { key: 'rotation_y', value: Number.NaN, unit: 'arcsec', label: 'Rotation ωy' },
          { key: 'rotation_z', value: Number.NaN, unit: 'arcsec', label: 'Rotation ωz' },
          { key: 'displacement', value: Number.NaN, unit: 'm', label: '|X′ − X|' },
          { key: 'residual', value: Number.NaN, unit: 'm', label: 'Residual |X′ − X_obs|' },
        ],
        steps: [
          '── Helmert 7-Parameter Transformation (Helmert 1880; Molodensky 1962) ──',
          'X′ = T + (1+s)·R·X requires a finite 3-vector X, a finite 3-vector T,',
          'a positive scale factor (S or s ppm), and finite rotations.',
          'Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const Rx = rot1(wxv * ARCSEC2RAD);
    const Ry = rot2(wyv * ARCSEC2RAD);
    const Rz = rot3(wzv * ARCSEC2RAD);
    const R = mat3Mul(mat3Mul(Rx, Ry), Rz);
    const rot = mat3Vec(R, Xv);
    const Xp: [number, number, number] = [
      Tv[0] + scaleEff * rot[0],
      Tv[1] + scaleEff * rot[1],
      Tv[2] + scaleEff * rot[2],
    ];
    const norm = Math.hypot(Xp[0], Xp[1], Xp[2]);
    const disp = Math.hypot(Xp[0] - Xv[0], Xp[1] - Xv[1], Xp[2] - Xv[2]);
    const residual = Array.isArray(Xobs) && Xobs.length >= 1
      ? Math.hypot(Xp[0] - Number(Xobs[0]), Xp[1] - Number(Xobs[1]), Xp[2] - Number(Xobs[2]))
      : Number.NaN;
    return {
      result: norm, unit: 'm',
      secondary: [
        { key: 'x_prime', value: Xp[0], unit: 'm', label: "Transformed component x′" },
        { key: 'y_prime', value: Xp[1], unit: 'm', label: "Transformed component y′" },
        { key: 'z_prime', value: Xp[2], unit: 'm', label: "Transformed component z′" },
        { key: 'scale_ppm', value: (scaleEff - 1) * 1e6, unit: 'ppm', label: 'Scale factor (ppm)' },
        { key: 'rotation_x', value: wxv, unit: 'arcsec', label: 'Rotation ωx' },
        { key: 'rotation_y', value: wyv, unit: 'arcsec', label: 'Rotation ωy' },
        { key: 'rotation_z', value: wzv, unit: 'arcsec', label: 'Rotation ωz' },
        { key: 'displacement', value: disp, unit: 'm', label: '|X′ − X|' },
        { key: 'residual', value: Number.isFinite(residual) ? residual : Number.NaN, unit: 'm', label: 'Residual |X′ − X_obs|' },
      ],
      steps: [
        '── Helmert 7-Parameter Transformation (Helmert 1880; Molodensky 1962) ──',
        `Input vector X = [${Xv.join(', ')}] m`,
        `Translation T = [${Tv.join(', ')}] m`,
        `Scale factor = ${scaleEff} (${((scaleEff - 1) * 1e6).toFixed(3)} ppm)`,
        `Rotations ωx = ${wxv}″, ωy = ${wyv}″, ωz = ${wzv}″`,
        '',
        'Step 1 — Rotation matrix (arcsec → rad):',
        `  R = R₁(ωx)·R₂(ωy)·R₃(ωz)  (det R = ${mat3Det(R).toFixed(12)})`,
        '',
        'Step 2 — Scale + rotate:',
        `  (1+s)·R·X = ${scaleEff} × R × [${Xv.join(', ')}] = [${rot.map((c) => c.toFixed(4)).join(', ')}] m`,
        '',
        'Step 3 — Translate:',
        `  X′ = T + (1+s)·R·X = [${Xp.map((c) => c.toFixed(4)).join(', ')}] m`,
        `  |X′| = ${norm.toFixed(4)} m`,
        '',
        'Step 4 — Residuals:',
        `  Δ = |X′ − X| = ${disp.toFixed(4)} m ${disp > 100 ? '(continental-scale shift)' : disp > 1 ? '(regional datum shift)' : '(local/minor refinement)'}`,
        `  ${Number.isFinite(residual) ? `residual |X′ − X_obs| = ${residual.toFixed(4)} m` : 'residual: no observed X′ supplied'}`,
        '',
        `  └ 7 parameters (3 translations, 3 rotations, 1 scale) for ITRF↔WGS84↔ETRS89`,
      ],
    };
  },
  115: ({ h, N }) => {
    // Orthometric height (Helmert 1890; Heiskanen & Moritz 1967): H = h − N,
    // where h is the ellipsoidal (GNSS) height and N the geoid undulation.
    const hv = h === undefined ? Number.NaN : (Number.isFinite(h) ? h : Number.NaN);
    const Nv = N === undefined ? Number.NaN : (Number.isFinite(N) ? N : Number.NaN);
    if (!Number.isFinite(hv) || !Number.isFinite(Nv)) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'ellipsoid_height', value: Number.isFinite(hv) ? hv : Number.NaN, unit: 'm', label: 'Ellipsoidal height h (GNSS)' },
          { key: 'geoid_undulation', value: Number.isFinite(Nv) ? Nv : Number.NaN, unit: 'm', label: 'Geoid undulation N (EGM2008/EGM2020)' },
        ],
        steps: [
          '── Orthometric Height (Helmert 1890; Heiskanen & Moritz 1967) ──',
          'H = h − N requires a finite ellipsoidal height h and a finite',
          'geoid undulation N. Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const H = hv - Nv;
    return {
      result: H, unit: 'm',
      secondary: [
        { key: 'ellipsoid_height', value: hv, unit: 'm', label: 'Ellipsoidal height h (GNSS)' },
        { key: 'geoid_undulation', value: Nv, unit: 'm', label: 'Geoid undulation N (EGM2008/EGM2020)' },
      ],
      steps: [
        '── Orthometric Height (Helmert 1890; Heiskanen & Moritz 1967) ──',
        `Ellipsoidal height (GNSS) h = ${hv.toFixed(3)} m`,
        `Geoid undulation N = ${Nv.toFixed(3)} m (EGM2008/EGM2020)`,
        '',
        'Step 1 — Convert to orthometric height:',
        `  H = h − N = ${hv.toFixed(3)} − ${Nv.toFixed(3)}`,
        `  H = ${H.toFixed(3)} m (height above sea level / geoid)`,
        '',
        'Step 2 — Geoid context:',
        `  ${Nv > 0 ? 'N > 0: geoid above ellipsoid (excess mass region)' : 'N < 0: geoid below ellipsoid (mass deficit region)'}`,
        `  Geoid slope: ~${Math.abs(Nv / 100e3 * 1e6).toFixed(2)} cm/km (typical geoid gradient)`,
        '',
        `  └ EGM2020 resolution ~5′ (~9 km); accuracy improves with regional geoid models`,
        `  └ In coastal zones, use local chart datum (e.g., LAT, MSL) — orthometric height ≠ tidal datum`,
      ],
    };
  },

  // ── Domain 19: Ionosphere & Magnetosphere ──
  116: ({ ni, mi, T, alt, z0 }) => {
    // NRLMSISE-00 (simplified barometric). Total neutral mass density from
    // per-species number densities n_i (m⁻³) and masses m_i (kg):
    //   ρ = Σ n_i·m_i
    // With a neutral temperature T (K), a scale height H = kT/(m̄g) drives
    // the isothermal profile ρ(z) = ρ₀·exp(−(z−z₀)/H) for the series.
    const niArr: number[] = Array.isArray(ni) ? ni.map(Number) : [];
    const miArr: number[] = Array.isArray(mi) ? mi.map(Number) : [];
    const good = niArr.length > 0 && miArr.length >= niArr.length
      && niArr.every((v) => Number.isFinite(v) && v >= 0)
      && miArr.slice(0, niArr.length).every((v) => Number.isFinite(v) && v >= 0);
    if (!good) {
      return {
        result: Number.NaN, unit: 'kg/m³',
        secondary: [
          { key: 'number_density', value: Number.NaN, unit: 'm⁻³', label: 'Total Number Density Σ nᵢ' },
          { key: 'mean_molecular_mass', value: Number.NaN, unit: 'kg', label: 'Mean Molecular Mass' },
          { key: 'o_n2_ratio', value: Number.NaN, unit: '—', label: 'O/N₂ ratio (n_O/n_N₂)' },
          { key: 'temperature', value: Number.NaN, unit: 'K', label: 'Neutral Temperature T' },
        ],
        steps: [
          '── NRLMSISE-00 (simplified barometric; Picone et al. 2002) ──',
          'Species number densities n_i and masses m_i are required as',
          'finite, non-negative, matched-length arrays. Result is NaN',
          '(honest — never fabricated).',
        ],
      };
    }
    let rho = 0, nTot = 0;
    for (let i = 0; i < niArr.length; i++) { rho += niArr[i] * miArr[i]; nTot += niArr[i]; }
    const mBar = nTot > 0 ? rho / nTot : Number.NaN;
    const oN2 = niArr.length >= 2 && niArr[1] > 0 ? niArr[0] / niArr[1] : Number.NaN;
    const Tk = T === undefined ? Number.NaN : (Number.isFinite(T) ? T : Number.NaN);
    const scaleH = Number.isFinite(Tk) && Number.isFinite(mBar) && mBar > 0
      ? (K_BOLTZMANN * Tk) / (mBar * G_GRAV) : Number.NaN;
    const z0km = z0 === undefined ? 200 : (Number.isFinite(z0) ? z0 : Number.NaN);
    const altKm = alt === undefined ? z0km : (Number.isFinite(alt) ? alt : Number.NaN);
    const rhoAtAlt = Number.isFinite(altKm) && Number.isFinite(z0km) && Number.isFinite(scaleH) && scaleH > 0
      ? rho * Math.exp(-((altKm - z0km) * 1000) / scaleH) : Number.NaN;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    if (Number.isFinite(scaleH) && scaleH > 0 && Number.isFinite(z0km)) {
      const zStart = Math.max(100, z0km);
      for (let z = zStart; z <= z0km + 500; z += 10) {
        seriesPoints.push({ x: z, y: rho * Math.exp(-((z - z0km) * 1000) / scaleH) });
      }
    }
    return {
      result: rho, unit: 'kg/m³',
      secondary: [
        { key: 'number_density', value: nTot, unit: 'm⁻³', label: 'Total Number Density Σ nᵢ' },
        { key: 'mean_molecular_mass', value: Number.isFinite(mBar) ? mBar : Number.NaN, unit: 'kg', label: 'Mean Molecular Mass' },
        { key: 'o_n2_ratio', value: Number.isFinite(oN2) ? oN2 : Number.NaN, unit: '—', label: 'O/N₂ ratio (n_O/n_N₂)' },
        { key: 'temperature', value: Number.isFinite(Tk) ? Tk : Number.NaN, unit: 'K', label: 'Neutral Temperature T' },
        { key: 'scale_height', value: Number.isFinite(scaleH) ? scaleH : Number.NaN, unit: 'm', label: 'Scale Height H = kT/(m̄g)' },
        { key: 'density_at_altitude', value: Number.isFinite(rhoAtAlt) ? rhoAtAlt : Number.NaN, unit: 'kg/m³', label: `Mass Density at ${Number.isFinite(altKm) ? altKm.toFixed(0) : 'N/A'} km` },
      ],
      series: seriesPoints.length > 0
        ? [{ label: 'Mass density ρ(z) — simplified barometric', color: '#0072B2', points: seriesPoints }]
        : undefined,
      steps: [
        '── NRLMSISE-00 (simplified barometric; Picone et al. 2002) ──',
        `${niArr.length} species, densities [${niArr.map((n: number) => n.toExponential(2)).join(', ')}] m⁻³`,
        `Masses [${miArr.map((m: number) => m.toExponential(2)).join(', ')}] kg`,
        '',
        'Step 1 — Total neutral mass density:',
        `  ρ = Σ(n_i·m_i) = ${rho.toExponential(4)} kg/m³`,
        '',
        'Step 2 — Derived quantities:',
        `  Total number density n = Σ n_i = ${nTot.toExponential(3)} m⁻³`,
        `  Mean molecular mass m̄ = ρ/n = ${Number.isFinite(mBar) ? mBar.toExponential(3) : 'NaN'} kg`,
        `  O/N₂ ratio = ${Number.isFinite(oN2) ? oN2.toFixed(3) : 'NaN'}`,
        `  ${Number.isFinite(scaleH) ? `Scale height H = kT/(m̄g) = ${(scaleH / 1000).toFixed(2)} km` : 'Scale height: supply neutral temperature T (K)'}`,
        '',
        'Step 3 — Regime (satellite drag):',
        `  ${Number.isFinite(rhoAtAlt) ? `ρ(${Number.isFinite(altKm) ? altKm.toFixed(0) : 'N/A'} km) = ${rhoAtAlt.toExponential(3)} kg/m³ (barometric extrapolation from z₀ = ${Number.isFinite(z0km) ? z0km.toFixed(0) : 'N/A'} km)` : 'ρ at requested altitude: supply z₀ and T for barometric extrapolation'}`,
        `  ${rho > 1e-13 ? 'Low LEO — high drag (dominant for decay)' : rho > 1e-15 ? 'Mid LEO — moderate drag' : 'High LEO / MEO — low drag'}`,
        '',
        `  └ Full NRLMSISE-00 uses MSIS-style 12-parameter exospheric expansion`,
      ],
    };
  },
  117: ({ Ne, alt, lat, lon, NmF2, hmF2, H }) => {
    // IRI-2016 (simplified). Electron density N_e at altitude/latitude/
    // longitude. When N_e is not supplied it is derived from a Chapman
    // F2-layer: N_e(h) = NmF2·exp(0.5·(1 − z − e^(−z))), z = (h − hmF2)/H.
    // Altitudes h, hmF2 and scale height H are in metres.
    const Nev = Ne === undefined ? Number.NaN : (Number.isFinite(Ne) ? Ne : Number.NaN);
    const altM = alt === undefined ? Number.NaN : (Number.isFinite(alt) ? alt : Number.NaN);
    const Nm = NmF2 === undefined ? Number.NaN : (Number.isFinite(NmF2) ? NmF2 : Number.NaN);
    const hm = hmF2 === undefined ? Number.NaN : (Number.isFinite(hmF2) ? hmF2 : Number.NaN);
    const Hc = H === undefined ? 60000 : (Number.isFinite(H) && H > 0 ? H : Number.NaN);
    const chapmanNe = (hKmM: number) => {
      if (!Number.isFinite(Nm) || !Number.isFinite(hm) || !Number.isFinite(Hc) || Hc <= 0) return Number.NaN;
      const z = (hKmM - hm) / Hc;
      return Nm * Math.exp(0.5 * (1 - z - Math.exp(-z)));
    };
    const NeEff = Number.isFinite(Nev) ? Nev : (Number.isFinite(altM) ? chapmanNe(altM) : Number.NaN);
    if (!Number.isFinite(NeEff) || NeEff < 0) {
      return {
        result: Number.NaN, unit: 'm⁻³',
        secondary: [
          { key: 'plasma_frequency', value: Number.NaN, unit: 'MHz', label: 'Plasma Frequency f_p at point' },
          { key: 'foF2', value: Number.NaN, unit: 'MHz', label: 'F2 Critical Frequency foF2' },
          { key: 'hmF2', value: Number.NaN, unit: 'km', label: 'Height of F2 Peak (HMF)' },
          { key: 'tec', value: Number.NaN, unit: 'TECU', label: 'Total Electron Content (Chapman model)' },
        ],
        steps: [
          '── IRI-2016 (simplified Chapman; Bilitza et al. 2017) ──',
          'Electron density N_e (or NmF2 + hmF2 + altitude) is required as a',
          'finite, non-negative value. Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const fpMHz = Math.sqrt(NeEff * 80.6164) * 1e-6;            // plasma frequency (MHz)
    const foF2 = Number.isFinite(Nm) && Nm > 0
      ? Math.sqrt(Nm * 80.6164) * 1e-6 : Number.NaN;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    let tec = 0; // m⁻² (trapezoidal integral over the Chapman profile)
    if (Number.isFinite(Nm) && Number.isFinite(hm) && Number.isFinite(Hc) && Hc > 0) {
      let prev: { h: number; ne: number } | null = null;
      for (let hM = 80e3; hM <= 800e3; hM += 10e3) {
        const ne = chapmanNe(hM);
        seriesPoints.push({ x: hM / 1000, y: ne });
        if (prev) tec += (prev.ne + ne) / 2 * (hM - prev.h);
        prev = { h: hM, ne };
      }
    }
    const tecTECU = tec > 0 ? tec / 1e16 : Number.NaN;
    const latLabel = Number.isFinite(lat) ? lat.toFixed(2) : 'N/A';
    const lonLabel = Number.isFinite(lon) ? lon.toFixed(2) : 'N/A';
    return {
      result: NeEff, unit: 'm⁻³',
      secondary: [
        { key: 'plasma_frequency', value: fpMHz, unit: 'MHz', label: 'Plasma Frequency f_p at point' },
        { key: 'foF2', value: Number.isFinite(foF2) ? foF2 : Number.NaN, unit: 'MHz', label: 'F2 Critical Frequency foF2' },
        { key: 'hmF2', value: Number.isFinite(hm) ? hm / 1000 : Number.NaN, unit: 'km', label: 'Height of F2 Peak (HMF)' },
        { key: 'tec', value: Number.isFinite(tecTECU) ? tecTECU : Number.NaN, unit: 'TECU', label: 'Total Electron Content (Chapman model)' },
      ],
      series: seriesPoints.length > 0
        ? [{ label: 'Electron density N_e(h) — Chapman layer', color: '#0072B2', points: seriesPoints }]
        : undefined,
      steps: [
        '── IRI-2016 (simplified Chapman; Bilitza et al. 2017) ──',
        `Electron density N_e = ${NeEff.toExponential(3)} m⁻³ at (${latLabel}°, ${lonLabel}°)`,
        `F2 peak density NmF2 = ${Number.isFinite(Nm) ? Nm.toExponential(3) : 'N/A'} m⁻³, hmF2 = ${Number.isFinite(hm) ? (hm / 1000).toFixed(1) : 'N/A'} km`,
        '',
        'Step 1 — Plasma frequency:',
        `  f_p = √(N_e·e²/(4π²ε₀m_e)) ≈ √(N_e × 80.6164)`,
        `  f_p = ${fpMHz.toFixed(3)} MHz`,
        '',
        'Step 2 — F2 critical frequency:',
        `  foF2 = √(NmF2 × 80.6164)·10⁻⁶ = ${Number.isFinite(foF2) ? foF2.toFixed(3) : 'NaN'} MHz`,
        '',
        'Step 3 — Chapman F2-layer profile:',
        `  N_e(h) = NmF2·exp(½(1 − z − e^(−z))), z = (h − hmF2)/H`,
        `  ${Number.isFinite(tecTECU) ? `TEC = ∫N_e dh = ${tecTECU.toFixed(2)} TECU (80–800 km, trapezoidal)` : 'TEC: requires NmF2 + hmF2'}`,
        '',
        `  └ TEC 1 TECU = 10¹⁶ m⁻²; MUF ≈ foF2 × 3.5 for 2000 km oblique paths`,
        `  └ Full IRI-2016 includes E/F1 layers, topside, storm models`,
      ],
    };
  },
  118: ({ J, E }) => {
    const Q = J * E;
    const sigma = E !== 0 ? J / E : 0;
    return {
      result: Q, unit: 'W/m³',
      secondary: [
        { key: 'conductivity', value: Number.isFinite(sigma) ? sigma : Number.NaN, unit: 'S/m', label: 'Ionospheric Conductivity (J/E)' },
      ],
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
    if (!Number.isFinite(Imean) || !Number.isFinite(Istd)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 's4_class', value: Number.NaN, unit: '—', label: 'S4 Classification' },
          { key: 'mean_intensity', value: Number.isFinite(Imean) ? Imean : Number.NaN, unit: '—', label: 'Mean Intensity ⟨I⟩' },
          { key: 'std_intensity', value: Number.isFinite(Istd) ? Istd : Number.NaN, unit: '—', label: 'Intensity Std Dev σ_I' },
        ],
        steps: [
          '── S4 Scintillation Index (Briggs & Parkin, 1963; Yeh & Liu, 1982) ──',
          'S4 = √(⟨I²⟩ − ⟨I⟩²) / ⟨I⟩ = σ_I / ⟨I⟩',
          '',
          'Mean signal intensity ⟨I⟩ or its standard deviation σ_I is missing (NaN).',
          'No fabricated scintillation index is substituted — supply genuine',
          'signal-intensity statistics for the link/epoch.',
        ],
      };
    }
    const S4 = Imean !== 0 ? Istd / Imean : 0;
    const s4Class = S4 < 0.1 ? 0 : S4 < 0.3 ? 1 : S4 < 0.6 ? 2 : 3;
    const s4Labels = [
      'WEAK — negligible amplitude fading (quiet ionosphere)',
      'MODERATE — occasional fading, typical equatorial post-sunset',
      'STRONG — frequent deep fades, GNSS tracking issues',
      'SEVERE (S4 > 0.6) — cycle slips, loss of lock likely',
    ];
    return {
      result: S4, unit: '—',
      secondary: [
        { key: 's4_class', value: s4Class, unit: '—', label: `S4 Classification: ${s4Labels[s4Class]}` },
        { key: 'mean_intensity', value: Imean, unit: '—', label: 'Mean Intensity ⟨I⟩' },
        { key: 'std_intensity', value: Istd, unit: '—', label: 'Intensity Std Dev σ_I' },
      ],
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
        `  ${s4Labels[s4Class]}`,
        '',
        `  └ L-band (GPS L1=1.575 GHz): S4 > 0.5 causes significant positioning degradation`,
        `  └ Also: σ_φ (phase scintillation) index in radians; strong S4 often correlates with σ_φ > 0.5 rad`,
      ]
    };
  },
  120: ({ Pdyn, Bz }) => {
    // Shue et al. (1997/1998) piecewise magnetopause standoff model
    // J. Geophys. Res., 103(A5), 9469–9478, DOI: 10.1029/97JA03637
    // This is the standard form R_mp = R₀(Pdyn)^(−1/α) with α = 6.6 and
    // R₀ a piecewise-linear function of IMF B_z:
    //   R₀ = 11.4 + 0.14·Bz   for Bz > 0  (northward IMF)
    //   R₀ = 11.4 + 0.013·Bz  for Bz ≤ 0  (southward IMF)
    if (!Number.isFinite(Pdyn) || !Number.isFinite(Bz) || Pdyn <= 0) {
      return {
        result: Number.NaN, unit: 'R_E',
        secondary: [
          { key: 'dynamic_pressure', value: Number.isFinite(Pdyn) ? Pdyn : Number.NaN, unit: 'nPa', label: 'Solar Wind Dynamic Pressure P_dyn' },
          { key: 'bz_polarity', value: Number.isFinite(Bz) ? (Bz > 0 ? 1 : Bz < 0 ? -1 : 0) : Number.NaN, unit: '—', label: 'B_z Polarity (1=northward, 0=zero, −1=southward)' },
          { key: 'magnetopause_type', value: Number.NaN, unit: '—', label: 'Magnetopause State' },
          { key: 'geo_exposure', value: Number.NaN, unit: '—', label: 'GEO Exposure Flag (1=exposed)' },
        ],
        steps: [
          '── Magnetopause Standoff Distance (Shue et al. 1998, J. Geophys. Res. 103, 9469–9478) ──',
          'R_mp = R₀·P_dyn^(−1/6.6),  R₀ = 11.4 + 0.14·Bz (Bz>0) | 11.4 + 0.013·Bz (Bz≤0)',
          '',
          `Dynamic pressure P_dyn = ${Number.isFinite(Pdyn) ? Pdyn : 'NaN'} nPa must be a finite`,
          'positive value (P_dyn ≤ 0 makes the power-law term undefined or infinite),',
          'and IMF B_z must be finite. No fabricated standoff distance is substituted.',
        ],
      };
    }
    const PdynExp = Math.pow(Pdyn, -1 / 6.6);
    const bzCoeff = Bz > 0 ? 0.14 : 0.013;
    const Rmp = (11.4 + bzCoeff * Bz) * PdynExp;
    const Rmp_km = Rmp * 6371;

    // Flaring index α (shape parameter) — same paper equation (3)
    const alpha = (0.58 - 0.0077 * Bz) * Math.pow(Pdyn, -0.074);

    // GEO exposure flag: R_mp < 6.6 R_E means magnetopause inside geosynchronous orbit
    const geoExposure = Rmp < 6.6 ? 1 : 0;

    // Magnetosheath thickness (approximate): bow shock standoff minus magnetopause
    // Using Farris & Russell (1994) for typical M_ms ≈ 6:
    // R_bs ≈ R_mp × [1 + 1.1·M_ms^(−2/3)] ≈ R_mp × 1.38
    const Rbs = Rmp * (1 + 1.1 * Math.pow(6, -2 / 3));
    const sheathThickness = Rbs - Rmp;

    const bzLabel = Bz > 0 ? 'northward' : Bz < 0 ? 'southward' : 'zero';
    const bzPolarity = Bz > 0 ? 1 : Bz < 0 ? -1 : 0;
    const mpType = Rmp < 6.6 ? 0 : Rmp < 8 ? 1 : Rmp < 10 ? 2 : 3;
    const mpLabels = [
      'EXTREME COMPRESSION — inside GEO (6.6 R_E)',
      'STRONG COMPRESSION — near GEO boundary',
      'NOMINAL — average solar wind conditions',
      'EXPANDED — weak solar wind, magnetopause far out',
    ];
    return {
      result: Rmp, unit: 'R_E',
      secondary: [
        { key: 'dynamic_pressure', value: Pdyn, unit: 'nPa', label: 'Solar Wind Dynamic Pressure P_dyn' },
        { key: 'bz_polarity', value: bzPolarity, unit: '—', label: `B_z Polarity (${bzLabel} IMF)` },
        { key: 'magnetopause_type', value: mpType, unit: '—', label: `Magnetopause State: ${mpLabels[mpType]}` },
        { key: 'geo_exposure', value: geoExposure, unit: '—', label: 'GEO Exposure Flag (1=exposed)' },
        { key: 'magnetosheath_thickness', value: sheathThickness, unit: 'R_E', label: 'Magnetosheath Thickness (approx.)' },
      ],
      steps: [
        '── Magnetopause Standoff Distance (Shue et al. 1997, J. Geophys. Res. 103, 9469–9478) ──',
        `Solar wind dynamic pressure P_dyn = ${Pdyn.toFixed(2)} nPa`,
        `IMF B_z (GSM) = ${Bz.toFixed(1)} nT (${bzLabel})`,
        '',
        'Step 1 — Dynamic pressure scaling:',
        `  P_dyn^(−1/6.6) = ${Pdyn.toFixed(2)}^{−1/6.6} = ${PdynExp.toExponential(4)}`,
        '',
        'Step 2 — IMF B_z linear coefficient:',
        `  Bz ${Bz > 0 ? '> 0 → northward branch' : '≤ 0 → southward branch'}`,
        `  r₀ coefficient = 11.4 + ${bzCoeff} × (${Bz.toFixed(1)}) = ${(11.4 + bzCoeff * Bz).toFixed(4)}`,
        '',
        'Step 3 — Subsolar standoff distance:',
        `  R_mp = ${(11.4 + bzCoeff * Bz).toFixed(4)} × ${PdynExp.toExponential(4)}`,
        `  R_mp = ${Rmp.toFixed(2)} R_E (${Rmp_km.toFixed(0)} km)`,
        '',
        'Step 4 — Shape parameter (flaring index):',
        `  α = (0.58 − 0.0077 × Bz) × Pdyn^(−0.074) = ${alpha.toFixed(4)}`,
        `  α > 0 → open magnetotail (tail flares outward)`,
        '',
        'Step 5 — Magnetopause state:',
        `  ${mpLabels[mpType]}`,
        `  ${Bz < -5 ? 'Strong southward B_z — dayside reconnection, erosion reduces R_mp' : Bz > 5 ? 'Strong northward B_z — high-latitude reconnection, slight inflation' : 'Quiet IMF orientation'}`,
        `  GEO exposure: ${geoExposure ? 'YES — magnetopause inside 6.6 R_E' : 'no — satellites within magnetosphere'}`,
        `  Magnetosheath thickness ≈ ${sheathThickness.toFixed(2)} R_E (typical M_ms ≈ 6)`,
        '',
        `  └ Polar cusp latitude: θ_cusp ≈ arccos(√(1/R_mp)) ≈ ${(Math.acos(Math.sqrt(1 / Math.max(Rmp, 1))) * 180 / Math.PI).toFixed(1)}°`,
      ]
    };
  },
  121: ({ Dst, Pdyn, b, c }) => {
    // Dst* = Dst − b·√(P_dyn) + c  (Burton et al. 1975)
    if (!Number.isFinite(Dst) || !Number.isFinite(Pdyn) || !Number.isFinite(b) || !Number.isFinite(c) || Pdyn < 0) {
      return {
        result: Number.NaN, unit: 'nT',
        secondary: [
          { key: 'pressure_correction', value: Number.NaN, unit: 'nT', label: 'Pressure Correction b·√(P_dyn)' },
          { key: 'raw_dst', value: Number.isFinite(Dst) ? Dst : Number.NaN, unit: 'nT', label: 'Raw Dst Index' },
          { key: 'storm_class', value: Number.NaN, unit: '—', label: 'Storm Class' },
        ],
        steps: [
          '── Pressure-Corrected Dst Index (Burton et al. 1975, J. Geophys. Res. 80, 4204–4214) ──',
          'Dst* = Dst − b·√(P_dyn) + c',
          '',
          'One or more inputs are missing/non-finite or P_dyn < 0. No fabricated',
          'Dst correction is substituted — supply genuine Dst, P_dyn, b, and c.',
        ],
      };
    }
    const magPert = b * Math.sqrt(Pdyn);
    const DstStar = Dst - magPert + c;
    // Storm classification (Loewe & Proelss 1997)
    const stormClass = DstStar > -30 ? 0 : DstStar > -50 ? 1 : DstStar > -100 ? 2 : DstStar > -250 ? 3 : DstStar > -500 ? 4 : 5;
    const stormLabels = ['Quiet/Recovery (Dst* > −30 nT)', 'Weak (−30 to −50 nT)', 'Moderate (−50 to −100 nT)', 'Strong (−100 to −250 nT)', 'Severe (−250 to −500 nT)', 'Extreme (Dst* < −500 nT)'];
    // Ring current energy from Dessler-Parker-Sckopke (1959)
    // U_RC = −(4π/μ₀) × B_E × R_E³ × Dst* × 10⁻⁹
    const B_E = 3.12e-5;  // T — equatorial dipole field
    const R_E = 6.371e6;  // m
    const MU0 = 4e-7 * Math.PI;  // H/m
    const U_RC = -(4 * Math.PI / MU0) * B_E * Math.pow(R_E, 3) * DstStar * 1e-9;

    const stormLabel = stormLabels[stormClass];
    return {
      result: DstStar, unit: 'nT',
      secondary: [
        { key: 'pressure_correction', value: magPert, unit: 'nT', label: 'Pressure Correction b·√(P_dyn)' },
        { key: 'raw_dst', value: Dst, unit: 'nT', label: 'Raw Dst Index' },
        { key: 'storm_class', value: stormClass, unit: '—', label: `Storm Class: ${stormLabel}` },
        { key: 'ring_current_energy', value: U_RC, unit: 'J', label: 'Ring Current Energy U_RC (Dessler-Parker-Sckopke)' },
      ],
      steps: [
        '── Pressure-Corrected Dst Index (Burton et al. 1975, J. Geophys. Res. 80, 4204–4214) ──',
        `Raw Dst = ${Dst.toFixed(1)} nT`,
        `Solar wind dynamic pressure P_dyn = ${Pdyn.toFixed(2)} nPa`,
        `Pressure coefficient b = ${b.toFixed(2)} nT/nPa^(1/2), Baseline c = ${c.toFixed(1)} nT`,
        '',
        'Step 1 — Magnetopause (Chapman-Ferraro) current contribution:',
        `  ΔDst_mp = b × √(P_dyn) = ${b.toFixed(2)} × √(${Pdyn.toFixed(2)}) = ${magPert.toFixed(2)} nT`,
        '',
        'Step 2 — Pressure-corrected Dst*:',
        `  Dst* = Dst − b·√(P_dyn) + c`,
        `  Dst* = ${Dst.toFixed(1)} − ${magPert.toFixed(2)} + ${c.toFixed(1)}`,
        `  Dst* = ${DstStar.toFixed(1)} nT`,
        '',
        'Step 3 — Storm classification (Loewe & Prölss 1997):',
        `  ${stormLabel}`,
        '',
        'Step 4 — Ring current energy (Dessler-Parker-Sckopke 1959):',
        `  U_RC = −(4π/μ₀) × B_E × R_E³ × Dst* × 10⁻⁹`,
        `  U_RC = ${U_RC.toExponential(3)} J`,
        '',
        `  └ Dst* isolates ring current injection by removing magnetopause compression effects`,
      ]
    };
  },
  122: ({ eps0, kB, Te, ne }) => {
    // Debye & Hückel (1923) — electron Debye length
    // λ_D = √(ε₀·k_B·T_e / (n_e·e²))
    // Phys. Z., 24, 185–206. (Plasma physics standard, Chen 1984)
    const E_CHARGE = 1.602176634e-19;  // C — elementary charge (CODATA 2018, exact)
    const M_E = 9.1093837015e-31;      // kg — electron mass (CODATA 2018)
    // Vacuum permittivity and Boltzmann constant are physical constants; accept
    // the supplied ε₀ / k_B when finite and positive, else fall back to the
    // CODATA 2018 exact values (never NaN-multiply the numerator to zero).
    const eps0v = Number.isFinite(eps0) && eps0 > 0 ? eps0 : EPS0;
    const kBv = Number.isFinite(kB) && kB > 0 ? kB : K_BOLTZMANN;
    const eps0Used = Number.isFinite(eps0) && eps0 > 0;
    const kBUsed = Number.isFinite(kB) && kB > 0;
    if (!Number.isFinite(Te) || Te <= 0 || !Number.isFinite(ne) || ne <= 0) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'plasma_parameter', value: Number.NaN, unit: '—', label: 'Plasma Parameter N_D (Debye sphere)' },
          { key: 'plasma_frequency', value: Number.NaN, unit: 'rad/s', label: 'Electron Plasma Frequency ω_pe' },
          { key: 'electron_density', value: Number.isFinite(ne) ? ne : Number.NaN, unit: 'm⁻³', label: 'Electron Density n_e' },
        ],
        steps: [
          '── Debye Length (Debye & Hückel 1923; Chen 1984 Intro. to Plasma Physics) ──',
          'λ_D = √(ε₀·k_B·T_e / (n_e·e²))',
          '',
          'Electron temperature T_e (> 0) and electron density n_e (> 0) must be',
          'finite. No fabricated Debye length is substituted — supply genuine',
          'plasma parameters (T_e in K, n_e in m⁻³).',
        ],
      };
    }
    const lambda = Math.sqrt((eps0v * kBv * Te) / (ne * E_CHARGE * E_CHARGE));
    const N_D = ne * (4 / 3) * Math.PI * Math.pow(lambda, 3);
    // Electron plasma frequency: ω_pe = √(n_e·e²/(ε₀·m_e))
    const omega_pe = Math.sqrt((ne * E_CHARGE * E_CHARGE) / (eps0v * M_E));
    const eps0Note = eps0Used ? '' : ' (CODATA 2018 default)';
    const kBNote = kBUsed ? '' : ' (CODATA 2018 default)';

    return {
      result: lambda, unit: 'm',
      secondary: [
        { key: 'plasma_parameter', value: N_D, unit: '—', label: 'Plasma Parameter N_D (Debye sphere)' },
        { key: 'plasma_frequency', value: omega_pe, unit: 'rad/s', label: 'Electron Plasma Frequency ω_pe' },
        { key: 'electron_density', value: ne, unit: 'm⁻³', label: 'Electron Density n_e' },
      ],
      steps: [
        '── Debye Length (Debye & Hückel 1923; Chen 1984 Intro. to Plasma Physics) ──',
        `Vacuum permittivity ε₀ = ${eps0v.toExponential(4)} F/m${eps0Note}`,
        `Boltzmann constant k_B = ${kBv.toExponential(4)} J/K${kBNote}`,
        `Electron temperature T_e = ${Te.toFixed(1)} K (${(Te / 11604.5).toFixed(2)} eV)`,
        `Electron density n_e = ${ne.toExponential(3)} m⁻³`,
        `Elementary charge e = ${E_CHARGE.toExponential(4)} C`,
        '',
        'Step 1 — Compute electron Debye length:',
        `  λ_D = √(ε₀·k_B·T_e / (n_e·e²))`,
        `  λ_D = √(${eps0v.toExponential(4)} × ${kBv.toExponential(4)} × ${Te.toFixed(1)} / (${ne.toExponential(3)} × (${E_CHARGE.toExponential(4)})²))`,
        `  λ_D = ${lambda.toExponential(3)} m (${(lambda * 1000).toFixed(3)} mm)`,
        '',
        'Step 2 — Plasma parameter (particles in Debye sphere):',
        `  N_D = n_e · (4π/3) · λ_D³ = ${ne.toExponential(3)} × ${(4 * Math.PI / 3).toFixed(3)} × (${lambda.toExponential(3)})³`,
        `  N_D = ${N_D.toExponential(3)}`,
        '',
        'Step 3 — Electron plasma (Langmuir) frequency:',
        `  ω_pe = √(n_e·e²/(ε₀·m_e)) = ${omega_pe.toExponential(3)} rad/s`,
        `  f_pe = ω_pe/(2π) = ${(omega_pe / (2 * Math.PI)).toExponential(3)} Hz`,
        '',
        'Step 4 — Plasma state:',
        `  ${N_D > 100 ? 'IDEAL PLASMA (N_D ≫ 1) — collective behaviour dominates' : 'Non-ideal / strongly coupled — kinetic effects important'}`,
        '',
        `  └ Debye shielding: E-field of a test charge decays as exp(−r/λ_D)`,
        `  └ Quasi-neutrality holds for system scale L ≫ λ_D`,
        `  └ PIC simulations require grid spacing Δx < λ_D`,
      ]
    };
  },

  // ── Domain 20: Satellite Dynamics ──
  123: ({ rho, CD, A, m, v }) => {
    // F_D = ½·ρ·C_D·A·v²  (drag force),  a_D = F_D/m  (deceleration)
    // King-Hele (1964); Vallado (2013). ρ ≥ 0, C_D ≥ 0, A ≥ 0, m > 0.
    const valid = Number.isFinite(rho) && Number.isFinite(CD) && Number.isFinite(A)
      && Number.isFinite(m) && Number.isFinite(v)
      && rho >= 0 && CD >= 0 && A >= 0 && m > 0;
    if (!valid) {
      return {
        result: Number.NaN, unit: 'N',
        secondary: [
          { key: 'drag_force', value: Number.NaN, unit: 'N', label: 'Drag Force F_D' },
          { key: 'drag_acceleration', value: Number.NaN, unit: 'm/s²', label: 'Drag Deceleration a_D' },
          { key: 'ballistic_coefficient', value: Number.NaN, unit: 'm²/kg', label: 'Ballistic Coefficient B* = C_D·A/m' },
          { key: 'density', value: Number.isFinite(rho) ? rho : Number.NaN, unit: 'kg/m³', label: 'Atmospheric Density ρ' },
        ],
        steps: [
          '── Atmospheric Drag — Satellite Perturbation (King-Hele, 1964; Vallado, 2013) ──',
          'F_D = ½·ρ·C_D·A·v²,  a_D = F_D/m',
          '',
          'All inputs must be finite with ρ ≥ 0, C_D ≥ 0, A ≥ 0 and mass m > 0.',
          'No fabricated drag is substituted — supply genuine orbital inputs.',
        ],
      };
    }
    const dragAccel = -0.5 * rho * CD * (A / m) * v * v + 0; // +0 normalizes −0 → +0
    const FD = dragAccel * m + 0;
    const Bstar = CD * A / m;
    return {
      result: FD, unit: 'N',
      secondary: [
        { key: 'drag_force', value: FD, unit: 'N', label: 'Drag Force F_D' },
        { key: 'drag_acceleration', value: dragAccel, unit: 'm/s²', label: 'Drag Deceleration a_D' },
        { key: 'ballistic_coefficient', value: Bstar, unit: 'm²/kg', label: 'Ballistic Coefficient B* = C_D·A/m' },
        { key: 'density', value: rho, unit: 'kg/m³', label: 'Atmospheric Density ρ' },
      ],
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
        `  └ Ballistic coefficient: B* = C_D·A/m = ${Bstar.toExponential(4)} m²/kg`,
        `  └ Semi-major axis decay: da/dt ≈ −ρ·B*·v·a (integrated over orbit)`,
      ]
    };
  },
  124: ({ rho, CD, A, v, m }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const rhoN = Number(rho), CDN = Number(CD), AN = Number(A), vN = Number(v), mN = Number(m);
    const GM_E = 3.986004418e14; // m³/s² — Earth gravitational parameter
    const a = (vN > 0) ? GM_E / (vN * vN) : 6371000 + 400000; // semi-major axis from circular orbit: v² = GM/a
    const Bstar = CDN * AN / (mN || 1); // ballistic coefficient m²/kg
    const da = -(rhoN * Bstar * vN * a); // King-Hele (1987): da/dt = −B*·ρ·v·a (m/s)
    if (![rhoN, CDN, AN, vN, mN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm/s',
        steps: ['── Semi-Major Axis Decay Rate (King-Hele 1987; Vallado 2013) ──',
          'da/dt = −B*·ρ·v·a',
          '', 'One or more inputs are missing — no fabricated decay is substituted.'],
      };
    }
    return {
      result: da, unit: 'm/s',
      secondary: [
        { key: 'ballistic_coefficient', value: Number.isFinite(Bstar) ? Bstar : Number.NaN, unit: 'm²/kg', label: 'Ballistic Coefficient B*' },
        { key: 'decay_per_day', value: Number.isFinite(da) ? Math.abs(da * 86400) : Number.NaN, unit: 'm/day', label: 'Altitude Decay per Day' },
        { key: 'semi_major_axis', value: Number.isFinite(a) ? a : Number.NaN, unit: 'm', label: 'Semi-major Axis' },
      ],
      // Timeseries series (tool vizType 'timeseries'): orbital altitude
      // h(t) = a − R⊕ + (da/dt)·t over 0–365 days (20 points) from the tool's
      // own King-Hele decay rate da/dt = −B*·ρ·v·a (converted to m/day).
      series: [{
        label: 'Orbital altitude h(t) = h₀ + (da/dt)·t',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const t = i * (365 / 19);
          const h = (a - 6371000) + da * 86400 * t;
          return { x: t, y: Number.isFinite(h) ? h : Number.NaN };
        }),
      }],
      steps: [
        '── Semi-Major Axis Decay Rate (King-Hele 1987; Vallado 2013) ──',
        `Atmospheric density ρ = ${rhoN.toExponential(3)} kg/m³`,
        `Drag coefficient C_D = ${CDN.toFixed(2)}, Area A = ${AN.toFixed(2)} m²`,
        `Mass m = ${mN.toFixed(1)} kg, Velocity v = ${vN.toFixed(0)} m/s`,
        `Semi-major axis a = ${(a/1000).toFixed(1)} km (alt ${((a - 6371000)/1000).toFixed(0)} km, circular orbit)`,
        '',
        'Step 1 — Ballistic coefficient:',
        `  B* = C_D·A/m = ${CDN.toFixed(2)} × ${AN.toFixed(2)} / ${mN.toFixed(1)} = ${Bstar.toExponential(4)} m²/kg`,
        '',
        'Step 2 — Semi-major axis decay rate (King-Hele 1987):',
        `  da/dt = −B*·ρ·v·a`,
        `  da/dt = −${Bstar.toExponential(4)} × ${rhoN.toExponential(3)} × ${vN.toFixed(0)} × ${a.toExponential(4)}`,
        `  da/dt = ${da.toExponential(4)} m/s`,
        '',
        'Step 3 — Daily / monthly decay:',
        `  Δh/day = ${Math.abs(da * 86400).toFixed(1)} m/day`,
        `  Δh/month = ${Math.abs(da * 86400 * 30 / 1000).toFixed(2)} km/month`,
        '',
        'Step 4 — Decay significance:',
        `  ${Math.abs(da) > 0.01 ? 'RAPID — orbit decaying by km/month (low altitude < 400 km)' : Math.abs(da) > 0.001 ? 'MODERATE — ~100 m/day, orbit maintenance needed' : Math.abs(da) > 0.0001 ? 'GRADUAL — ~10 m/day, typical for 500–700 km' : 'WEAK — < 1 m/day, above 800 km drag is negligible'}`,
      ]
    };
  },
  125: ({ A1, A2, sigmax, sigmay, d }) => {
    // Foster (1992) short-term conjunction probability:
    //   A_c = π·(R₁+R₂)²  (hard-body collision cross-section overlap of the two
    //   circular footprints Rᵢ = √(Aᵢ/π)), and the relative-position error is a
    //   bivariate Gaussian with the two objects' uncertainties combined:
    //   P_c = A_c / (2π·σ_x·σ_y) × exp(−d² / (2·(σ_x² + σ_y²)))   for d < 3σ_eff,
    //   P_c = 0                                                   otherwise.
    //   σ_eff = √(σ_x² + σ_y²) is the combined along-miss 1σ uncertainty.
    if (!Number.isFinite(A1) || !Number.isFinite(A2) || !Number.isFinite(sigmax)
        || !Number.isFinite(sigmay) || !Number.isFinite(d)
        || A1 <= 0 || A2 <= 0 || sigmax <= 0 || sigmay <= 0 || d < 0) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'miss_distance', value: Number.isFinite(d) ? d : Number.NaN, unit: 'm', label: 'Miss Distance d' },
          { key: 'covariance_ellipse_area', value: Number.isFinite(sigmax) && Number.isFinite(sigmay) && sigmax > 0 && sigmay > 0 ? Math.PI * sigmax * sigmay : Number.NaN, unit: 'm²', label: 'Covariance Ellipse Area π·σ_x·σ_y' },
          { key: 'effective_sigma', value: Number.isFinite(sigmax) && Number.isFinite(sigmay) && sigmax > 0 && sigmay > 0 ? Math.sqrt(sigmax * sigmax + sigmay * sigmay) : Number.NaN, unit: 'm', label: 'Combined 1σ √(σ_x²+σ_y²)' },
          { key: 'collision_cross_section', value: Number.NaN, unit: 'm²', label: 'Collision Cross-Section A_c' },
        ],
        steps: [
          '── Collision Probability (Foster 1992) ──',
          'P_c = A_c/(2π·σ_x·σ_y) · exp(−d²/(2·(σ_x²+σ_y²)))   [d < 3σ_eff], else 0',
          '',
          'All inputs must be finite with areas A₁,A₂ > 0, uncertainties σ_x,σ_y > 0',
          'and miss distance d ≥ 0. No fabricated collision probability is',
          'substituted — supply genuine conjunction data.',
        ],
      };
    }
    const R1 = Math.sqrt(A1 / Math.PI);
    const R2 = Math.sqrt(A2 / Math.PI);
    const Ac = Math.PI * (R1 + R2) ** 2; // collision cross-section area (overlap integral)
    const sigmaEff = Math.sqrt(sigmax * sigmax + sigmay * sigmay); // combined 1σ
    const sigmaEff2 = sigmaEff * sigmaEff;                          // combined variance
    const normConst = Ac / (2 * Math.PI * sigmax * sigmay);
    const expArg = -(d * d) / (2 * sigmaEff2);
    const inGate = d < 3 * sigmaEff;
    const Pc = inGate ? normConst * Math.exp(expArg) : 0;
    return {
      result: Pc, unit: '—',
      secondary: [
        { key: 'miss_distance', value: d, unit: 'm', label: 'Miss Distance d' },
        { key: 'covariance_ellipse_area', value: Math.PI * sigmax * sigmay, unit: 'm²', label: 'Covariance Ellipse Area π·σ_x·σ_y' },
        { key: 'effective_sigma', value: sigmaEff, unit: 'm', label: 'Combined 1σ √(σ_x²+σ_y²)' },
        { key: 'collision_cross_section', value: Ac, unit: 'm²', label: 'Collision Cross-Section A_c = π(R₁+R₂)²' },
      ],
      steps: [
        '── Collision Probability (Foster 1992) ──',
        `Covariance: σ_x = ${sigmax.toFixed(3)} m, σ_y = ${sigmay.toFixed(3)} m`,
        `Object areas: A₁ = ${A1.toFixed(2)} m², A₂ = ${A2.toFixed(2)} m²`,
        `Miss distance d = ${d.toFixed(2)} m`,
        '',
        'Step 1 — Hard-body radii and collision cross-section (overlap integral):',
        `  R₁ = √(A₁/π) = ${R1.toFixed(3)} m`,
        `  R₂ = √(A₂/π) = ${R2.toFixed(3)} m`,
        `  A_c = π·(R₁+R₂)² = ${Ac.toFixed(2)} m²`,
        '',
        'Step 2 — Combined positional uncertainty:',
        `  σ_eff = √(σ_x² + σ_y²) = √(${sigmax.toFixed(3)}² + ${sigmay.toFixed(3)}²) = ${sigmaEff.toFixed(3)} m`,
        `  3σ gate: d = ${d.toFixed(2)} m ${inGate ? `< 3σ_eff = ${(3 * sigmaEff).toFixed(2)} m → within gate` : `≥ 3σ_eff = ${(3 * sigmaEff).toFixed(2)} m → P_c = 0`}`,
        '',
        'Step 3 — Collision probability (Foster 1992):',
        `  P_c = A_c / (2π·σ_x·σ_y) × exp(−d²/(2·σ_eff²))`,
        `  P_c = ${Ac.toFixed(2)} / (2π × ${sigmax.toFixed(3)} × ${sigmay.toFixed(3)}) × exp(−${(d*d).toFixed(1)} / ${(2*sigmaEff2).toFixed(1)})`,
        `  P_c = ${normConst.toExponential(4)} × exp(${expArg.toFixed(3)})`,
        `  P_c = ${inGate ? Pc.toExponential(4) : '0 (miss distance ≥ 3σ_eff)'}`,
        '',
        `  └ Threshold: ${Pc > 1e-4 ? 'HIGH RISK — avoidance maneuver recommended (> 1/10,000)' : Pc > 1e-5 ? 'MODERATE RISK — monitor closely' : 'LOW RISK — routine monitoring'}`,
        `  └ Assumes: linear relative motion, Gaussian errors, short conjunction window`,
      ]
    };
  },
  126: ({ rho2, sigma, v, N, L, beta, gamma }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const rho2N = Number(rho2), sigmaN = Number(sigma), vN = Number(v), LN = Number(L), betaN = Number(beta), gammaN = Number(gamma);
    // Kessler (1991) equation for spatial density ρ:
    // dρ/dt = ½·ρ²·σ·v + L − β·ρ³ − γ·ρ
    // v input is km/s; convert to km/yr for consistent km⁻³/yr output.
    const SEC_PER_YEAR = 365.25 * 24 * 3600; // 3.156e7 s/yr
    const v_yr = vN * SEC_PER_YEAR; // km/yr
    const fragTerm = 0.5 * rho2N * rho2N * sigmaN * v_yr;  // ½ρ²σv (km⁻³/yr)
    const lossCubic = betaN * rho2N * rho2N * rho2N;         // βρ³ (km⁻³/yr)
    const lossLinear = gammaN * rho2N;                      // γρ (km⁻³/yr)
    const drho = fragTerm + LN - lossCubic - lossLinear;
    if (![rho2N, sigmaN, vN, LN, betaN, gammaN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'km⁻³/yr',
        steps: ['── Kessler Syndrome Debris Evolution (Kessler & Cour-Palais 1978; Kessler 1991) ──',
          'dρ/dt = ½ρ²σv + L − βρ³ − γρ',
          '', 'One or more inputs are missing — no fabricated debris evolution is substituted.'],
      };
    }
    return {
      result: drho, unit: 'km⁻³/yr',
      secondary: [
        { key: 'fragmentation_source', value: Number.isFinite(fragTerm) ? fragTerm : Number.NaN, unit: 'km⁻³/yr', label: 'Fragmentation Source ½ρ²σv' },
        { key: 'collisional_loss', value: Number.isFinite(lossCubic) ? lossCubic : Number.NaN, unit: 'km⁻³/yr', label: 'Collisional Loss βρ³' },
        { key: 'drag_loss', value: Number.isFinite(lossLinear) ? lossLinear : Number.NaN, unit: 'km⁻³/yr', label: 'Drag Decay γρ' },
      ],
      // Timeseries series (tool vizType 'timeseries'): debris count N(t) over
      // 0–100 yr (20 points). The count scales with the spatial density from
      // the tool's own cascade rate dρ/dt: N(t) = N·(1 + (dρ/dt)/ρ·t).
      series: [{
        label: 'Debris count N(t) = N·(1 + (dρ/dt)/ρ·t)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const t = i * (100 / 19);
          const NN = Number(N);
          const drhoRatio = Number.isFinite(drho) && rho2N !== 0 ? drho / rho2N : Number.NaN;
          const Nt = Number.isFinite(NN) && Number.isFinite(drhoRatio) ? NN * (1 + drhoRatio * t) : Number.NaN;
          return { x: t, y: Number.isFinite(Nt) ? Nt : Number.NaN };
        }),
      }],
      steps: [
        '── Kessler Syndrome Debris Evolution (Kessler & Cour-Palais 1978; Kessler 1991) ──',
        `Spatial density ρ = ${rho2N.toExponential(3)} km⁻³`,
        `Collision cross-section σ = ${sigmaN.toExponential(3)} km², Relative velocity v = ${vN.toFixed(1)} km/s`,
        `Launch rate L = ${LN.toExponential(2)} km⁻³/yr`,
        `Collisional loss β = ${betaN.toExponential(3)}, Drag decay γ = ${gammaN.toExponential(3)} /yr`,
        '',
        'Step 1 — Fragmentation source (Kessler 1991):',
        `  S_coll = ½·ρ²·σ·v`,
        `  = ½ × (${rho2N.toExponential(3)})² × ${sigmaN.toExponential(3)} × ${vN.toFixed(1)}`,
        `  = ${fragTerm.toExponential(3)} km⁻³/yr`,
        '',
        'Step 2 — Loss terms:',
        `  Collisional (cubic): β·ρ³ = ${betaN.toExponential(3)} × (${rho2N.toExponential(3)})³ = ${lossCubic.toExponential(3)} km⁻³/yr`,
        `  Atmospheric drag (linear): γ·ρ = ${gammaN.toExponential(3)} × ${rho2N.toExponential(3)} = ${lossLinear.toExponential(3)} km⁻³/yr`,
        '',
        'Step 3 — Net rate of change:',
        `  dρ/dt = ${fragTerm.toExponential(3)} + ${LN.toExponential(2)} − ${lossCubic.toExponential(3)} − ${lossLinear.toExponential(3)}`,
        `  dρ/dt = ${drho.toExponential(3)} km⁻³/yr`,
        '',
        'Step 4 — Kessler Syndrome assessment:',
        `  ${drho > 0 ? 'POSITIVE GROWTH — debris density increasing (collisional cascading potential)' : drho < 0 ? 'NEGATIVE GROWTH — debris decreasing (decay > production)' : 'STEADY STATE — production balanced by removal'}`,
        '',
        `  └ Critical density: ρ_crit ≈ √(2γ/(σ·v)) — above this, cascading is self-sustaining`,
        Number(N) > 0 ? `  └ Population context: N = ${Number(N).toExponential(1)} objects in the orbital shell` : '',
      ].filter(Boolean)
    };
  },
  127: ({ n, x, y, z, xdot, ydot, zdot, ax, ay, az, t }) => {
    // Hill-Clohessy-Wiltshire (1960) equations (x radial, y along-track,
    // z cross-track in a circular-reference-orbit LVLH frame):
    //   ẍ = 2n·ẏ + 3n²·x + a_x
    //   ÿ = −2n·ẋ + a_y
    //   z̈ = −n²·z + a_z
    // The homogeneous closed-form solution (standard STM, e.g. Vallado 2013,
    // Ch. 8; Clohessy & Wiltshire 1960) gives the relative state at time t:
    //   τ = n·t
    //   x(t) = (4−3cosτ)·x₀ + (ẋ₀/n)·sinτ + (2ẏ₀/n)·(1−cosτ)
    //   y(t) = y₀ + 6(sinτ−τ)·x₀ + (4sinτ−3τ)·(ẏ₀/n) − (2ẋ₀/n)·(1−cosτ)
    //   z(t) = z₀·cosτ + (ż₀/n)·sinτ
    //   ẋ(t) = 3n·sinτ·x₀ + cosτ·ẋ₀ + 2·sinτ·ẏ₀
    //   ẏ(t) = 6n(cosτ−1)·x₀ − 2·sinτ·ẋ₀ + (4cosτ−3)·ẏ₀
    //   ż(t) = −n·sinτ·z₀ + cosτ·ż₀
    // Secular along-track drift rate: ẏ_drift = −6n·x₀ − 3ẏ₀ (vanishes for
    // the bounded-orbit initial condition ẏ₀ = −2n·x₀).
    const stateFinite = [n, x, y, z, xdot, ydot, zdot].every(Number.isFinite);
    if (!stateFinite || !(Number.isFinite(n) && n > 0)) {
      return {
        result: Number.NaN, unit: 'm/s²',
        secondary: [
          { key: 'orbit_period', value: Number.isFinite(n) && n > 0 ? (2 * Math.PI) / n : Number.NaN, unit: 's', label: 'Orbit Period T = 2π/n' },
          { key: 'relative_position', value: Number.NaN, unit: 'm', label: 'Relative Position |r(t)|' },
          { key: 'relative_velocity', value: Number.NaN, unit: 'm/s', label: 'Relative Velocity |v(t)|' },
          { key: 'alongtrack_drift_rate', value: Number.NaN, unit: 'm/s', label: 'Secular Along-Track Drift Rate' },
        ],
        steps: [
          '── Hill-Clohessy-Wiltshire Equations (Clohessy & Wiltshire 1960; Hill 1878) ──',
          'Relative state (x, y, z, ẋ, ẏ, ż) must be finite and mean motion',
          'n > 0. No fabricated relative motion is substituted — supply a',
          'genuine reference orbit and initial relative state.',
        ],
      };
    }
    const axv = Number.isFinite(ax) ? ax : 0;
    const ayv = Number.isFinite(ay) ? ay : 0;
    const azv = Number.isFinite(az) ? az : 0;
    const xddot = 2 * n * ydot + 3 * n * n * x + axv;
    const yddot = -2 * n * xdot + ayv;
    const zddot = -n * n * z + azv;
    const accelMag = Math.hypot(xddot, yddot, zddot);
    // Secular along-track drift rate (closed-form coefficient of the secular term)
    const yDrift = -6 * n * x - 3 * ydot;

    // Closed-form HCW state transition (homogeneous solution, thrust-free)
    const orbitPeriod = (2 * Math.PI) / n;
    const tFinal = (Number.isFinite(t) && t >= 0) ? t : orbitPeriod;
    const hcwState = (tSec: number) => {
      const tau = n * tSec;
      const cT = Math.cos(tau), sT = Math.sin(tau);
      const px = (4 - 3 * cT) * x + (xdot / n) * sT + (2 * ydot / n) * (1 - cT);
      const py = y + 6 * (sT - tau) * x + (4 * sT - 3 * tau) * (ydot / n) - (2 * xdot / n) * (1 - cT);
      const pz = z * cT + (zdot / n) * sT;
      const vx = 3 * n * sT * x + cT * xdot + 2 * sT * ydot;
      const vy = 6 * n * (cT - 1) * x - 2 * sT * xdot + (4 * cT - 3) * ydot;
      const vz = -n * sT * z + cT * zdot;
      return { px, py, pz, vx, vy, vz };
    };
    const final = hcwState(tFinal);
    const finalPos = Math.hypot(final.px, final.py, final.pz);
    const finalVel = Math.hypot(final.vx, final.vy, final.vz);

    // Relative trajectory over one full orbital period (timeseries series)
    const N_PTS = 96;
    const seriesX: Array<{ x: number; y: number }> = [];
    const seriesY: Array<{ x: number; y: number }> = [];
    const seriesZ: Array<{ x: number; y: number }> = [];
    const seriesR: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= N_PTS; i++) {
      const ts = (i / N_PTS) * orbitPeriod;
      const s = hcwState(ts);
      seriesX.push({ x: ts, y: s.px });
      seriesY.push({ x: ts, y: s.py });
      seriesZ.push({ x: ts, y: s.pz });
      seriesR.push({ x: ts, y: Math.hypot(s.px, s.py, s.pz) });
    }
    const boundedNote = Math.abs(yDrift) < 1e-6 ? 'YES — bounded (no secular drift)' : 'NO — secular along-track drift present';

    return {
      result: accelMag, unit: 'm/s²',
      secondary: [
        { key: 'orbit_period', value: orbitPeriod, unit: 's', label: 'Orbit Period T = 2π/n' },
        { key: 'relative_position', value: finalPos, unit: 'm', label: `Relative Position |r(t)| at t=${Number.isFinite(t) && t >= 0 ? t.toFixed(1) : 'T'}` },
        { key: 'relative_velocity', value: finalVel, unit: 'm/s', label: `Relative Velocity |v(t)| at t=${Number.isFinite(t) && t >= 0 ? t.toFixed(1) : 'T'}` },
        { key: 'radial_final', value: final.px, unit: 'm', label: 'Final Radial x(t)' },
        { key: 'alongtrack_final', value: final.py, unit: 'm', label: 'Final Along-Track y(t)' },
        { key: 'crosstrack_final', value: final.pz, unit: 'm', label: 'Final Cross-Track z(t)' },
        { key: 'alongtrack_drift_rate', value: yDrift, unit: 'm/s', label: 'Secular Along-Track Drift Rate (bounded orbit?)' },
      ],
      series: [
        { label: 'Radial x(t)', color: '#0072B2', points: seriesX },
        { label: 'Along-track y(t)', color: '#D55E00', points: seriesY },
        { label: 'Cross-track z(t)', color: '#009E73', points: seriesZ },
        { label: 'Range |r(t)|', color: '#CC79A7', points: seriesR },
      ],
      steps: [
        '── Hill-Clohessy-Wiltshire Equations (Clohessy & Wiltshire 1960; Hill 1878) ──',
        `Mean motion n = ${n.toExponential(4)} rad/s, Orbit period T = ${orbitPeriod.toFixed(1)} s`,
        `Relative state: x=${x.toFixed(4)} m, y=${y.toFixed(4)} m, z=${z.toFixed(4)} m`,
        `Relative velocity: ẋ=${xdot.toExponential(3)} m/s, ẏ=${ydot.toExponential(3)} m/s, ż=${zdot.toExponential(3)} m/s`,
        `Thrust: a_x=${axv.toExponential(3)}, a_y=${ayv.toExponential(3)}, a_z=${azv.toExponential(3)} m/s²`,
        '',
        'Step 1 — Radial acceleration (HCW x-equation):',
        `  ẍ = 2n·ẏ + 3n²·x + a_x`,
        `  ẍ = 2×${n.toExponential(4)}×${ydot.toExponential(3)} + 3×(${n.toExponential(4)})²×${x.toFixed(4)} + ${axv.toExponential(3)}`,
        `  ẍ = ${xddot.toExponential(4)} m/s²`,
        '',
        'Step 2 — Along-track acceleration (HCW y-equation):',
        `  ÿ = −2n·ẋ + a_y`,
        `  ÿ = −2×${n.toExponential(4)}×${xdot.toExponential(3)} + ${ayv.toExponential(3)}`,
        `  ÿ = ${yddot.toExponential(4)} m/s²`,
        '',
        'Step 3 — Cross-track acceleration (HCW z-equation):',
        `  z̈ = −n²·z + a_z`,
        `  z̈ = −(${n.toExponential(4)})²×${z.toFixed(4)} + ${azv.toExponential(3)}`,
        `  z̈ = ${zddot.toExponential(4)} m/s²`,
        '',
        'Step 4 — Total relative acceleration:',
        `  |a| = √(ẍ² + ÿ² + z̈²) = ${accelMag.toExponential(4)} m/s²`,
        '',
        'Step 5 — Closed-form state propagation (HCW STM, homogeneous):',
        `  τ = n·t, t = ${tFinal.toFixed(1)} s (τ = ${(n * tFinal).toFixed(3)} rad)`,
        `  x(t) = (4−3cosτ)x₀ + (ẋ₀/n)sinτ + (2ẏ₀/n)(1−cosτ) = ${final.px.toFixed(3)} m`,
        `  y(t) = y₀ + 6(sinτ−τ)x₀ + (4sinτ−3τ)(ẏ₀/n) − (2ẋ₀/n)(1−cosτ) = ${final.py.toFixed(3)} m`,
        `  z(t) = z₀cosτ + (ż₀/n)sinτ = ${final.pz.toFixed(3)} m`,
        `  |r(t)| = ${finalPos.toFixed(3)} m, |v(t)| = ${finalVel.toExponential(4)} m/s`,
        '',
        `  └ Secular along-track drift: ẏ_drift = −6n·x₀ − 3ẏ₀ = ${yDrift.toExponential(4)} m/s`,
        `  └ Bounded orbit (${boundedNote}): ẏ₀ = −2n·x₀ (x₀ = −ẏ₀/(2n)) eliminates secular drift`,
        '  └ HCW valid for |relative position| ≪ orbit radius (typically < 10 km)',
      ]
    };
  },

  // ── Domain 21: Solar-Terrestrial & GNSS ──
  128: ({ kp, Ki }) => {
    // Bartels (1949) Kp index: weighted average of standardized K-indices
    // from 13 subauroral magnetometer stations.
    // Primary: real observed Kp from NOAA SWPC (noaa-planetary-k-index-forecast.json).
    // Fallback: if explicit Ki values are provided (user-supplied station data),
    // compute the weighted average with the correct Bartels station weights.
    let Kp: number;
    let dataSource: string;
    if (kp != null && Number.isFinite(kp)) {
      // Real observed Kp from NOAA SWPC (already on the 1/3-point scale).
      // Clamp to the physical scale [0, 9] so the Kp→G mapping stays bounded.
      Kp = Math.min(9, Math.max(0, kp));
      dataSource = 'NOAA SWPC (real observed planetary Kp)';
    } else if (Array.isArray(Ki) && Ki.length > 0 && Ki.some((k: number) => k > 0)) {
      // User-supplied station K-indices (array): weighted average per Bartels (1949)
      // Station weights for the 13 Kp observatories (Bartels 1949, IAGA Bull. 12):
      // LER=1, Sitka=1, ESK=1, HAD=1, FRD=1, TUC=1, TEO=1, WNG=1, NGK=1, TBS=1, SRL=1, SJG=1, HER=1
      // Modern operational implementation: equal weights (total = 13)
      const n = Ki.length;
      const sumK = Ki.reduce((s: number, k: number) => s + k, 0);
      Kp = Math.min(9, Math.max(0, sumK / n));
      dataSource = `${n} user-supplied station K-indices (weighted average)`;
    } else if (Ki != null && Number.isFinite(Ki) && Ki > 0) {
      // Single Ki scalar value (from normalizeInputs mapping)
      Kp = Math.min(9, Math.max(0, Ki));
      dataSource = 'User-supplied K-index (single station)';
    } else {
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Kp Geomagnetic Activity Index (Bartels 1949; GFZ Potsdam / NOAA SWPC) ──',
          '',
          'No genuine geomagnetic activity data provided. Kp requires either:',
          '  (a) NOAA SWPC real-time planetary Kp (kp input), or',
          '  (b) Array of 13-station K-indices (Ki), or',
          '  (c) A single station K-index (Ki scalar).',
          '',
          'No fabricated Kp value is substituted. Supply genuine activity data.',
          'NOAA SWPC: swpc.noaa.gov for real-time Kp.',
        ],
        secondary: [
          { key: 'noaa_g_scale', value: Number.NaN, label: 'NOAA Storm Scale (no data)' },
          { key: 'auroral_oval_latitude', value: Number.NaN, unit: '°', label: 'Auroral Oval Equatorward Boundary' },
          { key: 'ap_index', value: Number.NaN, unit: 'nT', label: 'Linear Equivalent Amplitude (Ap)' },
        ],
      };
    }

    // NOAA G-scale mapping (NOAA SWPC operational scale)
    const gScale = Kp >= 9 ? 5 : Kp >= 8 ? 4 : Kp >= 7 ? 3 : Kp >= 6 ? 2 : Kp >= 5 ? 1 : 0;
    const stormName = [
      'No storm', 'Minor (G1)', 'Moderate (G2)', 'Strong (G3)', 'Severe (G4)', 'Extreme (G5)',
    ][gScale];

    // Auroral oval equatorward boundary (empirical fit from Feldstein 1963 / Holzworth & Meng 1975)
    const auroralLat = Kp <= 1 ? 67 : Kp <= 3 ? 67 - (Kp - 1) * 2 : Kp <= 5 ? 63 - (Kp - 3) * 1.5 : Kp <= 7 ? 60 - (Kp - 5) * 2.5 : 55 - (Kp - 7) * 5;

    // Ap index — linear equivalent amplitude (Bartels 1949, IAGA table)
    // Kp is on a quasi-log scale; Ap converts to linear nT equivalent.
    // Kp→a table from IAGA Bull. 12 / Wikipedia K-index article:
    const KP_TO_A: Record<number, number> = {
      0: 0, 0.33: 2, 0.67: 3, 1: 4, 1.33: 5, 1.67: 6, 2: 7, 2.33: 9, 2.67: 12,
      3: 15, 3.33: 18, 3.67: 22, 4: 27, 4.33: 32, 4.67: 39, 5: 48,
      5.33: 56, 5.67: 67, 6: 80, 6.33: 94, 6.67: 111, 7: 132,
      7.33: 154, 7.67: 179, 8: 207, 8.33: 236, 8.67: 267, 9: 300, 9.33: 360, 9.67: 400,
    };
    // Round to nearest 1/3-point Kp step, then look up Ap
    const kpStep = Math.round(Kp * 3) / 3;  // nearest 1/3 step
    const kpKey = Math.round(kpStep * 100) / 100;  // 2-decimal key for table lookup
    const ap = KP_TO_A[kpKey] ?? Math.round(15.8 * Math.pow(10, Kp / 9));

    return {
      result: Kp, unit: '—',
      steps: [
        '── Kp Geomagnetic Activity Index (Bartels 1949; GFZ Potsdam / NOAA SWPC) ──',
        `Data source: ${dataSource}`,
        '',
        'Step 1 — Kp index (planetary 3-hour range index):',
        `  Kp = ${Kp.toFixed(2)} (scale 0–9, resolution 1/3)`,
        '',
        'Step 2 — NOAA Geomagnetic Storm Scale (G-scale):',
        `  G${gScale} — ${stormName}`,
        `  Kp ≥ 5 → G1, ≥ 6 → G2, ≥ 7 → G3, ≥ 8 → G4, ≥ 9 → G5`,
        '',
        'Step 3 — Auroral oval equatorward boundary (Feldstein/Holzworth-Meng):',
        `  φ_auroral ≈ ${auroralLat.toFixed(1)}° magnetic latitude`,
        `  (Kp=1: ~67°, Kp=5: ~60°, Kp=9: ~45°)`,
        '',
        'Step 4 — Linear equivalent amplitude (Ap index):',
        `  Ap ≈ ${ap.toFixed(1)} nT  (Kp→a conversion per IAGA table)`,
        '',
        'Step 5 — Bartels (1949) methodology (13-station weighted average):',
        '  Kp = Σ(w_i · K*_i) / Σ(w_i)',
        '  where K*_i = standardized 28-point K values from 13 subauroral',
        '  magnetometer stations, w_i = station reliability weights.',
        '  Real Kp computed by GFZ Potsdam using this exact method.',
      ],
      secondary: [
        { key: 'noaa_g_scale', value: gScale, label: `NOAA Storm Scale: G${gScale} (${stormName})` },
        { key: 'auroral_oval_latitude', value: auroralLat, unit: '°', label: 'Auroral Oval Equatorward Boundary' },
        { key: 'ap_index', value: ap, unit: 'nT', label: 'Linear Equivalent Amplitude (Ap)' },
      ],
    };
  },
  129: ({ traceH, Q11, Q22, Q33, Q44 }) => {
    // Wells et al. (1987) / Van Diggelen (2007) DOP computation.
    // Q = (H^T·H)^{-1} is the 4×4 covariance matrix in ENU+clock space.
    // If individual Q diagonal elements are provided, compute exact DOP.
    // If only traceH is provided, GDOP = √(traceH) is exact, but
    // PDOP/HDOP/VDOP/TDOP are derived from a typical mid-latitude geometry.
    const qDiag = (v: unknown): number => {
      const n = Number(v);
      return (v != null && Number.isFinite(n)) ? n : Number.NaN;
    };
    let q11: number, q22: number, q33: number, q44: number;
    let exact = false;
    const traceNum = Number(traceH);
    const hasTrace = traceH != null && traceNum > 0 && Number.isFinite(traceNum);
    const q11n = qDiag(Q11), q22n = qDiag(Q22), q33n = qDiag(Q33), q44n = qDiag(Q44);
    const hasAllQ = Number.isFinite(q11n) && Number.isFinite(q22n)
      && Number.isFinite(q33n) && Number.isFinite(q44n);

    if (hasAllQ) {
      q11 = q11n; q22 = q22n; q33 = q33n; q44 = q44n;
      exact = true;
    } else if (hasTrace) {
      // Fallback: distribute traceH across typical geometry ratios.
      // For a well-distributed constellation: Q_11≈Q_22 (horizontal),
      // Q_33 > Q_11 (vertical worse), Q_44 ≈ Q_11 (clock).
      // Typical ratios for GPS-only, 8 satellites, mid-latitude:
      //   Q_11:Q_22:Q_33:Q_44 ≈ 0.18:0.18:0.36:0.28 of total trace.
      // Note: only GDOP = √(traceH) is exact from the trace alone; the
      // component split is a stated modelling assumption, and every derived
      // DOP preserves the exact GDOP (0.18+0.18+0.36+0.28 = 1).
      const t = traceNum;
      q11 = t * 0.18; q22 = t * 0.18; q33 = t * 0.36; q44 = t * 0.28;
    } else {
      // No geometry information at all — honest NaN, never a fabricated GDOP.
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Geometric Dilution of Precision (Wells et al. 1987; Van Diggelen 2007) ──',
          '',
          'No satellite geometry provided. GDOP requires either:',
          '  (a) Q = (H^T·H)^{-1} diagonal elements (Q11, Q22, Q33, Q44), or',
          '  (b) The trace of Q (traceH) for an exact GDOP = √(traceH).',
          '',
          'No fabricated geometry is substituted. Supply the actual',
          'satellite-receiver geometry matrix or its covariance diagonal.',
        ],
        secondary: [
          { key: 'pdop', value: Number.NaN, label: 'PDOP (Position DOP)' },
          { key: 'hdop', value: Number.NaN, label: 'HDOP (Horizontal DOP)' },
          { key: 'vdop', value: Number.NaN, label: 'VDOP (Vertical DOP)' },
          { key: 'tdop', value: Number.NaN, label: 'TDOP (Time DOP)' },
        ],
      };
    }

    const GDOP = Math.sqrt(q11 + q22 + q33 + q44);
    const PDOP = Math.sqrt(q11 + q22 + q33);
    const HDOP = Math.sqrt(q11 + q22);
    const VDOP = Math.sqrt(q33);
    const TDOP = Math.sqrt(q44);

    return {
      result: GDOP, unit: '—',
      steps: [
        '── Geometric Dilution of Precision (Wells et al. 1987; Van Diggelen 2007) ──',
        `Data: ${exact ? 'Q matrix diagonal (exact)' : 'trace only (PDOP/HDOP/VDOP approximate)'}`,
        `Q = (H^T·H)^{-1} diagonal: [${q11.toFixed(4)}, ${q22.toFixed(4)}, ${q33.toFixed(4)}, ${q44.toFixed(4)}]`,
        '',
        'Step 1 — DOP components from Q diagonal:',
        `  GDOP = √(Q₁₁+Q₂₂+Q₃₃+Q₄₄) = √(${(q11+q22+q33+q44).toFixed(4)}) = ${GDOP.toFixed(2)}`,
        `  PDOP = √(Q₁₁+Q₂₂+Q₃₃) = √(${(q11+q22+q33).toFixed(4)}) = ${PDOP.toFixed(2)}`,
        `  HDOP = √(Q₁₁+Q₂₂) = √(${(q11+q22).toFixed(4)}) = ${HDOP.toFixed(2)}`,
        `  VDOP = √(Q₃₃) = √(${q33.toFixed(4)}) = ${VDOP.toFixed(2)}`,
        `  TDOP = √(Q₄₄) = √(${q44.toFixed(4)}) = ${TDOP.toFixed(2)}`,
        '',
        'Step 2 — GNSS quality rating:',
        `  GDOP = ${GDOP.toFixed(2)} — ${GDOP < 2 ? 'EXCELLENT (ideal geometry)' : GDOP < 4 ? 'GOOD (open-sky, typical)' : GDOP < 6 ? 'MODERATE (trees/buildings)' : GDOP < 10 ? 'POOR (urban canyon)' : 'VERY POOR (few satellites)'}`,
        '',
        'Step 3 — Accuracy estimate (assuming σ_range ≈ 3 m):',
        `  Horizontal error ≈ HDOP × σ ≈ ${(HDOP * 3).toFixed(1)} m`,
        `  Vertical error   ≈ VDOP × σ ≈ ${(VDOP * 3).toFixed(1)} m`,
        '',
        `  └ VDOP/HDOP ratio: ${(VDOP/HDOP).toFixed(2)} (typical: 1.5–2.5× for single-side sky view)`,
        `  └ TDOP ≈ ${(TDOP/GDOP*100).toFixed(0)}% of GDOP (clock dilution)`,
      ],
      secondary: [
        { key: 'pdop', value: PDOP, label: 'PDOP (Position DOP)' },
        { key: 'hdop', value: HDOP, label: 'HDOP (Horizontal DOP)' },
        { key: 'vdop', value: VDOP, label: 'VDOP (Vertical DOP)' },
        { key: 'tdop', value: TDOP, label: 'TDOP (Time DOP)' },
      ],
    };
  },
  130: ({ P, T, e, Sc }) => {
    // Saastamoinen (1972): "Atmospheric correction for the troposphere
    // and stratosphere in radio ranging of satellites.
    // Geophys. Monograph Ser., Vol. 15, pp. 247–251, AGU.
    //
    // Paper-exact formula:
    //   ZHD = 0.0022768 × P
    //   ZWD = 0.0022768 × (1255/T + 0.05) × e
    //   Δτ  = (ZHD + ZWD) / sin(θ)
    //
    // Note: the wet term is (1255/T + 0.05), NOT 1255/(T+0.05).
    // The latitude/height correction factor in ZHD is omitted because
    // the surface pressure P already incorporates local effects.
    if (![P, T, e, Sc].every((v) => v != null && Number.isFinite(v))) {
      return {
        result: Number.NaN, unit: 'm',
        steps: [
          '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
          '',
          'One or more inputs are non-finite. Supply genuine surface',
          'meteorological data (P, T, e) and elevation angle (Sc).',
        ],
        secondary: [
          { key: 'zhd', value: Number.NaN, unit: 'm', label: 'Zenith Hydrostatic Delay' },
          { key: 'zwd', value: Number.NaN, unit: 'm', label: 'Zenith Wet Delay' },
          { key: 'ztd', value: Number.NaN, unit: 'm', label: 'Zenith Total Delay' },
        ],
      };
    }
    const safe = (v: number, min: number, max: number) => v > min && v < max;
    if (!safe(P, 0, 2000) || !safe(T, 0, 500) || e < 0 || e > 200) {
      return {
        result: Number.NaN, unit: 'm',
        steps: [
          '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
          '',
          'Inputs outside physically plausible range:',
          `  P = ${P} hPa (expected 0–2000 hPa)`,
          `  T = ${T} K (expected 0–500 K)`,
          `  e = ${e} hPa (expected 0–200 hPa)`,
          'No fabricated delay is substituted.',
        ],
        secondary: [
          { key: 'zhd', value: Number.NaN, unit: 'm', label: 'Zenith Hydrostatic Delay' },
          { key: 'zwd', value: Number.NaN, unit: 'm', label: 'Zenith Wet Delay' },
          { key: 'ztd', value: Number.NaN, unit: 'm', label: 'Zenith Total Delay' },
        ],
      };
    }
    const sinTheta = Math.sin(Sc);
    if (sinTheta <= 0 || !Number.isFinite(sinTheta)) {
      return {
        result: Number.NaN, unit: 'm',
        steps: [
          '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
          '',
          `Elevation angle Sc = ${Sc} rad, sin(Sc) = ${sinTheta}`,
          'sin(θ) must be > 0. Elevation angle must be in (0°, 180°)',
          'and not 0° or 180° (which would cause division by zero).',
        ],
        secondary: [
          { key: 'zhd', value: Number.NaN, unit: 'm', label: 'Zenith Hydrostatic Delay' },
          { key: 'zwd', value: Number.NaN, unit: 'm', label: 'Zenith Wet Delay' },
          { key: 'ztd', value: Number.NaN, unit: 'm', label: 'Zenith Total Delay' },
        ],
      };
    }
    const coeff = 0.0022768;  // paper-exact coefficient
    const zhd = coeff * P;
    const wetTerm = (1255 / T + 0.05) * e;  // paper: (1255/T + 0.05)·e
    const zwd = coeff * wetTerm;
    const ztd = zhd + zwd;
    const dTau = ztd / sinTheta;

    // Profile series: delay vs elevation angle (5° to 90° in 5° steps)
    const profilePoints: Array<{ x: number; y: number }> = [];
    for (let deg = 5; deg <= 90; deg += 5) {
      const rad = deg * Math.PI / 180;
      const s = Math.sin(rad);
      if (s > 0) {
        profilePoints.push({ x: deg, y: ztd / s });
      }
    }

    return {
      result: dTau, unit: 'm',
      steps: [
        '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
        `Surface pressure P = ${P.toFixed(1)} hPa`,
        `Temperature T = ${T.toFixed(1)} K (${(T - 273.15).toFixed(1)} °C)`,
        `Water vapour pressure e = ${e.toFixed(2)} hPa`,
        `Elevation angle θ = ${(Sc * 180 / Math.PI).toFixed(1)}°, sin(θ) = ${sinTheta.toFixed(4)}`,
        '',
        'Step 1 — Zenith hydrostatic delay (ZHD):',
        `  ZHD = 0.0022768 × P = 0.0022768 × ${P.toFixed(1)} = ${zhd.toFixed(4)} m`,
        '',
        'Step 2 — Zenith wet delay (ZWD):',
        `  (1255/T + 0.05) = 1255/${T.toFixed(1)} + 0.05 = ${(1255/T + 0.05).toFixed(4)}`,
        `  ZWD = 0.0022768 × ${(1255/T + 0.05).toFixed(4)} × ${e.toFixed(2)} = ${zwd.toFixed(4)} m`,
        '',
        'Step 3 — Zenith total delay (ZTD):',
        `  ZTD = ZHD + ZWD = ${zhd.toFixed(4)} + ${zwd.toFixed(4)} = ${ztd.toFixed(4)} m`,
        '',
        'Step 4 — Slant delay:',
        `  Δτ = ZTD / sin(θ) = ${ztd.toFixed(4)} / ${sinTheta.toFixed(4)} = ${dTau.toFixed(4)} m (${(dTau * 100).toFixed(2)} cm)`,
        '',
        `  └ ZHD/ZTD ratio: ${(zhd/ztd*100).toFixed(1)}% (hydrostatic dominates at all elevations)`,
        `  └ ZWD/ZTD ratio: ${(zwd/ztd*100).toFixed(1)}% (wet delay — dominant error source for GPS)`,
      ],
      secondary: [
        { key: 'zhd', value: zhd, unit: 'm', label: 'Zenith Hydrostatic Delay' },
        { key: 'zwd', value: zwd, unit: 'm', label: 'Zenith Wet Delay' },
        { key: 'ztd', value: ztd, unit: 'm', label: 'Zenith Total Delay' },
      ],
      series: [{
        label: 'Saastamoinen delay vs elevation angle',
        color: '#D2691E',
        xLabel: 'Elevation angle θ (°)',
        points: profilePoints,
      }],
    };
  },

};
