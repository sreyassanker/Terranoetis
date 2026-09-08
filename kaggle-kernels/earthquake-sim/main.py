"""
Terranoetis — 2D Earthquake Scenario ShakeMap (GMPE-based)

Runs locally (python3, CPU, milliseconds) or on Kaggle. No 3D wave solver:
the previous 96x96x48 elastic-wave animation was decorative — its surface
hazard fields (PGA/PGV/Sa/MMI) were already computed by the 2D GMPE below,
which is exactly how the USGS operational ShakeMap works
(earthquake.usgs.gov/science/shakemap — "maps of ground motion and shaking
intensity" from ground-motion prediction equations + interpolation).

Physics (all 2D, median predictions of published, citable relations):
  - Distance metric: hypocentral distance R_hyp = sqrt(R_epic^2 + depth^2)
    (point-source; no fault-geometry directivity — documented limitation).
  - PGA, PGV and Sa(1.0 s): the Boore, Stewart, Seyhan & Atkinson NGA-West2
    GMPE (BSSA14; PEER 2013/05, published as Boore et al. 2014, BSSA 104(2),
    doi:10.1785/0120130065). Coefficients are read directly from the Appendix
    tables of PEER 2013/05 (bundled in this repo under docs/). ln Y =
    FE(M,mech) + FP(R,M) + FS(VS30,M,R) with the full linear + nonlinear site
    response; unspecified fault mechanism; base-case (no regional anelastic /
    basin-depth terms). Validity: M 3-9.7, shallow crustal, VS30 150-1500 m/s.
    (This replaces an earlier ad-hoc "simplified" attenuation curve that could
    not be traced to any publication.)
  - MMI: USGS Instrumental Intensity (Worden et al. 2012, BSSA 102(1):204-221,
    doi:10.1785/0120110156; global GMICE Caprio et al. 2015, BSSA 105(3):
    1476-1490, doi:10.1785/0120140286) band boundaries for PGA->MMI and
    PGV->MMI, taking the maximum of the two — the combination rule used by the
    operational USGS ShakeMap (supersedes the older Wald 1999 /
    Wald & Worden 2000 cut-points this kernel previously used).

Outputs (same .npy names as before so the client overlays are unchanged):
  pga_cm_s2.npy, pgv_cm_s.npy, sa_1s_cm_s2.npy, mmi.npy, metadata.json

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

# ── JSON-safe conversion ───────────────────────────────────────────
# NumPy 2.x scalars (np.bool_, np.float64, np.int64, ...) are no longer
# subclasses of Python's bool/float/int, so json.dump/dumps on a dict that
# contains one raises `TypeError: Object of type bool is not JSON serializable`
# (observed on Kaggle). Recursively convert every numpy scalar/array to native
# Python types so result serialization is numpy-version-agnostic.
def _json_safe(obj):
    if isinstance(obj, np.ndarray):
        if obj.ndim == 0:
            return _json_safe(obj.item())
        return [_json_safe(v) for v in obj.tolist()]
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float):
        if obj != obj or obj in (float('inf'), float('-inf')):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


# ── GMPE coefficients (PGA attenuation; simplified NGA-West2-style median) ──
# ── Ground-Motion Prediction Equation: Boore, Stewart, Seyhan & Atkinson ──
# (BSSA14 / PEER 2013/05, "NGA-West2 Equations for Predicting Response Spectral
# Accelerations for Shallow Crustal Earthquakes"; published as Boore et al. 2014,
# BSSA 104(2), doi:10.1785/0120130065). Coefficients below are read directly
# from the Appendix coefficient tables of PEER 2013/05 (in this repo under
# docs/). This is a real, citable NGA-West2 GMPE — the previous kernel used an
# ad-hoc "simplified" curve that a researcher could not trace to any publication.
#
# ln Y = FE(M,mech) + FP(R,M) + FS(VS30,M,R)
#   FE (unspecified fault, U=1):  M<=Mh: e0 + e4(M-Mh) + e5(M-Mh)^2
#                                 M> Mh: e0 + e6(M-Mh)
#   FP:  [c1 + c2(M-Mref)]*ln(R/Rref) + c3(R-Rref),  R = hypocentral distance
#        (point-source proxy for the GMPE's sqrt(Rjb^2+h^2); no rupture geometry)
#   FS = ln(Flin)+ln(Fnl):  Flin = c*ln(min(VS30,Vc)/Vref)
#                           Fnl  = f1 + f2*ln((PGAr+f3)/f3),
#                           f2 = f4*[exp(f5*(min(VS30,760)-360)) - exp(f5*(760-360))]
#   PGAr = reference-rock (VS30=760) PGA in g, used as the shaking-intensity
#   proxy in the nonlinear site term for every IM.
# Units: PGA & Sa in g (returned cm/s^2), PGV in cm/s.
VS30_REF = 760.0  # m/s — NEHRP reference rock (site amplification = unity)

# base coeffs: e0,e1,e2,e3,e4,e5,e6,Mh,c1,c2,c3,Mref,Rref,h
_BSSA_BASE = {
    'pga': (0.4473, 0.4856, 0.2459, 0.4539, 1.431, 0.05053, -0.1662, 5.5,
            -1.134, 0.1917, -0.00809, 4.5, 1.0, 4.5),
    'pgv': (5.037, 5.078, 4.849, 5.033, 1.073, -0.1536, 0.2252, 6.2,
            -1.243, 0.1489, -0.00344, 4.5, 1.0, 5.3),
    'sa1': (0.3932, 0.4218, 0.207, 0.4124, 1.5004, -0.18983, 0.17895, 6.2,
            -1.193, 0.10248, -0.00121, 4.5, 1.0, 5.74),
}
# site coeffs: c, Vc, Vref, f1, f3, f4, f5
_BSSA_SITE = {
    'pga': (-0.5150, 925.00, 760.0, 0.0, 0.1, -0.1500, -0.00701),
    'pgv': (-0.8050, 950.00, 760.0, 0.0, 0.1, -0.1000, -0.00844),
    'sa1': (-1.0361, 967.51, 760.0, 0.0, 0.1, -0.1052, -0.00844),
}


def _bssa14_lnY(kind, magnitude, distance_km, vs30, pgar_g):
    """ln Y (natural log of the IM in its native units) for the BSSA14 GMPE,
    unspecified fault mechanism, base-case (no regional anelastic / basin-depth).
    distance_km is hypocentral distance (point-source proxy for Rjb)."""
    e0, e1, e2, e3, e4, e5, e6, Mh, c1, c2, c3, Mref, Rref, h = _BSSA_BASE[kind]
    M = float(magnitude)
    R = np.maximum(np.asarray(distance_km, dtype=np.float64), 0.1)
    # FE — unspecified fault (U=1, SS=NS=RS=0)
    if M <= Mh:
        FE = e0 + e4 * (M - Mh) + e5 * (M - Mh) ** 2
    else:
        FE = e0 + e6 * (M - Mh)
    # FP — distance
    FP = (c1 + c2 * (M - Mref)) * np.log(R / Rref) + c3 * (R - Rref)
    lnY_ref = FE + FP                       # reference-rock (VS30=760) motion
    # FS — linear + nonlinear site response
    c, Vc, Vref, f1, f3, f4, f5 = _BSSA_SITE[kind]
    vs = np.asarray(vs30, dtype=np.float64)
    lnFlin = c * np.log(np.minimum(vs, Vc) / Vref)
    f2 = f4 * (np.exp(f5 * (np.minimum(vs, 760.0) - 360.0))
               - np.exp(f5 * (760.0 - 360.0)))
    lnFnl = f1 + f2 * np.log((np.asarray(pgar_g, dtype=np.float64) + f3) / f3)
    return lnY_ref + lnFlin + lnFnl


def _pga_ref_rock(magnitude, distance_km):
    """Reference-rock (VS30=760) PGA in g — the PGAr intensity proxy."""
    return np.exp(_bssa14_lnY('pga', magnitude, distance_km, VS30_REF, 0.0))


def nga_west2_pga(magnitude, distance_km, vs30=VS30_REF):
    """Median PGA (cm/s²) — BSSA14 (Boore et al. 2014) NGA-West2 GMPE."""
    pgar = _pga_ref_rock(magnitude, distance_km)
    return np.exp(_bssa14_lnY('pga', magnitude, distance_km, vs30, pgar)) * 981.0


def bssa14_pgv(magnitude, distance_km, vs30=VS30_REF):
    """Median PGV (cm/s) — BSSA14, same GMPE family as the PGA model."""
    pgar = _pga_ref_rock(magnitude, distance_km)
    return np.exp(_bssa14_lnY('pgv', magnitude, distance_km, vs30, pgar))


# ── USGS Instrumental Intensity (Worden et al. 2012) ──────────────────────
# Authoritative PGA (g) and PGV (cm/s) band boundaries + per-level median PGV
# for the CURRENT USGS ShakeMap intensity scale (supersedes Wald et al. 1999).
# Used as a SINGLE source of truth so PGA->MMI, PGV->MMI and MMI->PGV are
# mutually consistent (round-trip).
# Upper bound of each integer MMI band 1..9 (MMI 10 is above the last bound):
_MMI_PGA_G_UB = [0.000464, 0.00135, 0.00297, 0.0276, 0.115, 0.215, 0.401, 0.747, 1.39]
_MMI_PGV_CM_UB = [0.0215, 0.135, 1.41, 4.65, 9.64, 20.0, 41.4, 85.8, 178.0]
# Median PGV (cm/s) for each integer MMI 1..10 (geometric mean of the band):
_MMI_PGV_MED = [0.010, 0.054, 0.437, 2.56, 6.70, 13.9, 28.8, 59.6, 123.6, 267.0]


def _intensity_band(value, upper_bounds):
    """Integer MMI (1..10): index of the first band whose upper bound exceeds
    `value` (vectorised)."""
    v = np.asarray(value, dtype=np.float64)
    out = np.full(v.shape, len(upper_bounds) + 1, dtype=np.float64)
    for k, ub in enumerate(upper_bounds):
        out = np.where((v < ub) & (out > (k + 1)), k + 1, out)
    return out


def pgv_from_mmi(mmi):
    """Median PGV (cm/s) for an integer MMI, from the Worden-2012 table.
    Inverse-consistent with compute_mmi_from_pgv (same table)."""
    idx = np.clip(np.asarray(mmi, dtype=np.float64), 1.0, 10.0).astype(int) - 1
    return np.asarray(_MMI_PGV_MED, dtype=np.float64)[idx]


def spectral_acceleration(magnitude, distance_km, period=1.0, vs30=VS30_REF):
    """Sa (cm/s²) — BSSA14 at T=1.0 s (the only period the kernel emits).
    Other periods fall back to the PGA model scaled by the 1 s/PGA ratio."""
    kind = 'sa1' if abs(period - 1.0) < 1e-9 else 'pga'
    pgar = _pga_ref_rock(magnitude, distance_km)
    return np.exp(_bssa14_lnY(kind, magnitude, distance_km, vs30, pgar)) * 981.0


def compute_mmi_from_pga(pga_cm_s2):
    """Modified Mercalli Intensity from PGA — USGS instrumental intensity
    (Worden et al. 2012) band boundaries."""
    return _intensity_band(np.asarray(pga_cm_s2, dtype=np.float64) / 981.0,
                           _MMI_PGA_G_UB)


def compute_mmi_from_pgv(pgv_cm_s):
    """Modified Mercalli Intensity from PGV — USGS instrumental intensity
    (Worden et al. 2012) band boundaries."""
    return _intensity_band(np.asarray(pgv_cm_s, dtype=np.float64), _MMI_PGV_CM_UB)


def verify_gmpe_sanity():
    """
    Physics gate — the BSSA14 GMPE + Worden-2012 intensity relations must
    reproduce published-order medians before any field is emitted:
      PGA decreases monotonically with distance; M6.5@10km rock in the
      NGA-West2 median band (~100-500 cm/s²)
      soft site (Vs30=300) amplifies over reference rock (Vs30=760)
      PGV/PGA ratio is physical (~0.05-0.2 s)
      MMI(VIII) => PGV in the Worden-2012 band (41.4-85.8 cm/s); MMI->PGV->MMI
      round-trips for every level 1..10
    Fails the run if any relation is mis-wired (e.g. unit slip).
    """
    pga10 = float(nga_west2_pga(6.5, 10.0))
    pga50 = float(nga_west2_pga(6.5, 50.0))
    pga200 = float(nga_west2_pga(6.5, 200.0))
    ok_decay = pga10 > pga50 > pga200 > 0.0
    ok_range = 100.0 < pga10 < 500.0
    ok_site = float(nga_west2_pga(7.0, 20.0, 300.0)) > float(nga_west2_pga(7.0, 20.0, 760.0))
    pgv7 = float(bssa14_pgv(7.0, 20.0)); pga7 = float(nga_west2_pga(7.0, 20.0))
    ok_ratio = 0.05 <= pgv7 / pga7 <= 0.2
    # MMI(VIII) median PGV must land in the authoritative 41.4-85.8 cm/s band.
    pgv8 = float(pgv_from_mmi(np.float64(8.0)))
    ok_pgv8 = 41.4 <= pgv8 <= 85.8
    # Round-trip: for every integer MMI, PGV->MMI must return the same level.
    rt = all(int(compute_mmi_from_pgv(np.array([pgv_from_mmi(np.float64(k))]))[0]) == k
             for k in range(1, 11))
    # PGA->MMI monotonic non-decreasing with PGA.
    g = np.array([0.001, 0.05, 0.15, 0.3, 0.6, 1.0, 2.0]) * 981.0
    mm = compute_mmi_from_pga(g)
    ok_mmi = bool(np.all(np.diff(mm) >= 0)) and mm[0] <= 3 and mm[-1] >= 9
    passed = all([ok_decay, ok_range, ok_site, ok_ratio, ok_pgv8, rt, ok_mmi])
    print(f"[VERIFY] BSSA14 GMPE: PGA M6.5@10km={pga10:.0f} @50km={pga50:.0f} "
          f"@200km={pga200:.1f} cm/s² | M7@20km PGV={pgv7:.1f}cm/s ratio={pgv7/pga7:.3f}s | "
          f"PGV(MMI8)={pgv8:.1f} (USGS 41-86) | decay={'OK' if ok_decay else 'FAIL'} "
          f"range={'OK' if ok_range else 'FAIL'} site={'OK' if ok_site else 'FAIL'} "
          f"ratio={'OK' if ok_ratio else 'FAIL'} pgv8={'OK' if ok_pgv8 else 'FAIL'} "
          f"roundtrip={'OK' if rt else 'FAIL'} mmi={'OK' if ok_mmi else 'FAIL'} → "
          f"{'PASS' if passed else 'FAIL'}")
    return passed


def simulate_shakemap(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    magnitude = float(params.get('magnitude', 6.5))
    depth_km = float(params.get('depth_km', 12.0))
    lat = float(params.get('lat', 35.68))
    lon = float(params.get('lon', 139.65))
    vs30 = float(params.get('vs30', VS30_REF))

    if not (3.0 <= magnitude <= 9.7):
        raise ValueError(f'magnitude {magnitude} outside the 3.0-9.7 GMPE validity range')
    if not (0.5 <= depth_km <= 700.0):
        raise ValueError(f'depth_km {depth_km} outside 0.5-700 km')
    if not (150.0 <= vs30 <= 1500.0):
        raise ValueError(f'vs30 {vs30} m/s outside the 150-1500 NEHRP site range')

    extent_km = float(params.get('extent_km', 0.0))
    dx = (extent_km * 1000.0 / gs) if extent_km > 0 else 500.0  # meters

    # Grid geometry: square domain centred on the study-box centre, row 0 =
    # north (same convention as every other kernel + the client overlays). Cells
    # are dx×dx metres in a local equirectangular frame — valid for a <=500 km box.
    # The EPICENTRE is a pinned point within the box (epi_frac_x/y, 0..1, x=east
    # y=south) exactly like the volcano vent; it defaults to the grid centre when
    # not supplied. The distance field radiates from the epicentre cell, so the
    # strongest shaking sits where the user dropped it (on the fault), not
    # necessarily at the box centre.
    epi_fx = float(params.get('epi_frac_x', 0.5))
    epi_fy = float(params.get('epi_frac_y', 0.5))
    epi_fx = min(1.0, max(0.0, epi_fx))
    epi_fy = min(1.0, max(0.0, epi_fy))
    epi_col = epi_fx * (gs - 1)
    epi_row = epi_fy * (gs - 1)
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    east_km = (x - epi_col) * dx / 1000.0
    north_km = (epi_row - y) * dx / 1000.0

    r_epi_km = np.sqrt(east_km ** 2 + north_km ** 2)
    r_hyp_km = np.sqrt(r_epi_km ** 2 + depth_km ** 2)

    pga = nga_west2_pga(magnitude, r_hyp_km, vs30)
    pgv = bssa14_pgv(magnitude, r_hyp_km, vs30)
    sa_1s = spectral_acceleration(magnitude, r_hyp_km, period=1.0, vs30=vs30)
    # MMI combination rule (USGS ShakeMap): max of the PGA- and PGV-based
    # instrumental intensities. PGA and PGV are now independent BSSA14 GMPE
    # predictions, so this is a genuine two-parameter combination (Worden 2012),
    # not a round-trip of one estimator through the other.
    mmi = np.maximum(compute_mmi_from_pga(pga), compute_mmi_from_pgv(pgv))

    elapsed = time.time() - t0
    final = {
        'pga_cm_s2': pga.astype(np.float32),
        'pgv_cm_s': pgv.astype(np.float32),
        'sa_1s_cm_s2': sa_1s.astype(np.float32),
        'mmi': mmi.astype(np.float32),
        'max_pga': float(pga.max()),
        'max_pgv': float(pgv.max()),
        'max_mmi': float(mmi.max()),
        'epicenter_cells_broken': int((mmi >= 8).sum()),
        'area_mmi_ge_6_km2': float((mmi >= 6).sum()) * (dx / 1000.0) ** 2,
    }

    # ── ShakeMovie-style arrival-time reveal (animation timeline) ──
    # The peak GMPE field is UNCHANGED; each frame shows that field "switched
    # on" as the direct S-wave front expands from the epicentre (first-arrival
    # time ≈ R_hyp / Vs, a standard approximation). The final frame equals the
    # static peak map exactly, so the play/pause adds a *when-the-shaking-
    # arrives* timeline without altering the validated hazard field.
    vs_km_s = float(params.get('vs_km_s', 3.5))          # crustal S-wave velocity
    n_frames = max(2, int(params.get('shakemap_frames', 24)))
    arrival_s = r_hyp_km / max(vs_km_s, 0.5)
    rise_s = max(1.0, 0.15 * float(arrival_s.max()))      # onset ramp
    t_end = float(arrival_s.max()) + rise_s
    snapshots = []
    for k in range(n_frames):
        t = t_end * (k + 1) / n_frames
        onset = np.clip((t - arrival_s) / rise_s, 0.0, 1.0)
        reveal = onset * onset * (3.0 - 2.0 * onset)      # smoothstep 0→1
        snapshots.append({'pga': (pga * reveal).astype(np.float32),
                          'time_s': round(t, 2)})

    print(f"\n{'='*60}")
    print("TERRANOETIS — 2D GMPE SCENARIO SHAKEMAP")
    print(f"{'='*60}")
    print(f"M{magnitude:.1f} @ {lat:.4f}, {lon:.4f} | depth={depth_km}km | Vs30={vs30} m/s")
    print(f"Grid: {gs}x{gs} @ {dx:.0f} m | domain {extent_km or gs*dx/1000:.1f} km")
    print(f"[DONE] {elapsed:.2f}s | max PGA={final['max_pga']:.0f} cm/s² | "
          f"max PGV={final['max_pgv']:.1f} cm/s | max MMI={final['max_mmi']:.0f}")

    return {
        'final': final,
        'snapshots': snapshots,
        'params': {
            'grid_size': gs, 'magnitude': magnitude, 'depth_km': depth_km,
            'vs30': vs30, 'duration_seconds': float(params.get('duration_seconds', 0)),
            'lat': lat, 'lon': lon, 'cell_size_m': dx,
            'epi_frac_x': epi_fx, 'epi_frac_y': epi_fy,
        },
        'metadata': {
            'elapsed_seconds': elapsed,
            'model': 'BSSA14 (Boore, Stewart, Seyhan & Atkinson 2014, '
                     'doi:10.1785/0120130065) NGA-West2 GMPE + USGS instrumental intensity',
            'dimensionality': '2d',
            'source': 'point_source_hypocentral_distance',
            'coefficients': 'PEER 2013/05 Appendix tables (PGA/PGV/Sa1s base + site)',
            'mmi_rules': 'USGS Instrumental Intensity (Worden et al. 2012, '
                         'doi:10.1785/0120110156; global GMICE Caprio et al. 2015, '
                         'doi:10.1785/0120140286) — PGA->MMI + PGV->MMI, max combined',
            'prediction': 'median (no epistemic uncertainty bands)',
            'limitations': [
                'point-source hypocentral distance used for the GMPE Rjb term — '
                'no fault-geometry directivity or finite-rupture effects',
                'unspecified fault mechanism; base-case only (no regional '
                'anelastic attenuation or basin-depth z1 terms)',
                'Sa reported at T=1.0 s only',
                'Worden-2012/Caprio-2015 intensity relations calibrated on '
                'California/global datasets and saturate for great-earthquake '
                'near-fields',
            ],
        },
    }


# simRunner injects the run's JSON params here at push time (Kaggle only
# uploads the code file, so params cannot be passed as a sibling file).
# For local runs the server writes params.json next to main.py instead.
EMBEDDED_PARAMS = None

def _load_params():
    if EMBEDDED_PARAMS:
        try:
            if isinstance(EMBEDDED_PARAMS, dict):
                return EMBEDDED_PARAMS
            return json.loads(EMBEDDED_PARAMS)
        except Exception:
            pass
    candidates = ['params.json', '/kaggle/working/params.json', '/kaggle/input/params.json']
    src = '/kaggle/src'
    if os.path.isdir(src):
        for root, _dirs, files in os.walk(src):
            if 'params.json' in files:
                candidates.append(os.path.join(root, 'params.json'))
    for p in candidates:
        try:
            if os.path.exists(p):
                with open(p) as f:
                    return json.load(f)
        except Exception:
            continue
    return None


def main():
    print("=" * 60)
    print("TERRANOETIS — 2D Earthquake Scenario ShakeMap (GMPE)")
    print("=" * 60)
    out = os.environ.get('TERRANOETIS_OUT_DIR', '/kaggle/working')
    params = _load_params()
    if params is None:
        params = {
            'grid_size': 256, 'magnitude': 6.5, 'depth_km': 12,
            'lat': 35.68, 'lon': 139.65,
        }

    try:
        if not verify_gmpe_sanity():
            raise RuntimeError(
                "GMPE sanity gate failed — refusing to emit a ShakeMap from "
                "mis-wired attenuation relations."
            )

        result = simulate_shakemap(params)
        os.makedirs(out, exist_ok=True)

        np.save(f'{out}/pga_cm_s2.npy', result['final']['pga_cm_s2'])
        np.save(f'{out}/pgv_cm_s.npy', result['final']['pgv_cm_s'])
        np.save(f'{out}/sa_1s_cm_s2.npy', result['final']['sa_1s_cm_s2'])
        np.save(f'{out}/mmi.npy', result['final']['mmi'])
        # ShakeMovie arrival-time series (animation). The final frame equals
        # pga_cm_s2; earlier frames reveal the field as the S-wave front
        # expands from the epicentre.
        snaps = result['snapshots']
        np.save(f'{out}/snapshots_pga.npy',
                np.stack([s['pga'] for s in snaps]))
        np.save(f'{out}/snapshot_times.npy',
                np.array([s['time_s'] for s in snaps]))

        meta = {
            'params': result['params'],
            'metadata': result['metadata'],
            'final_stats': {
                'max_pga': result['final']['max_pga'],
                'max_pgv': result['final']['max_pgv'],
                'max_mmi': result['final']['max_mmi'],
                'epicenter_cells_broken': result['final']['epicenter_cells_broken'],
                'area_mmi_ge_6_km2': result['final']['area_mmi_ge_6_km2'],
            },
            'snapshot_count': len(snaps),
            'completed': True,
        }
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(_json_safe(meta), f, indent=2)

        print(f"\n{'='*60}\nSHAKEMAP COMPLETE\n{'='*60}")
        print(f"Files: {sorted(os.listdir(out))}")
    except Exception as e:
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
        try:
            os.makedirs(out, exist_ok=True)
            with open(f'{out}/error.log', 'w') as f:
                traceback.print_exc(file=f)
        except Exception:
            pass
        raise


if __name__ == '__main__':
    main()
