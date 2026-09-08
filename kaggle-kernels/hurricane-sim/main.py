"""
Terranoetis — 2D Hurricane Wind + Storm Surge (Holland 1980 + nonlinear SWE)

Runs locally (python3, CPU, seconds) or on Kaggle. This is the same physics
class the operational NOAA SLOSH model uses (Pitman et al. 2007, NOAA Tech.
Document NWS TDL-46): a parametric Holland (1980) wind/pressure field forcing
depth-averaged nonlinear shallow-water equations (SWE) over real terrain.

Physics (all 2D, depth-averaged — documented, with validity limits below):
  - Wind: Holland (1980, MWR 108:1212) gradient-wind balance with Coriolis:
        V(r) = sqrt( V_c^2 + (f·r/2)^2 ) − f·r/2,
        V_c^2 = (B·Δp/ρ)·x·e^(−x),  x = (R_max/r)^B
    B from the observed Vmax–Δp relation (Atkinson & Hollan 2012, BAMS):
        B = e·ρ·Vmax^2/Δp, clipped to [1.0, 2.5].
    Storm asymmetry: the translation velocity is added VECTORIZALLY to the
    cyclonic gradient-wind vector (standard composite used in rapid-assessment
    tools; strengthens the right-front quadrant in the Northern Hemisphere).
    Observed wind may exceed Vmax by up to the forward speed — the previous
    kernel clipped it away.
  - Pressure: Holland (1980) p(r) = pc + Δp·exp(−(R_max/r)^B).
  - Surge: nonlinear 2D SWE (continuity + momentum) solved on a staggered
    Arakawa-C grid with upwind face fluxes and wetting/drying (LeVeque 2002,
    finite-volume methods; the scheme class behind SLOSH/ADCIRC overland
    coupling). Forcing: quadratic wind stress
    τ = ρ_a·C_d·|U|·U with C_d = 1.5e-3 (Powell et al. 2003, BAMS — drag
    saturation at high winds), atmospheric pressure gradient (the
    inverse-barometer response is implicit in the momentum forcing — it is
    NOT added again to the output, fixing the previous double-count), and
    Manning bottom friction.
  - Waves: fetch-limited growth, JONSWAP/SMB form H_s = 1.6e-3·U_A·sqrt(F)
    capped at the Pierson–Moskowitz fully-developed limit H_s ≤ 0.0248·U_A²
    (USACE Coastal Engineering Manual EM 1110-2-1100 Part II-1). U_A = 0.71·U10
    is the stress-equivalent wind (Large & Pond 1981, JPO 11:324). Fetch F =
    distance to the nearest coastline over water (upper-bound proxy,
    documented). Depth-limited breaking H_b = γ·d with γ = 0.78 (USACE CEM
    Part II-1, "(H/d)max = 0.78"). Wave setup at the still-water shoreline from
    the USACE radiation-stress result Eq. II-4-24: η_s ≈ 0.15·d_b for breaker
    index 0.8, i.e. ≈ 0.19·H_b (mechanism: S_xx = E(2C_g/C − 1), E = ρg·H²/8).
  - Rainfall: parametric footprint following the Lonfat et al. (2007, MWR
    135:3086) PHRaM / R-CLIPER radial structure — zero in the eye, peaking in
    the inner core (peak radius = max(100 km, R_max), i.e. just outside the
    eyewall; observed maxima 50-200 km), decaying to zero at the ~500-km
    footprint edge; peak rate = 1.2·Vmax mm/h (observed hurricane peak-rain-rate
    order; validation against statistical forecasts in Tuleya et al. 2007, WAF
    22:56). Slow-moving storms accumulate more via the translating field. A
    parametric surrogate of the PHRaM structure — the full statistical model's
    shear/topography Fourier terms need the R-CLIPER coefficient tables, not
    reproduced here — documented below.
  - Runoff: SCS Curve Number method, USDA TR-55 Eq. 1:
        Q = (P − 0.2S)² / (P + 0.8S),  S = (1000/CN − 10)·25.4 mm
    computed INCREMENTALLY and fully vectorized (the previous per-cell
    Python double loop was the CPU-heat source). Pluvial ponding is added to
    the coastal water level for the inundation diagnostic (composite
    stillwater depth = surge + setup + runoff, the standard rapid-assessment
    superposition).
  - Terrain: real elevation/bathymetry sampled from the Cesium globe by the
    client (params `terrain` or compacted `terrain_b64`+`terrain_min`+
    `terrain_span`, row-major, row 0 = north, meters, negative = below sea).
    Falls back to a synthetic coastal profile when absent (documented).

Validity limits / documented simplifications (metadata.limits):
  - Point-vortex Holland field: no eyewall/outer-band fine structure, no
    intensity change (Vmax constant), no vertical wind profile (10 m wind).
  - Linear Manning friction coefficient; no tides, no river routing
    (backwater needs a coupled river model — removed from this kernel as an
    unsupportable hack), no wave propagation/refraction (setup is empirical).
  - Grid is a local equirectangular plane — valid for domains ≤ ~500 km.

Outputs (.npy names unchanged from the previous kernel so the client
overlays and the grid/GeoTIFF endpoints are untouched):
  wind_speed, wind_direction, surge_height, wave_setup, wave_height,
  rainfall, runoff, terrain, snapshots_wind, snapshots_surge,
  snapshot_times, metadata.json
"""

