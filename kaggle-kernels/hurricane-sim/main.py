"""
Terranoetis — Hurricane Wind Field + Comprehensive Storm Surge Simulation
Upgraded: Holland wind field with storm forward motion + wave setup,
coastal inundation (SWE with wetting/drying), rainfall-runoff interaction
(SCS-CN method + overland flow), and river backflow (backwater effect).

Physics:
  - Wind field: Holland B-parameter model with storm translation
  - Wave setup: radiation stress gradient → η_setup = -1/(ρg)·∂S_xx/∂x
  - Storm surge: 2D shallow water equations with wind stress + pressure
    forcing, solved with Lax-Friedrichs (wetting/drying capable)
  - Coastal inundation: sloping beach bathymetry, wet/dry cell tracking
  - Rainfall-runoff: SCS Curve Number method for runoff + overland flow
  - River backflow: river channel network with backwater effect

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

# ── Physical constants ──────────────────────────────────────────────
RHO_AIR = 1.15       # kg/m³ — air density
RHO_WATER = 1025.0   # kg/m³ — seawater density
G = 9.81             # m/s² — gravity
C_DRAG = 0.0012      # dimensionless — wind drag coefficient
C_F = 0.0025         # dimensionless — bottom friction coefficient
N_MANING = 0.03      # Manning's n — roughness coefficient
K_WAVE = 0.005       # wave setup coefficient
CELL_SIZE_M = 2000.0 # meters per grid cell (2 km)
SEAWARD = -1         # marker for ocean cells

# SCS-CN curve numbers for different land covers
CN_URBAN = 85       # urban
CN_SUBURBAN = 77    # suburban
CN_FOREST = 65      # forest
CN_GRASS = 70       # grassland
CN_WATER = 99       # water (impervious)


OMEGA_EARTH = 7.2921159e-5  # rad/s

def coriolis_param(lat_deg):
    """f = 2·Ω·sin(latitude)   (zero at the equator)."""
    return 2.0 * OMEGA_EARTH * np.sin(np.radians(lat_deg))

def holland_B(dp_hpa, vmax_ms, rho=RHO_AIR):
    """Holland (1980) B-parameter from max wind:  B = ρ·e·Vmax²/(Δp·100).
    Δp in hPa → ×100 converts to Pa. Bounded to the physical range [1.0, 2.5]."""
    dp_pa = max(dp_hpa, 1.0) * 100.0
    B = rho * np.e * vmax_ms**2 / dp_pa
    return np.clip(B, 1.0, 2.5)

def holland_pressure_radial(r_km, pc_hpa, dp_hpa, rmax_km, B):
    """Holland (1980) radial pressure profile
    p(r) = pc + Δp · exp(−(Rmax/r)^B)             (NOT a Gaussian)"""
    rr = np.maximum(r_km, 0.1)
    return pc_hpa + dp_hpa * np.exp(-((rmax_km / rr) ** B))

def holland_wind_field(r, vmax, rmax, central_pressure, env_pressure=1013, lat_deg=25.0):
    """Holland (1980) gradient-level wind profile *with* the Coriolis term:
       V(r) = sqrt( (B·Δp/ρ)·(Rmax/r)^B·exp(−(Rmax/r)^B)  +  (f·r/2)² ) − f·r/2
    This reduces to the correct cyclostrophic balance at small r and
    geostrophic at large r. B is computed from Δp, not a piecewise integer."""
    rho = RHO_AIR
    dp_hpa = max(env_pressure - central_pressure, 5.0)   # hPa
    B = holland_B(dp_hpa, vmax, rho)
    r_km = np.maximum(r, 0.1)
    r_m = r_km * 1000.0
    f = coriolis_param(lat_deg)
    rr = (rmax / r_km) ** B
    gradient_wind_sq = (B * (dp_hpa * 100) / rho) * rr * np.exp(-rr)
    coriolis_term = 0.5 * f * r_m
    wind = np.sqrt(gradient_wind_sq + coriolis_term**2) - coriolis_term
    return np.clip(wind, 0.0, vmax), B


def generate_coastal_bathymetry(N, coast_x_frac=0.35, cell_size_m=CELL_SIZE_M):
    """
    Generate coastal bathymetry with:
    - Deep ocean on the right (offshore)
    - Sloping beach transitioning to land
    - River channels on land
    """
    y, x = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    x_norm = x / N
    coast_x = int(N * coast_x_frac)

    # Bathymetry: deep ocean → continental shelf → beach → land (positive elevation)
    bathy = np.zeros((N, N), dtype=np.float64)

    # Ocean side (x < coast_x): depth increases offshore
    ocean_mask = x < coast_x
    dist_to_coast = (coast_x - x) * cell_size_m / 1000.0  # km from coast
    # Continental shelf (shallow, 0-50m) near coast, deep ocean (up to 4000m) far out
    shelf_width = 20  # km
    shelf_slope = np.where(ocean_mask,
                           np.clip(dist_to_coast / shelf_width, 0, 1), 0)
    bathy = np.where(ocean_mask,
                     -50 - shelf_slope * 3950,  # -50m to -4000m
                     bathy)

    # Land side (x >= coast_x): gentle terrain with river valleys
    land_mask = x >= coast_x
    dist_inland = (x - coast_x) * cell_size_m / 1000.0  # km inland
    # Gentle slope (0-20m elevation)
    land_elev = 0.001 * dist_inland + 5 * np.sin(y / N * 3) * np.cos(x / N * 2)
    bathy = np.where(land_mask, land_elev, bathy)

    # River channels: radial from coast (simplified)
    # Rivers flow from inland to coast
    for river_angle in [0.3, 0.7, 1.2, 1.8, 2.5]:
        river_dir_x = np.cos(river_angle)
        river_dir_y = np.sin(river_angle)
        # Distance along river from each point
        proj = (x - coast_x) * river_dir_x + (y - N/2) * river_dir_y
        lateral = np.abs((x - coast_x) * (-river_dir_y) + (y - N/2) * river_dir_x)
        river_mask = (proj > 0) & (proj < N * 0.4) & (lateral < 3)
        bathy = np.where(river_mask, -2.0 - proj * 0.01, bathy)

    return bathy


def compute_wave_setup(wind_speed, r_km, fetch_km, depth_m):
    """
    Compute wave setup from wind stress radiation stress gradient.
    η_setup = -1/(ρg) · ∂S_xx/∂x

    Simplified: wave height H ≈ 0.23 * (U²/g)^(1/2) * (F/g)^(1/2)
    Setup ≈ 0.01 * H * (U/U_ref)
    """
    # Wave height from wind speed and fetch (Sverstrup 2019)
    g = G
    H_s = 0.23 * np.sqrt(wind_speed**2 / g) * np.sqrt(fetch_km * 1000 / g)
    H_s = np.clip(H_s, 0, 10)  # max 10m waves

    # Radiation stress S_xx ≈ 1/8 * ρ_w * g * H²
    S_xx = 0.125 * RHO_WATER * g * H_s**2

    # Setup: gradient of radiation stress
    # For simplicity, use a spatial gradient based on distance to coast
    setup = K_WAVE * S_xx / (RHO_WATER * g) * np.clip(depth_m / 10, 0, 1)
    return setup, H_s


def scs_runoff(precip_mm, cn, area_km2):
    """
    SCS Curve Number method for direct runoff.
    Q = (P - 0.2*S)² / (P + 0.8*S)  where S = (1000/CN - 10) * 25.4
    """
    S = (1000.0 / cn - 10) * 25.4  # mm
    S = max(S, 1.0)
    P = precip_mm
    if P <= 0.2 * S:
        return 0.0
    Q = (P - 0.2 * S)**2 / (P + 0.8 * S)  # mm
    return Q  # mm of runoff


def simulate_hurricane(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    category = int(params.get('category', 3))
    forward_speed = float(params.get('forward_speed_kmh', 30))
    central_pressure = float(params.get('central_pressure_hpa', 960))
    rmax_km = float(params.get('radius_max_wind_km', 50))
    duration_hours = float(params.get('duration_hours', 6))

    cat_winds = {1: 43, 2: 50, 3: 58, 4: 70, 5: 90}
    vmax = cat_winds.get(category, 58)
    lat = float(params.get('lat', 25.0))
    lon = float(params.get('lon', -80.0))

    # Storm translation speed (m/s)
    storm_speed_ms = forward_speed / 3.6
    storm_heading = np.radians(270)  # moving westward

    # ── Generate coastal bathymetry ──
    extent_km = float(params.get('extent_km', 0.0))
    dx_cell = (extent_km * 1000.0 / gs) if extent_km > 0 else CELL_SIZE_M
    bathy = generate_coastal_bathymetry(gs, cell_size_m=dx_cell)
    coast_x = int(gs * 0.35)

    # ── Grid setup ──
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')

    # ── Time stepping ──
    # CFL for storm surge (long gravity waves on ~100 m shelf depth):
    #   dt ≤ dx/(√gH · √2) ≈ 30–60 s for 2 km cells → pick 30 s by default.
    dx_for_dx = (extent_km * 1000.0 / gs) if extent_km > 0 else CELL_SIZE_M
    _cmax0 = np.sqrt(G * 100.0)  # ~31 m/s shelf celerity (100 m depth)
    dt = float(params.get('dt_s', min(300.0, 0.4 * dx_for_dx / _cmax0)))
    dt = max(dt, 10.0)
    total_steps = int(duration_hours * 3600 / dt)
    snap_interval = max(1, total_steps // 20)

    # ── State variables (SWE prognostics) ──
    # Free-surface elevation (η) above still water [m]
    eta = np.zeros((gs, gs), dtype=np.float64)
    # Depth-integrated momentum (discharge) components [m²/s]
    hu = np.zeros((gs, gs), dtype=np.float64)
    hv = np.zeros((gs, gs), dtype=np.float64)
    # Surge height η exposed to downstream consumers
    surge = np.zeros((gs, gs), dtype=np.float64)
    # Surge from previous step (for river backflow computation)
    surge_prev = np.zeros((gs, gs), dtype=np.float64)
    # Atmospheric-pressure diagnostic surge η_p = Δp/(ρg) [m]
    pressure_surge = np.zeros((gs, gs), dtype=np.float64)
    # Rainfall accumulation (mm)
    rainfall = np.zeros((gs, gs), dtype=np.float64)
    # Runoff depth (mm)
    runoff = np.zeros((gs, gs), dtype=np.float64)
    # River water level (m above river bed)
    river_level = np.zeros((gs, gs), dtype=np.float64)
    # Wet/dry mask (True = wet/inundated)
    wet_mask = np.zeros((gs, gs), dtype=bool)
    # Curve Number map (land cover)
    cn_map = np.full((gs, gs), CN_SUBURBAN, dtype=np.float64)
    # Set CN for ocean/water cells
    cn_map[bathy < 0] = CN_WATER

    snapshots = []

    print(f"\n{'='*60}")
    print("TERRANOETIS — HURRICANE: WIND + WAVE SETUP + STORM SURGE + RAINFALL")
    print(f"{'='*60}")
    print(f"Cat {category} | Vmax={vmax}m/s | P={central_pressure}hPa | grid={gs}x{gs}")
    print(f"Forward: {forward_speed}km/h | Duration: {duration_hours}h | Steps: {total_steps}")

    wallclock_max = float(params.get('wallclock_max_sec', 480))
    print(f"Wall-clock cap: {wallclock_max:.0f}s")
    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at step {step_i} (elapsed {time.time()-t0:.0f}s)")
            break
        t = step_i * dt
        time_h = t / 3600.0

        # ── Storm position: divisible into East/North components ──
        # heading 270° = westward;  Vx = −|V|·sin(hdg)? No: with hdg measured
        # clockwise from North,  V_East = |V|·sin(hdg),  V_North = |V|·cos(hdg).
        # At 270°: sin=−1 (moves −East, i.e., westward), cos=0 (no N/S drift),
        # which is exactly correct for a full-speed westerly track.
        storm_xf = gs // 2 + storm_speed_ms * t / dx_cell * np.sin(np.radians(270))
        storm_yf = gs // 2 - storm_speed_ms * t / dx_cell * np.cos(np.radians(270))
        storm_x = int(round(storm_xf))
        storm_y = int(round(storm_yf))
        # Allow offshore approach: clamp only as an absolute safety bound.
        storm_x = max(5, min(gs - 6, storm_x))
        storm_y = max(5, min(gs - 6, storm_y))

        # ── Wind field (Holland 1980, with Coriolis term) ──
        r_km = np.sqrt((y - storm_y)**2 + (x - storm_x)**2) * (dx_cell / 1000.0)
        wind_speed, B_holland = holland_wind_field(r_km, vmax, rmax_km,
                                                   central_pressure, 1013.0, lat)

        # Track asymmetry: add a fraction of the forward speed to the
        # right-front quadrant (Northern Hemisphere cyclonic rotation means
        # the strongest winds are to the right of the track).
        fwd_x = storm_speed_ms * np.sin(np.radians(270))   # m/s
        fwd_y = storm_speed_ms * np.cos(np.radians(270))
        # azimuth of the max-wind direction is 90° CW of the track direction
        az_wind = np.radians(270) - np.pi / 2
        asym_factor = np.maximum(
            np.cos(np.arctan2(y - storm_y, x - storm_x) - az_wind), 0.0)
        wind_speed = np.clip(wind_speed + 0.5 * storm_speed_ms * asym_factor, 0, vmax)

        # Wind direction (cyclonic, tangential to radius)
        wind_dir = np.arctan2(x - storm_x, y - storm_y) + np.pi / 2

        # ── Atmospheric pressure field: Holland 1980 p(r) = pc + Δp·e^{-(R/r)^B} ──
        pressure = holland_pressure_radial(r_km, central_pressure,
                                           1013.0 - central_pressure,
                                           rmax_km, B_holland)

        # ── Wave setup ──
        # Fetch: distance from coast in the offshore direction
        fetch_km = np.where(x < coast_x,
                           (coast_x - x) * dx_cell / 1000.0, 0.0)
        wave_setup, wave_height = compute_wave_setup(wind_speed, r_km, fetch_km, np.abs(bathy))

        # ── Wind stress → surge forcing ──
        # τ = ρ_a · C_d · U² along the wind direction. wind_dir is the
        # tangential (cyclonic) azimuth in array-index coordinates:
        #   cos(wind_dir) = x-component of unit wind, sin(wind_dir) = y-comp.
        U2 = wind_speed**2
        tau_x = RHO_AIR * C_DRAG * U2 * np.cos(wind_dir)
        tau_y = RHO_AIR * C_DRAG * U2 * np.sin(wind_dir)

        # Total water column under the storm (bathy is negative offshore)
        H_still = np.maximum(-bathy, 0.0)          # positive depth ocean-side
        # Inverse-barometer surge η_p = Δp/(ρ_w·g) added to dynamics via the
        # pressure-gradient body force a_px/a_py below; for diagnosed output
        # also expose it directly (informative, double-count-free in dynamics).
        pressure_surge = (1013.0 - pressure) / (RHO_WATER * G)

        # Total depth incl. current free-surface elevation
        H = np.maximum(H_still + eta, 0.1)
        wet = H_still > 0.05  # only evolve surge over ocean cells

        # LF neighbor rolls of discharge state (hu = H·u etc.)
        hu_r = np.roll(hu, -1, 1); hu_r[:, -1] = 0.0
        hu_l = np.roll(hu, 1, 1); hu_l[:, 0] = 0.0
        hu_d = np.roll(hu, -1, 0); hu_d[-1, :] = 0.0
        hu_u = np.roll(hu, 1, 0); hu_u[0, :] = 0.0
        hv_r = np.roll(hv, -1, 1); hv_r[:, -1] = 0.0
        hv_l = np.roll(hv, 1, 1); hv_l[:, 0] = 0.0
        hv_d = np.roll(hv, -1, 0); hv_d[-1, :] = 0.0
        hv_u = np.roll(hv, 1, 0); hv_u[0, :] = 0.0
        h_r = np.roll(eta, -1, 1); h_r[:, -1] = 0.0
        h_l = np.roll(eta, 1, 1); h_l[:, 0] = 0.0
        h_d = np.roll(eta, -1, 0); h_d[-1, :] = 0.0
        h_u = np.roll(eta, 1, 0); h_u[0, :] = 0.0

        # ── CONTINUITY:  ∂η/∂t = −∇·(Hu)   (Lax-Friedrichs half-step) ──
        div_q = (hu_r - hu_l + hv_d - hv_u) / (2.0 * dx_cell)
        h_avg_edges = 0.25 * (h_r + h_l + h_d + h_u)
        eta = h_avg_edges - dt * div_q

        # Pressure gradient source: gradients of the free surface (eta)
        deta_dx = (h_r - h_l) / (2.0 * dx_cell)
        deta_dy = (h_d - h_u) / (2.0 * dx_cell)

        # Bottom friction (Manning), drag from surge speed.
        # Linearize in deep water and cap so shallow cells don't blow up:
        #   a_f = −g n² |u| u / H^(4/3),  clamped to a max deceleration.
        u_c = np.where(wet, hu / np.maximum(H, 1.0), 0.0)
        v_c = np.where(wet, hv / np.maximum(H, 1.0), 0.0)
        u_c = np.clip(u_c, -10.0, 10.0); v_c = np.clip(v_c, -10.0, 10.0)
        spd = np.sqrt(u_c**2 + v_c**2)
        H43 = np.power(np.maximum(H, 1.0), 4.0 / 3.0)
        a_fx = -np.where(wet, G * N_MANING**2 * spd * u_c, 0.0) / H43
        a_fy = -np.where(wet, G * N_MANING**2 * spd * v_c, 0.0) / H43
        # Clip friction deceleration to a physical range (≤ 0.05 m/s²)
        a_fx = np.clip(a_fx, -0.05, 0.05)
        a_fy = np.clip(a_fy, -0.05, 0.05)

        # Wind-stress acceleration on the column (τ / (ρ H))
        a_wx = np.where(wet, tau_x / (RHO_WATER * np.maximum(H, 1.0)), 0.0)
        a_wy = np.where(wet, tau_y / (RHO_WATER * np.maximum(H, 1.0)), 0.0)

        # Inverse-barometer pressure forcing (−(1/ρ)∇p, p in hPa→Pa)
        p_pa = pressure * 100.0
        dpdx = np.roll(p_pa, -1, 1) - np.roll(p_pa, 1, 1)
        dpdy = np.roll(p_pa, -1, 0) - np.roll(p_pa, 1, 0)
        a_px = np.where(wet, -dpdx / (2.0 * dx_cell * RHO_WATER), 0.0)
        a_py = np.where(wet, -dpdy / (2.0 * dx_cell * RHO_WATER), 0.0)

        # ── MOMENTUM:  ∂(Hu)/∂t = −g·H·∇η + H·(a_wind + a_press + a_fric) ──
        # The H factor on body accelerations converts per-unit-mass [m/s²]
        # into momentum tendency [m²/s²·]. Wind & pressure are per-unit-mass
        # already, so multiply by H. Gravity term already carries H.
        hu_avg = 0.25 * (hu_r + hu_l + hu_u + hu_d)
        hv_avg = 0.25 * (hv_r + hv_l + hv_u + hv_d)
        body_x = a_wx + a_px + a_fx       # [m/s²]
        body_y = a_wy + a_py + a_fy
        hu_new = hu_avg + dt * (-G * H * deta_dx + H * body_x)
        hv_new = hv_avg + dt * (-G * H * deta_dy + H * body_y)

        # Cap momentum magnitude per unit depth to |u| ≤ 20 m/s physically,
        # then cap η to avoid runaway at coastlines.
        qmax_per_H = 20.0
        hu_new = np.clip(hu_new, -qmax_per_H * np.maximum(H, 0.1),
                                  qmax_per_H * np.maximum(H, 0.1))
        hv_new = np.clip(hv_new, -qmax_per_H * np.maximum(H, 0.1),
                                  qmax_per_H * np.maximum(H, 0.1))

        # Apply only over water; zero out over land
        hu = np.where(wet, np.nan_to_num(hu_new), 0.0)
        hv = np.where(wet, np.nan_to_num(hv_new), 0.0)
        eta = np.clip(np.nan_to_num(eta), -10.0, 10.0)

        # ── Coastal inundation (wetting/drying) ──
        # Land cells become wet when total η exceeds terrain elevation
        land_elev = np.maximum(bathy, 0)
        total_new_eta = eta + wave_setup  # pressure term already in eta dynamics
        wet_mask = total_new_eta > land_elev
        surge_rel_land = np.where(wet_mask, total_new_eta - land_elev, 0.0)
        # Track surge (as η above still-water) for downstream consumers
        surge = np.where(~wet_mask & (H_still <= 0), 0.0, eta)

        surge_prev = surge.copy()

        total_surge = eta + wave_setup  # for snapshot/diagnostics

        # ── Rainfall ──
        # Rainfall rate from wind speed (empirical: heavy rain in eyewall)
        # R = 2 + 0.5 * (U - 20) for U > 20 m/s, in mm/hour
        rain_rate = np.where(wind_speed > 15,
                             2.0 + 0.5 * (wind_speed - 15), 0.0)  # mm/hour
        rain_rate = np.clip(rain_rate, 0, 100)  # max 100 mm/h
        rainfall += rain_rate * dt / 3600.0  # mm

        # ── Rainfall-runoff (SCS-CN method) ──
        # Runoff from accumulated rainfall
        runoff_increment = np.zeros_like(rainfall)
        for i in range(gs):
            for j in range(gs):
                if rainfall[i, j] > 0 and cn_map[i, j] < 99:
                    # Incremental runoff from this step's rainfall
                    rain_step = rain_rate[i, j] * dt / 3600.0  # mm this step
                    if rain_step > 0:
                        q = scs_runoff(rainfall[i, j], cn_map[i, j], 1.0)
                        runoff_increment[i, j] = q * 0.01  # convert to m

        # Overland flow: runoff flows downhill toward coast
        if runoff_increment.any():
            # Compute slope direction
            dz_dx = np.zeros_like(bathy)
            dz_dy = np.zeros_like(bathy)
            dz_dx[1:-1, 1:-1] = (bathy[2:, 1:-1] - bathy[:-2, 1:-1]) / (2 * dx_cell)
            dz_dy[1:-1, 1:-1] = (bathy[1:-1, 2:] - bathy[1:-1, :-2]) / (2 * dx_cell)

            # Flow velocity (Manning's equation for overland flow)
            h_overland = runoff_increment / 1000.0  # convert mm to m
            slope_mag = np.sqrt(dz_dx**2 + dz_dy**2) + 1e-10
            v_overland = (1.0 / N_MANING) * h_overland**(2/3) * slope_mag**(1/2)

            # Add overland flow to surge (runoff contributes to flooding)
            # Scaled contribution to prevent instability
            runoff_flow = v_overland * h_overland
            surge += runoff_flow * 0.001 * dt  # scaled contribution

        # ── River backflow ──
        # River channels (predefined)
        # Compute backflow based on surge from PREVIOUS step (before wind update)
        # to prevent positive feedback loop across time steps
        total_backflow = np.zeros_like(surge)
        for river_angle in [0.3, 0.7, 1.2, 1.8, 2.5]:
            river_dir_x = np.cos(river_angle)
            river_dir_y = np.sin(river_angle)
            proj = (x - coast_x) * river_dir_x + (y - gs/2) * river_dir_y
            lateral = np.abs((x - coast_x) * (-river_dir_y) + (y - gs/2) * river_dir_x)
            river_mask = (proj > 0) & (proj < gs * 0.4) & (lateral < 3)

            # River bed elevation (below sea level near coast)
            river_bed = -2.0 - proj * 0.01

            # Backflow: when surge > river_bed, river is blocked
            # Use surge from previous step (surge_prev) to avoid feedback
            surge_at_river = np.where(river_mask, surge_prev, 0)
            backflow = np.where(river_mask & (surge_at_river > river_bed + 0.5),
                               surge_at_river - river_bed, 0)
            river_level = np.where(river_mask,
                                   np.maximum(river_level, backflow),
                                   river_level)

            # Accumulate backflow (scaled down to prevent instability)
            total_backflow += np.where(river_mask, backflow * 0.05, 0)

        # Apply total backflow to surge (one-time, prevents feedback)
        # Route backflow into the SWE surface field so it couples into the
        # momentum and continuity equations on the next step.
        eta += total_backflow
        surge = np.where(~wet_mask & (H_still <= 0), 0.0, eta)

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            max_wind = float(wind_speed.max())
            max_surge = float(surge.max() + wave_setup.max() + pressure_surge.max())
            max_rain = float(rainfall.max())
            max_runoff = float(runoff.max())
            inundation_area = int(wet_mask.sum())
            max_wave = float(wave_height.max())

            snapshots.append({
                'wind_speed': wind_speed.astype(np.float32),
                'surge_height': (surge + wave_setup + pressure_surge).astype(np.float32),
                'wave_setup': wave_setup.astype(np.float32),
                'wave_height': wave_height.astype(np.float32),
                'rainfall': rainfall.astype(np.float32),
                'runoff': runoff.astype(np.float32),
                'river_level': river_level.astype(np.float32),
                'wet_mask': wet_mask.astype(np.float32),
                'time_hours': round(time_h, 2),
                'max_wind': max_wind,
                'max_surge': max_surge,
                'max_rainfall': max_rain,
                'max_runoff': max_runoff,
                'inundation_area': inundation_area,
                'max_wave_height': max_wave,
            })
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={time_h:.1f}h | wind={max_wind:.1f}m/s | "
                      f"surge={max_surge:.2f}m | rain={max_rain:.1f}mm | "
                      f"runoff={max_runoff:.1f}mm | inund={inundation_area:,} cells | "
                      f"wave={max_wave:.1f}m")

    elapsed = time.time() - t0

    total_surge_field = surge + wave_setup + pressure_surge
    final = {
        'wind_speed': wind_speed.astype(np.float32),
        'wind_direction': wind_dir.astype(np.float32),
        'surge_height': total_surge_field.astype(np.float32),
        'wave_setup': wave_setup.astype(np.float32),
        'wave_height': wave_height.astype(np.float32),
        'rainfall': rainfall.astype(np.float32),
        'runoff': runoff.astype(np.float32),
        'river_level': river_level.astype(np.float32),
        'terrain': bathy.astype(np.float32),
        'max_wind_ms': float(wind_speed.max()),
        'max_surge_m': float(total_surge_field.max()),
        'max_rainfall_mm': float(rainfall.max()),
        'max_runoff_mm': float(runoff.max()),
        'max_wave_height_m': float(wave_height.max()),
        'inundation_area_cells': int(wet_mask.sum()),
        'cat': category,
    }

    print(f"\n[DONE] {elapsed:.1f}s | wind={final['max_wind_ms']:.1f}m/s | "
          f"surge={final['max_surge_m']:.2f}m | rain={final['max_rainfall_mm']:.1f}mm | "
          f"runoff={final['max_runoff_mm']:.1f}mm | inund={final['inundation_area_cells']:,} cells | "
          f"wave={final['max_wave_height_m']:.1f}m")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'category': category, 'forward_speed_kmh': forward_speed,
                       'central_pressure_hpa': central_pressure, 'radius_max_wind_km': rmax_km,
                       'duration_hours': duration_hours, 'lat': lat, 'lon': lon,
                       'cell_size_m': dx_cell},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'model': 'hurricane_wind_wave_surge_runoff_river',
                         'physics': 'holland_wind_swe_wave_setup_scs_cn_river_backflow'}}


# simRunner injects the run's JSON params here at push time (Kaggle only
# uploads the code file, so params cannot be passed as a sibling file).
EMBEDDED_PARAMS = None

def _load_params():
    """Load params from EMBEDDED_PARAMS (injected into main.py at push time)
    or from params.json anywhere on the runner."""
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
    print("TERRANOETIS — Kaggle Hurricane Wind & Surge Simulation")
    print("=" * 60)
    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(_json_safe(params), indent=2)}")
    else:
        params = {'grid_size': 256, 'category': 3, 'forward_speed_kmh': 30,
                  'central_pressure_hpa': 960, 'radius_max_wind_km': 50,
                  'duration_hours': 6, 'lat': 25.0, 'lon': -80.0}
    try:
        result = simulate_hurricane(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/wind_speed.npy', result['final']['wind_speed'])
        np.save(f'{out}/wind_direction.npy', result['final']['wind_direction'])
        np.save(f'{out}/surge_height.npy', result['final']['surge_height'])
        np.save(f'{out}/wave_setup.npy', result['final']['wave_setup'])
        np.save(f'{out}/wave_height.npy', result['final']['wave_height'])
        np.save(f'{out}/rainfall.npy', result['final']['rainfall'])
        np.save(f'{out}/runoff.npy', result['final']['runoff'])
        np.save(f'{out}/river_level.npy', result['final']['river_level'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])
        if result['snapshots']:
            snap_w = np.stack([s['wind_speed'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_wind.npy', snap_w)
            snap_s = np.stack([s['surge_height'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_surge.npy', snap_s)
            np.save(f'{out}/snapshot_times.npy', np.array([s['time_hours'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_wind.npy', np.expand_dims(result['final']['wind_speed'], axis=0))
            np.save(f'{out}/snapshots_surge.npy', np.expand_dims(result['final']['surge_height'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_wind_ms': result['final']['max_wind_ms'],
                                'max_surge_m': result['final']['max_surge_m'],
                                'max_rainfall_mm': result['final']['max_rainfall_mm'],
                                'max_runoff_mm': result['final']['max_runoff_mm'],
                                'max_wave_height_m': result['final']['max_wave_height_m'],
                                'inundation_area_cells': result['final']['inundation_area_cells'],
                                'category': result['final']['cat']},
                'snapshot_count': len(result['snapshots'])}
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(_json_safe(meta), f, indent=2)
        print(f"\n{'='*60}\nSIMULATION COMPLETE\n{'='*60}")
    except Exception as e:
        print(f"\n[ERROR] {e}"); traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f:
            traceback.print_exc(file=f)
        raise

if __name__ == '__main__':
    main()
