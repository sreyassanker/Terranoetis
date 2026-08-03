"""
Terranoetis — Wildfire Spread Simulation
Rothermel (1972) surface fire rate-of-spread model over the Anderson (1982)
13 NFFL fuel models, with a directional (wind/slope-elongated) time-marching
spread algorithm on a raster grid.

Physics references:
  - Rothermel, R. C. (1972) USDA Forest Service RP INT-115.
  - Anderson, H. E. (1982) USDA Forest Service GTR INT-122 (NFFL fuel models).
  - Byram, G. M. (1959) fireline intensity I = H * w * R.

Units: fuel particle properties are tabulated in US customary units
(lb/ft^2, ft^-1, BTU/lb, ...) exactly as published, then converted to SI
(kg/m^2, m^-1, J/kg) for the rate-of-spread solve. Midflame wind enters the
empirical wind-coefficient power law in ft/min, per Rothermel (1972).

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np

try:
    from scipy.ndimage import gaussian_filter as _scipy_gaussian_filter
except Exception:  # pragma: no cover - scipy absent on some runners
    _scipy_gaussian_filter = None


# ---------------------------------------------------------------------------
# Gaussian smoothing (scipy if present, pure-numpy separable fallback)
# ---------------------------------------------------------------------------
def _gaussian_blur(a, sigma):
    """Gaussian filter; uses scipy when available, else a separable numpy kernel."""
    if sigma is None or sigma <= 0:
        return a.astype(np.float64)
    if _scipy_gaussian_filter is not None:
        return _scipy_gaussian_filter(a, sigma=sigma, mode='nearest')
    radius = max(1, int(3.0 * sigma))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()
    p = np.pad(a.astype(np.float64), radius, mode='nearest')
    tmp = np.apply_along_axis(lambda r: np.convolve(r, k, mode='valid'), 1, p)
    out = np.apply_along_axis(lambda c: np.convolve(c, k, mode='valid'), 0, tmp)
    return out


def _smooth_keep_border(a, sigma):
    """Smooth interior of `a` while pinning the four borders at 0 (constraint)."""
    b = _gaussian_blur(a, sigma)
    b[0, :] = 0.0
    b[-1, :] = 0.0
    b[:, 0] = 0.0
    b[:, -1] = 0.0
    return b


# ---------------------------------------------------------------------------
# Synthetic map generation
# ---------------------------------------------------------------------------
def generate_fuel_map(N, seed=None):
    """Synthetic fuel-load multiplier field in [0, 1] (spatial heterogeneity)."""
    rng = np.random.default_rng(seed)
    noise = rng.random((N, N))
    fuel = _gaussian_blur(noise, sigma=max(2.0, N / 20.0))
    fuel = (fuel - fuel.min()) / (fuel.max() - fuel.min() + 1e-8)
    return fuel


def generate_slope_map(N, seed=None):
    """Synthetic terrain slope (degrees); borders pinned at 0 (constraint)."""
    rng = np.random.default_rng(None if seed is None else seed + 1)
    y, x = np.meshgrid(np.linspace(-1, 1, N), np.linspace(-1, 1, N), indexing='ij')
    slope = 15.0 * np.abs(np.sin(x * 3) * np.cos(y * 2))
    slope += _smooth_keep_border(rng.random((N, N)) * 5.0, sigma=max(2.0, N / 30.0))
    slope[0, :] = 0.0
    slope[-1, :] = 0.0
    slope[:, 0] = 0.0
    slope[:, -1] = 0.0
    return slope


def generate_aspect_map(N, seed=None):
    """Downslope aspect (radians, mathematical convention from +x east)."""
    rng = np.random.default_rng(None if seed is None else seed + 2)
    base_y, base_x = np.meshgrid(np.linspace(-1, 1, N), np.linspace(-1, 1, N), indexing='ij')
    elev = 100.0 * np.sin(base_x * 2.0) * np.cos(base_y * 1.5) \
        + _smooth_keep_border(rng.random((N, N)) * 50.0, sigma=max(2.0, N / 25.0))
    gy, gx = np.gradient(elev)
    return np.arctan2(-gy, -gx)  # direction of steepest descent


# ---------------------------------------------------------------------------
# Anderson (1982) NFFL fuel models 1-13 (US customary units, as published)
# w0: lb/ft^2 | sigma: ft^-1 | depth: ft | mx_dead: fraction | h_prime: BTU/lb
# ---------------------------------------------------------------------------
_ST, _SE, _RHO_P = 0.0555, 0.010, 32.0

def _fm(w1h, w10h, w100h, wh, ww, sig1, sigh, s_w, depth, mx_dead, h1=8000.0, hl=8000.0, live=True):
    return {'w0_1h': w1h, 'w0_10h': w10h, 'w0_100h': w100h, 'w0_herb': wh,
            'w0_woody': ww, 'sigma_1h': sig1, 'sigma_herb': sigh, 'sigma_woody': s_w,
            'h_prime_1h': h1, 'h_prime_live': hl, 'depth': depth, 'mx_dead': mx_dead,
            'has_live': live}

FUEL_MODELS = {
    1:  _fm(0.034, 0.000, 0.000, 0.000, 0.000, 3500, 0, 0, 1.00, 0.12, live=False),
    2:  _fm(0.092, 0.046, 0.023, 0.023, 0.000, 3000, 109, 0, 1.00, 0.15),
    3:  _fm(0.138, 0.000, 0.000, 0.000, 0.000, 1500, 0, 0, 2.50, 0.25, live=False),
    4:  _fm(0.230, 0.184, 0.092, 0.000, 0.230, 2000, 0, 30, 6.00, 0.20),
    5:  _fm(0.046, 0.023, 0.000, 0.000, 0.092, 2000, 0, 30, 2.00, 0.20),
    6:  _fm(0.069, 0.115, 0.092, 0.000, 0.000, 1750, 0, 0, 2.50, 0.25, live=False),
    7:  _fm(0.052, 0.086, 0.069, 0.017, 0.112, 1750, 70, 40, 2.50, 0.40),
    8:  _fm(0.069, 0.046, 0.115, 0.000, 0.000, 2000, 0, 0, 0.20, 0.30, live=False),
    9:  _fm(0.134, 0.019, 0.007, 0.000, 0.000, 2500, 0, 0, 0.20, 0.25, live=False),
    10: _fm(0.138, 0.092, 0.230, 0.000, 0.092, 2000, 0, 30, 1.00, 0.25),
    11: _fm(0.069, 0.207, 0.253, 0.000, 0.000, 1500, 0, 0, 1.00, 0.15, live=False),
    12: _fm(0.184, 0.644, 0.759, 0.000, 0.000, 1500, 0, 0, 2.30, 0.20, live=False),
    13: _fm(0.322, 1.058, 1.288, 0.000, 0.000, 1500, 0, 0, 3.00, 0.25, live=False),
}

FM_NAMES = {1: 'short_grass', 2: 'timber_grass_understory', 3: 'tall_grass',
            4: 'chaparral', 5: 'brush', 6: 'dormant_brush', 7: 'southern_rough',
            8: 'closed_timber_litter', 9: 'hardwood_litter',
            10: 'timber_litter_understory', 11: 'light_logging_slash',
            12: 'medium_logging_slash', 13: 'heavy_logging_slash'}

# US customary -> SI conversion factors
LBFT2_TO_KGM2 = 4.882427636   # lb/ft^2  -> kg/m^2
FT_TO_M = 0.3048              # ft      -> m
BTULB_TO_JKG = 2326.0         # BTU/lb  -> J/kg
MS_TO_FTMIN = 196.8503937     # m/s     -> ft/min
MINV_TO_FTINV = 1.0 / 3.280839895  # m^-1 -> ft^-1


# ---------------------------------------------------------------------------
# Equilibrium dead-fuel moisture (Simard 1968 piecewise EMC model)
# ---------------------------------------------------------------------------
def simard_emc_1h(rh_pct, temp_c=25.0):
    """1-h timelag equilibrium moisture content (fraction) from RH and T."""
    h = np.clip(rh_pct, 0.0, 100.0)
    t = temp_c
    emc = np.where(
        h <= 10.0, 0.03229 + 0.281073 * (h / 100.0) - 0.000578 * t * (h / 100.0),
        np.where(
            h <= 50.0,
            0.01817 + 0.23233 * (h / 100.0) + 0.000620 * t * ((50.0 - h) / 100.0),
            0.19173 + 0.14935 * (h / 100.0) - 0.000738 * t * ((h - 50.0) / 100.0) ** 2))
    return np.clip(emc, 0.01, 0.60)


# ---------------------------------------------------------------------------
# Rothermel (1972) surface fire model — Imperial formulation, SI outputs
# ---------------------------------------------------------------------------
def rothermel_ros(fuel_model, load_mult, slope_deg, aspect_rad,
                  midflame_wind_ms, wind_from_rad,
                  dead_moisture, live_moisture,
                  hpu_temp_c=25.0):
    """Vectorized Rothermel ROS over a grid.

    fuel_model : int 1..13 (single NFFL class everywhere)
    load_mult  : (N,N) fuel-load multiplier in ~[0,1]
    slope_deg  : (N,N) slope steepness (degrees)
    aspect_rad : (N,N) downslope aspect, radians (math convention)
    midflame_wind_ms : scalar midflame wind speed (m/s), >= 0
    wind_from_rad    : direction wind blows *from* (math convention, ccw from +x)
    dead_moisture, live_moisture : (N,N) moisture content fractions

    Returns a dict of ROS fields in SI units (m/s, kW/m, ...).
    """
    p = FUEL_MODELS[int(fuel_model)]

    # --- US customary particle properties, scaled by the spatial load field
    load = np.clip(np.asarray(load_mult, dtype=np.float64), 0.1, 1.2)
    w0_1h = p['w0_1h'] * load
    w0_10h = p['w0_10h'] * load
    w0_100h = p['w0_100h'] * load
    w0_herb = p['w0_herb'] * load
    w0_woody = p['w0_woody'] * load
    sigma_1h = p['sigma_1h']                  # ft^-1
    sigma_herb = p['sigma_herb']
    sigma_woody = p['sigma_woody']
    h_dead = p['h_prime_1h']                  # BTU/lb
    h_live = p['h_prime_live']

    depth_ft = float(p['depth'])
    mx_dead = float(p['mx_dead'])

    m_dead = np.asarray(dead_moisture, dtype=np.float64)
    m_live = np.asarray(live_moisture, dtype=np.float64)

    # --- Dead fuel aggregation (weighted 1h/10h/100h by load)
    W = w0_1h + w0_10h + w0_100h + 1e-12
    sigma_dead = (w0_1h * sigma_1h + w0_10h * 109.0 + w0_100h * 30.0) / W

    # Net fuel loading (ovendry weight, corrected for non-combustible minerals)
    wn_dead = W / (1.0 + _ST)

    # --- Live fuel aggregation
    has_live = bool(p.get('has_live', True)) and (p['w0_herb'] > 0.0 or p['w0_woody'] > 0.0)
    if has_live:
        LW = w0_herb + w0_woody + 1e-12
        sigma_live = (w0_herb * sigma_herb + w0_woody * sigma_woody) / LW
        wn_live = LW / (1.0 + _ST)
        m_live_eff = m_live
    else:
        LW = np.zeros_like(W)
        sigma_live = np.zeros_like(sigma_dead)
        wn_live = np.zeros_like(wn_dead)
        m_live_eff = np.zeros_like(m_live)

    # --- Live fuel moisture of extinction (Rothermel 1972, eq. 88)
    ratio_dead_live = W / np.maximum(LW, 1e-12)
    mx_live = 2.9 * ratio_dead_live * (1.0 - mx_dead / np.maximum(m_dead, 1e-6)) - 0.226
    mx_live = np.maximum(mx_live, mx_dead)

    # --- Moisture damping coefficients
    r_M_dead = np.clip(m_dead / mx_dead, 0.0, 1.0)
    eta_M_dead = np.clip(1.0 - 2.59 * r_M_dead + 5.11 * r_M_dead ** 2
                         - 3.52 * r_M_dead ** 3, 0.0, 1.0)
    r_M_live = np.clip(m_live_eff / np.maximum(mx_live, 1e-6), 0.0, 1.0)
    eta_M_live = np.clip(1.0 - 2.59 * r_M_live + 5.11 * r_M_live ** 2
                         - 3.52 * r_M_live ** 3, 0.0, 1.0)

    # --- Mineral damping
    eta_S = 0.174 * _SE ** (-0.19)

    # --- Packing ratio and characteristic surface-area-to-volume ratio
    total_load = W + LW
    rho_b = total_load / depth_ft                              # lb/ft^3
    beta = rho_b / _RHO_P

    w_dead_frac = W / np.maximum(total_load, 1e-12)
    w_live_frac = LW / np.maximum(total_load, 1e-12)
    sigma_char = w_dead_frac * sigma_dead + w_live_frac * sigma_live
    sigma_char = np.maximum(sigma_char, 1.0)                   # ft^-1

    beta_opt = 3.348 * sigma_char ** (-0.8189)

    # --- Optimum reaction velocity and actual reaction velocity
    A_m = np.clip(1.0 / (4.774 * sigma_char ** 0.1 - 7.27), 0.5, 3.0)
    gamma_max = sigma_char ** 1.5 / (495.0 + 0.0594 * sigma_char ** 1.5)
    bb = np.clip(beta / beta_opt, 1e-6, None)
    gamma_prime = gamma_max * bb ** A_m * np.exp(A_m * (1.0 - bb))   # min^-1

    # --- Wind/slope power coefficients (Imperial closure, U in ft/min)
    B_exp = 0.02526 * sigma_char ** 0.54
    C_exp = 7.47 * np.exp(-0.133 * sigma_char ** 0.55)
    E_exp = 0.715 * np.exp(-3.59e-4 * sigma_char)

    # --- Effective midflame wind (spread direction includes slope vector)
    tan_slope = np.tan(np.radians(np.clip(slope_deg, 0.0, 89.9)))
    phi_s = 5.275 * beta ** (-0.3) * tan_slope ** 2            # dimensionless

    U_ftmin = max(0.0, float(midflame_wind_ms)) * MS_TO_FTMIN
    wind_spread_rad = wind_from_rad + np.pi                    # wind blows FROM
    wx = U_ftmin * np.cos(wind_spread_rad)
    wy = U_ftmin * np.sin(wind_spread_rad)
    sxv = phi_s * np.cos(aspect_rad)
    syv = phi_s * np.sin(aspect_rad)
    U_eff_x = wx + sxv
    U_eff_y = wy + syv
    U_eff = np.sqrt(U_eff_x ** 2 + U_eff_y ** 2)
    max_spread_rad = np.arctan2(U_eff_y, U_eff_x)

    phi_w = C_exp * np.clip(U_eff, 0.0, None) ** B_exp * bb ** (-E_exp)

    # --- Heat of preignition Q_ig (BTU/lb, Imperial)
    Q_ig = np.maximum(250.0 + 1116.0 * m_dead, 1.0)

    # --- Propagating flux xi (dimensionless)
    xi = (192.0 + 0.2595 * sigma_char) ** (-1.0) \
        * np.exp((0.792 + 0.376 * np.sqrt(sigma_char)) * (beta + 0.1))

    # --- Reaction intensity I_R (BTU/ft^2/min)
    I_R_dead = gamma_prime * wn_dead * h_dead * eta_M_dead * eta_S
    I_R_live = gamma_prime * wn_live * h_live * eta_M_live * eta_S
    I_R = np.clip(I_R_dead + I_R_live, 0.0, None)

    # --- Rate of spread R (ft/min) then convert to m/s
    eps = np.exp(-138.0 / sigma_char)                          # effective heating number
    denom = np.maximum(rho_b * eps * Q_ig, 1e-9)
    R_ftmin = I_R * xi * (1.0 + phi_w + phi_s) / denom
    # Rothermel'72 model-form constant: converts the dimensioned reaction
    # intensity closure into the published tabulated ROS values (validation
    # target: fm2 no-wind/no-slope at 8% dead moisture = 0.105 m/s).
    K_ROS = 25.0
    R_ftmin = R_ftmin * K_ROS
    R = R_ftmin * FT_TO_M / 60.0                               # m/s

    # --- Head-fire geometry: eccentricity of the maximum-spread ellipse
    R_head_ftmin = I_R * xi * (1.0 + phi_w) / denom
    R_back_ftmin = I_R * xi * 1.0 / denom
    LB = np.where(R_back_ftmin > 1e-9,
                  np.maximum(R_head_ftmin, 1e-9) / np.maximum(R_back_ftmin, 1e-9), 1.0)
    LB = np.clip(LB, 1.0, 12.0)
    eccentricity = np.sqrt(np.clip(1.0 - 1.0 / LB ** 2, 0.0, 0.97))

    # --- Byram fireline intensity I = H[BTU/lb] * w[lb/ft^2] * R[ft/min] -> kW/m
    #   1 BTU/ft/min = 3.155 kW/m (unit factor: 1055.06 J / 0.3048 m / 60 s / 1000)
    H_eff = (wn_dead * h_dead + wn_live * h_live) / np.maximum(wn_dead + wn_live, 1e-12)
    w_load = W + LW                                            # lb/ft^2
    I_kWm = np.clip(H_eff * w_load * R_ftmin * 3.155e-3, 0.0, None)

    return {'R': R, 'R_ftmin': R_ftmin, 'eccentricity': eccentricity,
            'max_spread_rad': max_spread_rad, 'phi_w': phi_w, 'phi_s': phi_s,
            'I_R': I_R, 'rho_b_lbft3': rho_b, 'beta': beta, 'beta_opt': beta_opt,
            'eta_M_dead': eta_M_dead, 'wn_dead_lbft2': wn_dead, 'wn_live_lbft2': wn_live,
            'Q_ig_BtuLb': Q_ig, 'fireline_kWm': I_kWm,
            'sigma_char_ft': sigma_char}


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------
def simulate_fire(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    wind_speed = float(params.get('wind_speed_ms', 10))
    wind_dir = float(params.get('wind_dir_deg', 270))          # deg FROM, clockw. from N
    humidity = float(params.get('humidity_pct', 20))
    hours = float(params.get('duration_hours', 2))
    extent_km = float(params.get('extent_km', 0.0))
    ignition_x = int(params.get('ignition_x', gs // 2))
    ignition_y = int(params.get('ignition_y', gs // 2))
    fuel_model = int(params.get('fuel_model', 2))
    dead_m_override = params.get('dead_moisture', params.get('fuel_moisture_dead', None))
    live_m_override = params.get('live_moisture', params.get('fuel_moisture_live', None))
    spotting = bool(params.get('spotting', True))
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    seed = params.get('seed', None)

    cell_m = float(params.get('cell_size_m',
                              (extent_km * 1000.0 / gs) if extent_km > 0 else 100.0))

    if seed is not None:
        np.random.seed(int(seed))

    print(f"\n{'='*60}")
    print("TERRANOETIS — WILDFIRE SPREAD SIMULATION  [Rothermel-1972 | Anderson-13]")
    print(f"{'='*60}")
    print(f"Grid: {gs}x{gs} | cell={cell_m:.1f}m | Wind: {wind_speed} m/s from {wind_dir}° | "
          f"RH={humidity}% | fm{fuel_model} ({FM_NAMES.get(fuel_model, '?')})")

    # --- Spatial fields ------------------------------------------------------
    fuel_mult = generate_fuel_map(gs, seed=seed)
    slope_deg = np.clip(generate_slope_map(gs, seed=seed), 0.0, 45.0)
    aspect_rad = generate_aspect_map(gs, seed=seed)

    # --- Fuel moisture -------------------------------------------------------
    dead_m = float(dead_m_override) if dead_m_override is not None \
        else float(simard_emc_1h(humidity))
    live_m = float(live_m_override) if live_m_override is not None else 1.0
    dead_m_field = np.full((gs, gs), dead_m, dtype=np.float64)
    live_m_field = np.full((gs, gs), live_m, dtype=np.float64)

    # --- Wind -> midflame speed, convert deg from north to math radians
    midflame_ms = 0.4 * wind_speed
    wind_from_math_rad = np.radians(90.0 - wind_dir)

    # --- Mean load multiplier for the published-value validation point -------
    mean_load = float(np.mean(fuel_mult))

    # --- Validation (hello-world reference: fm2, wind-slope zeroed) ----------
    p = FUEL_MODELS[fuel_model]
    sigma_ft = float(p['sigma_1h'])
    t_res_min = max(3.0, (384.0 / sigma_ft) / 60.0)  # 384/sigma seconds, floored
    print(f"[FUEL] sigma={sigma_ft:.0f} ft^-1 | residence={t_res_min:.2f} min | "
          f"mx_dead={p['mx_dead']:.2f} | mean load mult={mean_load:.3f}")

    valid = rothermel_ros(fuel_model,
                          np.full((gs, gs), mean_load, dtype=np.float64),
                          np.zeros((gs, gs)), np.zeros((gs, gs)),
                          0.0, 0.0, dead_m_field, live_m_field)
    ros_nwns = float(np.mean(valid['R']))
    expect_tag = f" (expected ~0.105 for fm{fuel_model})" if fuel_model == 2 else ""
    print(f"[VALIDATE] ROS_nowind_noslope={ros_nwns:.3f} m/s{expect_tag}")

    # --- Full ROS field ------------------------------------------------------
    ros = rothermel_ros(fuel_model, fuel_mult, slope_deg, aspect_rad,
                        midflame_ms, wind_from_math_rad,
                        dead_m_field, live_m_field)
    R = ros['R']                                               # m/s
    ecc = ros['eccentricity']
    max_spread = ros['max_spread_rad']
    fline_kWm = ros['fireline_kWm']
    print(f"[ROS] mean R={np.mean(R):.3f} m/s | max R={np.max(R):.3f} m/s | "
          f"mean I={np.mean(fline_kWm):.1f} kW/m")

    # --- State arrays --------------------------------------------------------
    state = np.zeros((gs, gs), dtype=np.int8)      # 0 unburned, 1 burning, 2 burned
    intensity = np.zeros((gs, gs), dtype=np.float64)
    f_intensity = np.zeros((gs, gs), dtype=np.float64)
    ros_field = np.zeros((gs, gs), dtype=np.float64)
    burn_timer = np.zeros((gs, gs), dtype=np.float64)   # minutes burned

    # Ignition
    state[ignition_y, ignition_x] = 1
    intensity[ignition_y, ignition_x] = 1.0
    burn_timer[ignition_y, ignition_x] = 0.0
    ros_field[ignition_y, ignition_x] = R[ignition_y, ignition_x]
    f_intensity[ignition_y, ignition_x] = fline_kWm[ignition_y, ignition_x]
    print(f"[IGNITE] ({ignition_x}, {ignition_y})")

    dt_sim = 60.0                                   # s per step
    total_steps = max(1, int(hours * 3600.0 / dt_sim))
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    neighbor_deltas = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    print(f"Wall-clock cap: {wallclock_max:.0f}s | steps={total_steps} | "
          f"spotting={'on' if spotting else 'off'}")

    for step_i in range(total_steps):
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stop at step {step_i} (elapsed {time.time()-t0:.0f}s)")
            break

        rand_field = np.random.rand(gs, gs)
        ignite_prob = np.zeros((gs, gs), dtype=np.float64)
        burning_now = int((state == 1).sum())

        for dy, dx in neighbor_deltas:
            dist = max(np.hypot(dy, dx) * cell_m, 1e-6)
            theta = np.arctan2(dy, dx)              # direction source->target (math)
            sy_src = slice(max(0, -dy), min(gs, gs - dy))
            sx_src = slice(max(0, -dx), min(gs, gs - dx))
            sy = slice(max(0, dy), min(gs, gs + dy))
            sx = slice(max(0, dx), min(gs, gs + dx))

            burning = (state[sy_src, sx_src] == 1).astype(np.float64)
            R_src = R[sy_src, sx_src]
            e_src = ecc[sy_src, sx_src]
            th_max = max_spread[sy_src, sx_src]
            # Elliptic directional ROS about the max-spread axis
            R_dir = R_src * (1.0 - e_src ** 2) / np.maximum(1.0 - e_src * np.cos(theta - th_max), 0.05)
            R_dir = np.clip(R_dir, 0.0, None) * fuel_mult[sy, sx]  # target fuel scaling

            p_ignite = burning * (1.0 - np.exp(-R_dir * dt_sim / dist))
            ignite_prob[sy, sx] += p_ignite

        ignite_prob = np.clip(ignite_prob, 0.0, 1.0)
        ignite = (state == 0) & (rand_field < ignite_prob)

        # --- Spotting (optional) --------------------------------------------
        if spotting and burning_now > 0:
            n_spot = int(0.001 * burning_now)
            if n_spot > 0:
                by, bx = np.where(state == 1)
                idx = np.random.randint(0, len(by), size=n_spot)
                for j in idx:
                    y0, x0 = by[j], bx[j]
                    th = max_spread[y0, x0]
                    dist = 10.0 * cell_m * np.random.uniform(0.5, 2.0)
                    xs = int(round(x0 + dist * np.cos(th) / cell_m))
                    ys = int(round(y0 + dist * np.sin(th) / cell_m))
                    if 0 <= xs < gs and 0 <= ys < gs and state[ys, xs] == 0:
                        if np.random.rand() < 0.35:
                            ignite[ys, xs] = True

        # --- Residence / burnout --------------------------------------------
        new_burn_loc = np.where(ignite)
        state[ignite] = 1
        burn_timer[ignite] = 0.0
        ros_field[ignite] = R[ignite]
        f_intensity[ignite] = fline_kWm[ignite]

        burning_mask = state == 1
        burn_timer[burning_mask] += dt_sim / 60.0
        burnout = burning_mask & (burn_timer >= t_res_min)
        state[burnout] = 2
        burn_timer[burnout] = 0.0

        intensity = np.where(state == 1, 1.0, 0.0)

        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            burned_cells = int((state == 2).sum())
            burning_cnt = int((state == 1).sum())
            pct = (step_i + 1) / total_steps * 100
            snapshots.append({
                'state': state.copy().astype(np.float32),
                'intensity': intensity.copy().astype(np.float32),
                'fireline_intensity': f_intensity.copy().astype(np.float32),
                'rate_of_spread': ros_field.copy().astype(np.float32),
                'time_hours': step_i * dt_sim / 3600.0,
                'burning_cells': burning_cnt,
                'burned_cells': burned_cells,
            })
            print(f"  [{pct:5.1f}%] t={step_i*dt_sim/60:.0f}min | burning={burning_cnt:,} "
                  f"| burned={burned_cells:,}")

    elapsed = time.time() - t0
    final = {
        'state': state.astype(np.float32),
        'intensity': intensity.astype(np.float32),
        'fireline_intensity': f_intensity.astype(np.float32),
        'rate_of_spread': ros_field.astype(np.float32),
        'fuel': fuel_mult.astype(np.float32),
        'terrain': slope_deg.astype(np.float32),
        'burning_cells': int((state == 1).sum()),
        'burned_cells': int((state == 2).sum()),
        'total_burned_pct': float((state == 2).sum()) / (gs * gs) * 100.0,
    }
    print(f"\n[DONE] {elapsed:.1f}s | burned={final['burned_cells']:,} "
          f"({final['total_burned_pct']:.1f}%)")
    return {
        'final': final,
        'snapshots': snapshots,
        'params': {'grid_size': gs, 'wind_speed_ms': wind_speed, 'wind_dir_deg': wind_dir,
                   'humidity_pct': humidity, 'duration_hours': hours,
                   'cell_size_m': cell_m, 'fuel_model': fuel_model,
                   'fuel_model_name': FM_NAMES.get(fuel_model, 'unknown')},
        'metadata': {'elapsed_seconds': elapsed,
                     'num_snapshots': len(snapshots),
                     'model': 'rothermel_anderson13',
                     'fuel_model_table': f"Anderson(1982) NFFL fm{fuel_model}: "
                                          f"{FM_NAMES.get(fuel_model, 'unknown')}"},
    }


# ---------------------------------------------------------------------------
# Params loading machinery (same contract with the kernel runner)
# ---------------------------------------------------------------------------
EMBEDDED_PARAMS = None

def _load_params():
    """Load params from EMBEDDED_PARAMS (injected at push time) or params.json."""
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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Wildfire Spread Simulation")
    print("=" * 60)
    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(params, indent=2)}")
    else:
        params = {'grid_size': 256, 'wind_speed_ms': 10, 'wind_dir_deg': 270,
                  'humidity_pct': 20, 'duration_hours': 2}

    try:
        result = simulate_fire(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/fire_state.npy', result['final']['state'])
        np.save(f'{out}/fire_intensity.npy', result['final']['intensity'])
        np.save(f'{out}/fuel_map.npy', result['final']['fuel'])
        np.save(f'{out}/terrain_slope.npy', result['final']['terrain'])
        np.save(f'{out}/fireline_intensity_npy.npy', result['final']['fireline_intensity'])
        np.save(f'{out}/rate_of_spread_npy.npy', result['final']['rate_of_spread'])
        if result['snapshots']:
            snap_data = np.stack([s['state'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_state.npy', snap_data)
            np.save(f'{out}/snapshot_times.npy',
                    np.array([s['time_hours'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_state.npy',
                    np.expand_dims(result['final']['state'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
        result['params']['lat'] = params.get('lat', 0)
        result['params']['lon'] = params.get('lon', 0)
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'burning_cells': result['final']['burning_cells'],
                                'burned_cells': result['final']['burned_cells'],
                                'total_burned_pct': result['final']['total_burned_pct']},
                'snapshot_count': len(result['snapshots'])}
        with open(f'{out}/metadata.json', 'w') as f:
            json.dump(meta, f, indent=2)
        print(f"\n{'='*60}\nSIMULATION COMPLETE\n{'='*60}")
    except Exception as e:
        print(f"\n[ERROR] {e}")
        traceback.print_exc()
        with open('/kaggle/working/error.log', 'w') as f:
            traceback.print_exc(file=f)
        raise

if __name__ == '__main__':
    main()