import json, os, time, traceback
import base64
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


# ── Physical constants ──────────────────────────────────────────────
RHO_AIR = 1.15        # kg/m³ — air density
RHO_WATER = 1025.0    # kg/m³ — seawater density
G = 9.81              # m/s² — gravity
C_DRAG = 0.0015       # — sea-surface drag coefficient (Large & Pond 1981, JPO
                      #   11:324, doi:10.1175/1520-0485(1981)011<0324>; saturates
                      #   ~1.5e-3 at high wind per Powell et al. 2003, BAMS)
N_MANING = 0.03       # — Manning's n bottom friction (typical shelf/channel)
GAMMA_BREAKER = 0.78  # — depth-limited breaker index H_b/d (USACE CEM Part II-1,
                      #   "(H/d)max = 0.78 agrees best with observations")
K_SETUP = 0.19        # — shoreline wave setup: USACE CEM Eq II-4-24 gives
                      #   η_s ≈ 0.15·d_b for breaker index 0.8; with H_b=γ·d_b
                      #   (γ=0.78) → η_s ≈ 0.19·H_b
JONSWAP_CH = 1.6e-3   # — fetch-limited growth H_s = 1.6e-3·U_A·sqrt(F) (SI;
                      #   JONSWAP/SMB, USACE CEM Part II-1 wind-wave growth)
PM_LIMIT = 0.0248     # — fully-developed cap H_s ≤ 0.0248·U_A² (Pierson–Moskowitz)
# Rainfall: parametric footprint following the Lonfat et al. (2007) PHRaM /
# R-CLIPER radial structure — peak in the inner core (50-200 km), extending to
# ~500 km, peak rate scaling with intensity, accumulation rising for slow-moving
# storms (forward-speed dependence emerges from the translating field).
RAIN_PEAK_PER_VMAX = 1.2   # mm/h per m/s — observed TC peak rain-rate order
RAIN_PEAK_RADIUS_KM = 100.0  # representative inner-core rain-rate maximum
RAIN_EXTENT_KM = 500.0     # PHRaM footprint outer radius (Lonfat et al. 2007)
CELL_SIZE_M = 2000.0       # default meters per grid cell (2 km)
CFL_DEPTH_CAP_M = 200.0    # depth cap for the CFL time step (deep-water waves
                           # carry negligible surge; keeps dt usable on CPU)

# SCS Curve Numbers (USDA TR-55, 250 mm/24 h event basis)
CN_URBAN = 85
CN_SUBURBAN = 77
CN_FOREST = 65
CN_GRASS = 70
CN_WATER = 99

OMEGA_EARTH = 7.2921159e-5  # rad/s


def coriolis_param(lat_deg):
    """f = 2·Ω·sin(latitude)  (zero at the equator)."""
    return 2.0 * OMEGA_EARTH * np.sin(np.radians(lat_deg))


def holland_B(dp_hpa, vmax_ms, rho=RHO_AIR):
    """Holland (1980) B-parameter from max wind: B = ρ·e·Vmax²/(Δp·100).
    Δp in hPa → ×100 converts to Pa. Bounded to the physical range [1.0, 2.5]."""
    dp_pa = max(dp_hpa, 1.0) * 100.0
    B = rho * np.e * vmax_ms**2 / dp_pa
    return float(np.clip(B, 1.0, 2.5))


def holland_pressure_radial(r_km, pc_hpa, dp_hpa, rmax_km, B):
    """Holland (1980) radial pressure profile p(r) = pc + Δp·exp(−(Rmax/r)^B)."""
    rr = np.maximum(r_km, 0.1)
    return pc_hpa + dp_hpa * np.exp(-((rmax_km / rr) ** B))


def holland_wind_speed(r_km, dp_hpa, rmax_km, B, lat_deg):
    """Holland (1980) gradient-level wind with the Coriolis term:
       V(r) = sqrt( (B·Δp/ρ)·x·e^(−x) + (f·r/2)² ) − f·r/2,  x=(Rmax/r)^B
    Cyclostrophic balance near the center, geostrophic far away."""
    r_km = np.maximum(r_km, 0.1)
    r_m = r_km * 1000.0
    f = coriolis_param(lat_deg)
    x = (rmax_km / r_km) ** B
    v_cyc_sq = (B * (dp_hpa * 100.0) / RHO_AIR) * x * np.exp(-x)
    cor = 0.5 * f * r_m
    return np.sqrt(v_cyc_sq + cor * cor) - cor


def smb_wave_height(wind_ms, fetch_m):
    """Fetch-limited significant wave height (JONSWAP/SMB, USACE CEM Part II):
    H_s = 1.6e-3·U_A·sqrt(F), capped at the Pierson–Moskowitz fully-developed
    limit 0.0248·U_A² (both SI, m). U_A = 0.71·U10 is the stress-equivalent
    wind (Large & Pond 1981, J. Phys. Oceanogr.) — without it, extrapolating
    the growth law to hurricane winds over-predicts sea state ~2×."""
    ua = 0.71 * np.maximum(np.asarray(wind_ms, dtype=np.float64), 0.0)
    f = np.maximum(np.asarray(fetch_m, dtype=np.float64), 0.0)
    h = JONSWAP_CH * ua * np.sqrt(f)
    return np.minimum(h, PM_LIMIT * ua * ua)


def lonfat_rain_rate(r_km, vmax_ms, rmax_km):
    """Instantaneous rain rate (mm/h) — parametric footprint following the
    Lonfat et al. (2007, MWR 135:3086) PHRaM / R-CLIPER radial structure:
    zero in the eye, rising to a maximum in the inner core (peak radius =
    max(100 km, Rmax), i.e. just outside the eyewall), decaying to zero at the
    ~500-km footprint edge. Peak rate scales with intensity (Vmax); slow-moving
    storms accumulate more because the translating field dwells longer (handled
    by the time integration in the caller). A parametric surrogate of the PHRaM
    structure — the full statistical model's shear/topography Fourier terms need
    the R-CLIPER coefficient tables, which are not reproduced here."""
    r = np.maximum(np.asarray(r_km, dtype=np.float64), 0.0)
    r_peak = max(RAIN_PEAK_RADIUS_KM, float(rmax_km))
    inner = np.clip(r / r_peak, 0.0, 1.0)
    outer = np.clip((RAIN_EXTENT_KM - r) / (RAIN_EXTENT_KM - r_peak), 0.0, 1.0)
    return RAIN_PEAK_PER_VMAX * float(vmax_ms) * inner * outer ** 1.5


def scs_cn_runoff_cum(p_mm, cn):
    """USDA TR-55 SCS-CN cumulative runoff: Q=(P−0.2S)²/(P+0.8S), P>0.2S.
    Vectorized; returns mm. cn=99+ (water) → no runoff (handled by caller)."""
    cn = np.clip(np.asarray(cn, dtype=np.float64), 30.0, 98.0)
    s = (1000.0 / cn - 10.0) * 25.4
    p = np.maximum(np.asarray(p_mm, dtype=np.float64), 0.0)
    q = np.where(p > 0.2 * s, (p - 0.2 * s)**2 / (p + 0.8 * s), 0.0)
    return np.minimum(q, p)  # mass balance: runoff can never exceed rainfall


def load_real_terrain(params, gs):
    """Decode a real elevation grid from params: raw `terrain` array or the
    compacted `terrain_b64` (uint16 little-endian) + `terrain_min` +
    `terrain_span` form the server uses for Kaggle pushes. Returns (gs, gs)
    float64 meters (negative = below sea level) or None."""
    elev_raw = params.get('terrain')
    if isinstance(elev_raw, (list, tuple)) and len(elev_raw) >= 4:
        arr = np.asarray(elev_raw, dtype=np.float64)
    else:
        b64 = params.get('terrain_b64')
        t_gs = int(params.get('terrain_gs', 0) or 0)
        if not b64 or t_gs < 2:
            return None
        raw = base64.b64decode(b64)
        arr = np.frombuffer(raw, dtype='<u2').astype(np.float64)
        span = float(params.get('terrain_span', 0.0))
        tmin = float(params.get('terrain_min', 0.0))
        arr = tmin + arr / 65535.0 * span
    side = int(round(np.sqrt(arr.size)))
    if side < 2 or side * side != arr.size:
        return None
    grid = arr.reshape(side, side)
    if side != gs:  # nearest-neighbour resample to the sim grid
        idx = (np.arange(gs) * side // gs)
        grid = grid[np.ix_(idx, idx)]
    return grid


def generate_coastal_bathymetry(N, coast_x_frac=0.5, cell_size_m=CELL_SIZE_M):
    """Synthetic fallback (used only when no real terrain is shipped;
    documented as synthetic): ocean west, land east. Realistic shelf
    gradient (2 m at the shoreline → 200 m at ~130 km, matching the
    ~1.5 m/km continental shelf slope) and land that never dips below sea
    level — the previous ±5 m oscillation created spurious inland 'water'
    cells that ponded unphysical 10 m surges."""
    y, x = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    coast_x = int(N * coast_x_frac)
    dist_off_km = np.maximum(coast_x - x, 0) * cell_size_m / 1000.0
    dist_in_km = np.maximum(x - coast_x, 0) * cell_size_m / 1000.0
    ocean = -np.minimum(2.0 + 1.5 * dist_off_km, 200.0)
    # Low-lying coastal plain (0.3-1.7 m nearshore, rising ~5 cm/km inland)
    # so a 1-2 m surge genuinely inundates — a 3.5 m "beach" would (correctly)
    # block every realistic flood.
    land = 0.3 + 0.05 * dist_in_km + 0.7 * (1 + np.sin(y / N * 3) * np.cos(x / N * 2))
    return np.where(x < coast_x, ocean, land)


def distance_to_coast(water_mask):
    """Maximum possible fetch per water cell: distance (m) to the nearest
    land cell, computed as a Euclidean distance transform over the water
    mask. Upper-bound proxy for upwind fetch (documented simplification)."""
    try:
        from scipy.ndimage import distance_transform_edt
        return distance_transform_edt(water_mask)
    except Exception:
        # numpy fallback: iterative dilation (O(N) passes, fine at 256²)
        dist = np.zeros(water_mask.shape, dtype=np.float64)
        remaining = water_mask.copy()
        step = 0
        while remaining.any() and step < max(remaining.shape):
            step += 1
            eroded = remaining.copy()
            eroded[1:, :] &= remaining[:-1, :]
            eroded[:-1, :] &= remaining[1:, :]
            eroded[:, 1:] &= remaining[:, :-1]
            eroded[:, :-1] &= remaining[:, 1:]
            newly = remaining & ~eroded
            dist[newly] = step
            remaining = eroded
        dist[water_mask & (dist == 0)] = step
        return dist


def verify_hurricane_physics():
    """Physics gate — the parametric relations must reproduce published-order
    values before any field is emitted (same contract as the GMPE gate in the
    earthquake kernel):
      Holland: V(Rmax) ≈ Vmax (±15%), monotonic decay beyond Rmax, B∈[1,2.5]
      Inverse barometer: 1 hPa ↔ 1.0 cm water (ρ_w·g identity)
      SCS-CN: CN=75, P=100 mm → Q≈28.3 mm (TR-55 worked example order)
      Waves: JONSWAP growth monotonic in fetch, capped by PM limit
    """
    vmax, rmax, dp = 70.0, 32.0, 67.0  # Cat-4 reference
    B = holland_B(dp, vmax)
    v_at_rmax = float(holland_wind_speed(np.array([rmax]), dp, rmax, B, 25.0)[0])
    ok_vmax = 0.85 * vmax <= v_at_rmax <= 1.15 * vmax
    r = np.array([rmax, 2 * rmax, 4 * rmax, 8 * rmax])
    prof = holland_wind_speed(r, dp, rmax, B, 25.0)
    ok_decay = bool(np.all(np.diff(prof[1:]) < 0)) and bool(prof[0] > 0)
    ok_B = 1.0 <= B <= 2.5
    ib_m = 100.0 / (RHO_WATER * G)  # 1 hPa in metres of seawater
    ok_ib = 0.009 < ib_m < 0.011    # ≈ 1 cm/hPa
    q75 = float(scs_cn_runoff_cum(np.array([100.0]), np.array([75.0]))[0])
    ok_cn = 30.0 < q75 < 50.0       # TR-55: CN75, P=100 mm → Q≈41 mm
    q0 = float(scs_cn_runoff_cum(np.array([10.0]), np.array([75.0]))[0])
    ok_cn_init = q0 == 0.0  # 10 mm < 0.2·S(CN75)=16.9 mm
    h_small = float(smb_wave_height(np.array([50.0]), np.array([1.0e5]))[0])
    h_big = float(smb_wave_height(np.array([50.0]), np.array([4.0e5]))[0])
    ok_wave = h_big > h_small > 5.0  # Cat-4 seas: observed H_s ~15-20 m
    ua20 = 0.71 * 20.0
    h_cap = float(smb_wave_height(np.array([20.0]), np.array([1.0e9]))[0])
    ok_cap = abs(h_cap - PM_LIMIT * ua20 * ua20) < 1e-6
    # Rainfall (Lonfat 2007 structure): zero in the eye, peak in the inner
    # core, zero at the 500-km footprint edge, peak rate in the observed
    # hurricane band (Cat-4 ~ 50-120 mm/h).
    rr_eye = float(lonfat_rain_rate(np.array([0.0]), vmax, rmax)[0])
    rr_peak = float(lonfat_rain_rate(np.array([max(RAIN_PEAK_RADIUS_KM, rmax)]), vmax, rmax)[0])
    rr_edge = float(lonfat_rain_rate(np.array([RAIN_EXTENT_KM]), vmax, rmax)[0])
    rr_far = float(lonfat_rain_rate(np.array([RAIN_EXTENT_KM + 50.0]), vmax, rmax)[0])
    ok_rain = (rr_eye == 0.0 and rr_far == 0.0 and rr_edge == 0.0
               and 40.0 <= rr_peak <= 130.0)
    passed = all([ok_vmax, ok_decay, ok_B, ok_ib, ok_cn, ok_cn_init,
                  ok_wave, ok_cap, ok_rain])
    print(f"[VERIFY] Hurricane physics: B={B:.2f} V(Rmax)={v_at_rmax:.1f} m/s "
          f"(target {vmax:.0f}) | IB={ib_m*100:.2f} cm/hPa | CN75@100mm={q75:.1f} mm | "
          f"waves {h_small:.1f}→{h_big:.1f} m cap {h_cap:.2f} m | "
          f"rain peak={rr_peak:.0f}mm/h eye={rr_eye:.0f} edge={rr_edge:.0f} | "
          f"vmax={'OK' if ok_vmax else 'FAIL'} decay={'OK' if ok_decay else 'FAIL'} "
          f"B={'OK' if ok_B else 'FAIL'} ib={'OK' if ok_ib else 'FAIL'} "
          f"cn={'OK' if (ok_cn and ok_cn_init) else 'FAIL'} "
          f"wave={'OK' if (ok_wave and ok_cap) else 'FAIL'} "
          f"rain={'OK' if ok_rain else 'FAIL'} → "
          f"{'PASS' if passed else 'FAIL'}")
    return passed


def simulate_hurricane(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    category = int(params.get('category', 3))
    forward_speed = float(params.get('forward_speed_kmh', 30))
    central_pressure = float(params.get('central_pressure_hpa', 960))
    rmax_km = float(params.get('radius_max_wind_km', 50))
    duration_hours = float(params.get('duration_hours', 6))
    heading_deg = (None if params.get('heading_deg') is None
                   else float(params.get('heading_deg')))
    lat = float(params.get('lat', 25.0))
    lon = float(params.get('lon', -80.0))

    # Saffir–Simpson thresholds (NHC): Cat 1 ≥ 43 m/s … Cat 5 ≥ 70 m/s
    cat_winds = {1: 43, 2: 50, 3: 58, 4: 70, 5: 90}
    vmax = float(cat_winds.get(category, 58))
    dp_hpa = max(1013.0 - central_pressure, 5.0)
    B_holland = holland_B(dp_hpa, vmax)

    extent_km = float(params.get('extent_km', 0.0))
    dx_cell = (extent_km * 1000.0 / gs) if extent_km > 0 else CELL_SIZE_M

    # ── Terrain: real Cesium DEM when shipped, else synthetic profile ──
    terrain_source = 'synthetic'
    elev = load_real_terrain(params, gs)
    if elev is None:
        elev = generate_coastal_bathymetry(gs, cell_size_m=dx_cell)
    else:
        terrain_source = 'cesium_globe'
    b = elev                                   # bottom elevation [m], <0 = ocean
    water = b < 0.0
    # Still-water depth capped at 200 m: deep-ocean long waves are not
    # resolved (their surge is negligible); the cap keeps the CFL dt usable
    # on CPU. The IB equilibrium η=Δp/(ρg) is depth-independent, so the cap
    # does not bias the pressure response (H cancels in the steady balance).
    h_still = np.minimum(np.maximum(-b, 0.0), CFL_DEPTH_CAP_M)
    land = ~water

    # Storm track point (parsed BEFORE the heading block so auto-aim can target
    # it): the eye passes the pinned LANDFALL / TRACK-CENTER point
    # (track_frac_x/y, 0..1, x=east y=south — like the earthquake epicentre)
    # at mid-duration, then continues along the heading. Defaults to the grid
    # centre (0.5,0.5) when not pinned, so the landfall geometry is centred in
    # the study box.
    track_fx = min(1.0, max(0.0, float(params.get('track_frac_x', 0.5))))
    track_fy = min(1.0, max(0.0, float(params.get('track_frac_y', 0.5))))
    track_col = track_fx * (gs - 1)
    track_row = track_fy * (gs - 1)

    # Default track heading: approach the track/landfall point FROM THE WATER
    # SIDE — direction from the water centroid toward the pinned point — so the
    # scenario is a genuine LANDFALL for any coastline orientation and the eye
    # arrives over open water (the old centroid-only aim ignored the pinned
    # point; the old fixed 270° default ran the storm backwards off the
    # synthetic coast). An explicit heading_deg always wins.
    if heading_deg is None:
        if land.any() and water.any():
            wc = np.argwhere(water).mean(axis=0)   # (row, col) of water centroid
            de = track_col - wc[1]
            dn = wc[0] - track_row                 # row 0 = north
            heading_deg = float(np.degrees(np.arctan2(de, dn)) % 360.0)
        else:
            heading_deg = 270.0

    # ── Time step from the CFL condition on the capped depth field ──
    c_max = np.sqrt(G * max(h_still.max(), 5.0))
    dt = float(params.get('dt_s', 0.4 * dx_cell / c_max))
    dt = float(np.clip(dt, 5.0, 300.0))
    total_steps = int(duration_hours * 3600 / dt)
    snap_interval = max(1, total_steps // 20)

    # ── Fetch (max possible, distance to coast over water) ──
    fetch_m = np.zeros((gs, gs), dtype=np.float64)
    if water.any():
        d_cells = distance_to_coast(water) * dx_cell
        fetch_m[water] = d_cells[water]

    # ── State variables (full-domain SWE with wetting/drying) ──
    # Prognostic is the water DEPTH h (the conserved variable); the free
    # surface is η = b + h. Averaging h — not η — at the shoreline is what
    # lets a surge climb onto dry land (η-averaging can never lift a dry
    # cell above its ground elevation). Over land h>0 ⇔ flooding, depth h.
    h = np.zeros((gs, gs), dtype=np.float64)
    h[water] = h_still[water]                  # start at still-water depth
    uE = np.zeros((gs, gs - 1), dtype=np.float64)   # east-face velocity [m/s]
    vS = np.zeros((gs - 1, gs), dtype=np.float64)   # south-face velocity [m/s]
    rainfall_mm = np.zeros((gs, gs), dtype=np.float64)
    runoff_mm = np.zeros((gs, gs), dtype=np.float64)
    cn_map = np.full((gs, gs), CN_SUBURBAN, dtype=np.float64)
    cn_map[water] = CN_WATER

    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')

    storm_speed_ms = forward_speed / 3.6
    hdg = np.radians(heading_deg)
    v_east = storm_speed_ms * np.sin(hdg)   # m/s, +east
    v_north = storm_speed_ms * np.cos(hdg)  # m/s, +north

    # Back-project the initial centre so the eye is exactly on the pinned
    # track point at mid-duration (cx(T/2) = track_col, cy(T/2) = track_row).
    half_t = duration_hours * 3600.0 / 2.0
    cx0 = track_col - v_east * half_t / dx_cell
    cy0 = track_row + v_north * half_t / dx_cell

    # Open-boundary sponge: relax surge (h − h_still) and face velocities
    # toward zero within the
    # outer edge cells so wind-driven pile-up drains off the domain instead
    # of reflecting into a trapped seiche (SLOSH uses open boundaries too).
    edge = max(6, gs // 16)
    sx = np.minimum(x, gs - 1 - x)
    sy = np.minimum(y, gs - 1 - y)
    d_edge = np.minimum(sx, sy)
    relax = np.where(d_edge < edge, 0.25 * (1.0 - d_edge / edge), 0.0)

    print(f"\n{'='*60}")
    print("TERRANOETIS — 2D HURRICANE: HOLLAND WIND + SWE SURGE + WAVES + RAIN")
    print(f"{'='*60}")
    print(f"Cat {category} | Vmax={vmax} m/s | pc={central_pressure} hPa | "
          f"B={B_holland:.2f} | Rmax={rmax_km} km | grid={gs}x{gs} @ {dx_cell:.0f} m")
    print(f"Forward: {forward_speed} km/h @ {heading_deg:.0f}° | duration {duration_hours} h | "
          f"dt={dt:.0f}s × {total_steps} steps | terrain: {terrain_source}")

    wallclock_max = float(params.get('wallclock_max_sec', 480))
    wind_speed = np.zeros((gs, gs))
    wind_dir = np.zeros((gs, gs))
    setup = np.zeros((gs, gs))
    wave_h = np.zeros((gs, gs))
    snapshots = []

    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at step {step_i} "
                  f"(elapsed {time.time()-t0:.0f}s)")
            break
        t = step_i * dt
        time_h = t / 3600.0

        # ── Storm center: translates along heading, crosses center at mid-run ──
        # row 0 = north → northward motion decreases the row index.
        cx = cx0 + v_east * t / dx_cell
        cy = cy0 - v_north * t / dx_cell

        # ── Holland wind (gradient) + vectorial translation asymmetry ──
        dxm = (x - cx) * dx_cell          # metres east of center
        dym = (cy - y) * dx_cell          # metres north of center (row 0 = N)
        r_m = np.sqrt(dxm * dxm + dym * dym)
        r_km = np.maximum(r_m / 1000.0, 0.1)
        v_grad = holland_wind_speed(r_km, dp_hpa, rmax_km, B_holland, lat)
        # Cyclonic (NH) tangential unit vector: (-sinθ, cosθ) with θ the
        # azimuth from the center (0 = east, CCW positive).
        sin_t = np.where(r_m > 0, dym / np.maximum(r_m, 1.0), 0.0)
        cos_t = np.where(r_m > 0, dxm / np.maximum(r_m, 1.0), 0.0)
        u_east = -v_grad * sin_t + v_east   # gradient wind + translation
        u_north = v_grad * cos_t + v_north
        wind_speed = np.sqrt(u_east * u_east + u_north * u_north)
        wind_dir = np.arctan2(u_north, u_east)

        # ── Pressure field (Holland 1980) ──
        pressure = holland_pressure_radial(r_km, central_pressure, dp_hpa,
                                           rmax_km, B_holland)

        # ── Waves: JONSWAP/SMB growth, depth-limited breaking, setup ──
        wave_h = smb_wave_height(wind_speed, fetch_m)
        h_break = np.minimum(wave_h, GAMMA_BREAKER * np.maximum(h, 0.0))
        setup = np.where(water, K_SETUP * h_break, 0.0)

        # ── SWE step (staggered Arakawa-C grid, upwind face fluxes) ──
        # Conservative in h: no LF averaging of depth across the shoreline
        # (that created phantom flood water on land). Velocities live on cell
        # faces; fluxes use the UPWIND depth so dry cells never receive or
        # emit water. This is the standard simple-SWE wetting/drying scheme.
        eta = b + h                            # free surface everywhere
        wet = h > 0.05
        # Depth in the forcing terms, capped at the CFL reference depth:
        # uncapped 4000 m cells would need dt ≤ 4 s (√(g·4000)=198 m/s wave
        # celerity → CFL violation → basin seiche). The IB equilibrium
        # η=Δp/(ρg) is depth-independent (H cancels), so the cap does not
        # bias the pressure response; deep-water wind setup is negligible
        # for coastal surge. Documented in metadata.limits.
        H = np.minimum(np.maximum(h, 0.1), CFL_DEPTH_CAP_M)

        # Cell-centered forcing accelerations (applied at faces below).
        # Quadratic wind stress τ = ρ_a·C_d·|U|·U → column acceleration
        # τ/(ρ_w·H) with a 1 m minimum depth (SLOSH-style stress floor).
        # Wind stress and pressure gradient act over WATER only
        # (SLOSH/ADCIRC convention — land roughness blocks the stress).
        tau_mag = RHO_AIR * C_DRAG * wind_speed * wind_speed
        wx = np.where(r_m > 0, u_east / np.maximum(wind_speed, 1e-6), 0.0)
        wy = np.where(r_m > 0, u_north / np.maximum(wind_speed, 1e-6), 0.0)
        H_stress = np.maximum(H, 1.0)
        a_wx = np.where(wet & water, tau_mag * wx / (RHO_WATER * H_stress), 0.0)
        a_wy = np.where(wet & water, tau_mag * wy / (RHO_WATER * H_stress), 0.0)
        p_pa = pressure * 100.0
        dpdx = (np.roll(p_pa, -1, 1) - np.roll(p_pa, 1, 1)) / (2.0 * dx_cell)
        dpdy = (np.roll(p_pa, -1, 0) - np.roll(p_pa, 1, 0)) / (2.0 * dx_cell)
        a_px = np.where(wet & water, -dpdx / RHO_WATER, 0.0)
        a_py = np.where(wet & water, -dpdy / RHO_WATER, 0.0)

        fx = a_wx + a_px
        fy = a_wy + a_py

        # East faces (gs, gs−1): between columns j and j+1.
        gE = (eta[:, 1:] - eta[:, :-1]) / dx_cell
        fE = 0.5 * (fx[:, 1:] + fx[:, :-1])
        # South faces (gs−1, gs): between rows i and i+1 (row+1 = south).
        gS = (eta[1:, :] - eta[:-1, :]) / dx_cell
        fS = 0.5 * (fy[1:, :] + fy[:-1, :])

        uE = uE + dt * (-G * gE + fE)
        vS = vS + dt * (-G * gS + fS)

        # Upwind face depths; Manning friction (damping-limited so it can
        # never reverse the flow) and a 10 m/s physical current cap.
        hE = np.where(uE > 0, h[:, :-1], h[:, 1:])
        hS = np.where(vS > 0, h[:-1, :], h[1:, :])
        afE = np.clip(-G * N_MANING**2 * np.abs(uE) * uE
                      / np.power(np.maximum(hE, 1.0), 4.0 / 3.0),
                      -0.9 * np.abs(uE) / dt, 0.9 * np.abs(uE) / dt)
        afS = np.clip(-G * N_MANING**2 * np.abs(vS) * vS
                      / np.power(np.maximum(hS, 1.0), 4.0 / 3.0),
                      -0.9 * np.abs(vS) / dt, 0.9 * np.abs(vS) / dt)
        uE = np.clip(uE + dt * afE, -10.0, 10.0)
        vS = np.clip(vS + dt * afS, -10.0, 10.0)
        uE = np.where(hE > 0.05, uE, 0.0)
        vS = np.where(hS > 0.05, vS, 0.0)

        # Flux divergence (zero flux at domain walls) → conservative update.
        FE = hE * uE
        FS = hS * vS
        div = np.zeros((gs, gs), dtype=np.float64)
        div[:, :-1] += FE / dx_cell
        div[:, 1:] -= FE / dx_cell
        div[:-1, :] += FS / dx_cell
        div[1:, :] -= FS / dx_cell
        h_new = h - dt * div
        # Depth: non-negative, at most 10 m above the still-water surface.
        h = np.clip(np.nan_to_num(h_new), 0.0, h_still + 10.0)
        # Open-boundary sponge (see setup): drain edge pile-up to still water.
        r_ = 1.0 - relax
        h = h_still + (h - h_still) * r_
        uE *= 0.5 * (r_[:, 1:] + r_[:, :-1])
        vS *= 0.5 * (r_[1:, :] + r_[:-1, :])

        # ── Rainfall (Lonfat et al. 2007 PHRaM radial structure) ──
        rain_rate = lonfat_rain_rate(r_km, vmax, rmax_km)
        rainfall_mm += rain_rate * dt / 3600.0

        # ── SCS-CN incremental runoff (vectorized — no per-cell loops) ──
        q_cum = scs_cn_runoff_cum(rainfall_mm, cn_map)
        runoff_inc = np.maximum(q_cum - runoff_mm, 0.0)
        runoff_mm = np.where(cn_map < CN_WATER, q_cum, 0.0)
        # Pluvial ponding: runoff deepens the water column on land; the SWE
        # then drains it downhill (no arbitrary scaling factors).
        h += np.where(land, runoff_inc / 1000.0, 0.0)

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            total_water = np.where(water, b + h + setup, h)
            snapshots.append({
                'wind': wind_speed.astype(np.float32),
                'surge': total_water.astype(np.float32),
                'time_h': round(time_h, 2),
            })
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                pct = (step_i + 1) / total_steps * 100
                print(f"  [{pct:5.1f}%] t={time_h:.1f}h | wind={wind_speed.max():.1f} m/s | "
                      f"water={total_water.max():.2f} m | rain={rainfall_mm.max():.0f} mm | "
                      f"runoff={runoff_mm.max():.0f} mm")

    elapsed = time.time() - t0

    # ── Final fields ──
    flood_depth = h                            # water above ground, any cell
    eta_final = b + h                          # free surface
    # Standard surge product: water level (η + setup) over the ocean,
    # inundation depth over land (NHC/USGS composite convention).
    water_level = np.where(water, eta_final + setup, 0.0)
    total_surge_field = np.where(water, water_level, flood_depth)
    inundation = np.where(land, flood_depth, 0.0)
    wet_land = inundation > 0.05

    max_wind = float(wind_speed.max())
    max_water = float(water_level.max())
    max_inund = float(inundation.max())
    print(f"\n[DONE] {elapsed:.1f}s | wind={max_wind:.1f} m/s | "
          f"coastal water={max_water:.2f} m | inundation={max_inund:.2f} m | "
          f"rain={rainfall_mm.max():.0f} mm | runoff={runoff_mm.max():.0f} mm | "
          f"flooded land={int(wet_land.sum()):,} cells")

    return {'final': {
                'wind_speed': wind_speed.astype(np.float32),
                'wind_direction': wind_dir.astype(np.float32),
                'surge_height': total_surge_field.astype(np.float32),
                'wave_setup': setup.astype(np.float32),
                'wave_height': wave_h.astype(np.float32),
                'rainfall': rainfall_mm.astype(np.float32),
                'runoff': runoff_mm.astype(np.float32),
                'inundation': inundation.astype(np.float32),
                'terrain': elev.astype(np.float32),
                'max_wind_ms': max_wind,
                'max_surge_m': max_water,
                'max_inundation_m': max_inund,
                'max_rainfall_mm': float(rainfall_mm.max()),
                'max_runoff_mm': float(runoff_mm.max()),
                'max_wave_height_m': float(wave_h.max()),
                'inundation_area_cells': int(wet_land.sum()),
                'cat': category,
            },
            'snapshots': snapshots,
            'params': {'grid_size': gs, 'category': category,
                       'forward_speed_kmh': forward_speed, 'heading_deg': heading_deg,
                       'central_pressure_hpa': central_pressure,
                       'radius_max_wind_km': rmax_km, 'duration_hours': duration_hours,
                       'lat': lat, 'lon': lon, 'cell_size_m': dx_cell,
                       'holland_B': B_holland, 'vmax_ms': vmax,
                       'track_frac_x': track_fx, 'track_frac_y': track_fy},
             'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                          'model': 'holland_1980_wind + nonlinear_2d_swe_surge',
                          'physics': 'holland_gradient_wind, swe_windstress_pressure_manning, '
                                     'jonswap_smb_waves_usace_eqII424_setup, '
                                     'lonfat2007_phram_structure_rain, scs_cn_tr55_runoff',
                          'sources': 'Holland 1980 (MWR 108:1212); Large & Pond 1981 '
                                     '(JPO 11:324); USACE CEM EM 1110-2-1100 Pt II; '
                                     'Lonfat et al. 2007 (MWR 135:3086); USDA TR-55',
                          'terrain_source': terrain_source,
                          'limits': [
                              'point-vortex Holland field — no eyewall fine structure, '
                              'constant Vmax (no intensification/decay)',
                              'fetch = distance to nearest coast (upper-bound proxy)',
                              'wave setup empirical (USACE Eq II-4-24, ≈0.19·H_b) — '
                              'no wave propagation',
                              'rainfall parametric surrogate of the Lonfat-2007 PHRaM '
                              'radial structure (no shear/topography Fourier terms), '
                              'not microphysical',
                              'no tides, no river routing (backwater excluded)',
                              'equirectangular grid — valid ≤ ~500 km domain',
                          ]}}


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
    print("TERRANOETIS — 2D Hurricane Wind & Surge Simulation")
    print("=" * 60)
    out = os.environ.get('TERRANOETIS_OUT_DIR', '/kaggle/working')
    params = _load_params()
    if params is None:
        params = {'grid_size': 256, 'category': 3, 'forward_speed_kmh': 30,
                  'central_pressure_hpa': 960, 'radius_max_wind_km': 50,
                  'duration_hours': 6, 'lat': 25.0, 'lon': -80.0}
    try:
        if not verify_hurricane_physics():
            raise RuntimeError(
                "Hurricane physics gate failed — refusing to emit fields from "
                "mis-wired parametric relations.")
        result = simulate_hurricane(params)
        os.makedirs(out, exist_ok=True)
        f = result['final']
        np.save(f'{out}/wind_speed.npy', f['wind_speed'])
        np.save(f'{out}/wind_direction.npy', f['wind_direction'])
        np.save(f'{out}/surge_height.npy', f['surge_height'])
        np.save(f'{out}/wave_setup.npy', f['wave_setup'])
        np.save(f'{out}/wave_height.npy', f['wave_height'])
        np.save(f'{out}/rainfall.npy', f['rainfall'])
        np.save(f'{out}/runoff.npy', f['runoff'])
        np.save(f'{out}/inundation.npy', f['inundation'])
        np.save(f'{out}/terrain.npy', f['terrain'])
        if result['snapshots']:
            np.save(f'{out}/snapshots_wind.npy',
                    np.stack([s['wind'] for s in result['snapshots']]))
            np.save(f'{out}/snapshots_surge.npy',
                    np.stack([s['surge'] for s in result['snapshots']]))
            np.save(f'{out}/snapshot_times.npy',
                    np.array([s['time_h'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_wind.npy',
                    np.expand_dims(f['wind_speed'], axis=0))
            np.save(f'{out}/snapshots_surge.npy',
                    np.expand_dims(f['surge_height'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {
                    'max_wind_ms': f['max_wind_ms'],
                    'max_surge_m': f['max_surge_m'],
                    'max_inundation_m': f['max_inundation_m'],
                    'max_rainfall_mm': f['max_rainfall_mm'],
                    'max_runoff_mm': f['max_runoff_mm'],
                    'max_wave_height_m': f['max_wave_height_m'],
                    'inundation_area_cells': f['inundation_area_cells'],
                    'category': f['cat']},
                'snapshot_count': len(result['snapshots']),
                'completed': True}
        with open(f'{out}/metadata.json', 'w') as fp:
            json.dump(_json_safe(meta), fp, indent=2)
        print(f"\n{'='*60}\nSIMULATION COMPLETE\n{'='*60}")
        print(f"Files: {sorted(os.listdir(out))}")
    except Exception as e:
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
        try:
            os.makedirs(out, exist_ok=True)
            with open(f'{out}/error.log', 'w') as fp:
                traceback.print_exc(file=fp)
        except Exception:
            pass
        raise


if __name__ == '__main__':
    main()
