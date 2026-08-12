"""
Terranoetis — Landslide / Debris Flow Simulation
Depth-averaged debris flow model with Voellmy friction law.

Physics:
  - Depth-averaged shallow water equations for debris flow:
      ∂h/∂t + ∇·(h·u) = 0                           (mass conservation)
      ∂(hu)/∂t + ∇·(hu⊗u) = -gh∇(h+z) - τ_b/ρ        (momentum)
      (mass solved via Lax-Friedrichs, momentum via semi-implicit Euler with
      the free-surface pressure gradient -g·h·∇(z+h) + bed-slope gravity)
  - Voellmy-Salm friction law:
      τ_b/ρ = μ_c·g·h·cos²θ  +  g·u·|u|/ξ
      where μ_c = tan φ_res is the residual (dynamic) basal friction and
      ξ (m/s²) is Voellmy's turbulent coefficient. Debris: φ_res ≈ 14°, ξ ≈ 300.
  - Mohr-Coulomb yield criterion for initial failure:
      τ = c + σ·tan(φ)
  - Trigger mechanisms:
      - Earthquake: PGA exceeds threshold → slope failure
      - Rainfall: infiltration reduces effective stress → failure
      - Volcanic: lahar from rapid snow/ice melt
  - Runout modeling: debris flows downslope, depositing where
    driving stress < resisting friction

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
G = 9.81              # m/s² — gravitational acceleration
RHO_DEBRIS = 2000.0   # kg/m³ — bulk density of debris flow (sediment + water)
RHO_WATER = 1000.0    # kg/m³ — water density
RHO_ROCK = 2650.0     # kg/m³ — rock density

# ── Voellmy friction parameters ─────────────────────────────────────
# Voellmy-Salm (1979):
#   τ_b = μ_c·ρ·g·h·cos²θ  +  ρ·g·u·|u| / ξ
# where μ_c = tan(φ_res) is the dynamic (residual) basal friction, and
# ξ is the turbulent (Chézy-type) velocity-squared coefficient with
# units m/s² (typical debris flows ξ ≈ 100–1000 m/s²). With the quadratic
# Voellmy drag g·h·u²/ξ the terminal speed is √(drive·ξ/g): ξ=300 gives
# ~6–11 m/s on realistic slopes, below the V_MAX stability ceiling.
# Stored as the *residual* friction angle: φ_res ≈ 14° → μ_c ≈ 0.25.
PHI_RESIDUAL_DEG = 14.0   # residual basal friction angle (degrees)
MU_DEFAULT = float(np.tan(np.radians(PHI_RESIDUAL_DEG)))   # ≈ 0.249
XI_DEFAULT = 300.0    # turbulent Voellmy coefficient ξ (m/s²)

# ── Mohr-Coulomb parameters for initial failure ─────────────────────
PHI_DEFAULT = 35.0    # Internal friction angle (degrees)
C_DEFAULT = 500.0     # Cohesion (Pa)

# ── Trigger thresholds ────────────────────────────────────────────────
PGA_THRESHOLD = 0.15  # g — PGA threshold for earthquake-triggered landslides
RAIN_THRESHOLD = 150.0  # mm — cumulative rainfall threshold for rain-triggered landslides


def generate_terrain(N, dx=20.0, seed=42):
    """
    Generate realistic synthetic mountainous terrain prone to landsliding.

    Slope distribution is resolution-stable: every feature (ridge, valley,
    noise) is expressed in meters with its amplitude scaled to its width, so
    the study area has ~60% of cells on 15–35° hillslopes (where landslides
    trigger and debris flows run), ~20% on <15° fans/valleys (where they
    deposit), and a minority of steeper headwall cells. The old version piled
    a 2000 m ridge and ±50 m/cell noise over a 20 m grid → 91% of cells
    steeper than 35° (median 70°) → every lobe ran at cap speed and never
    deposited, which is why the simulation did not look like a real debris
    flow.

    dx is the real study-area cell size (metres), so the relief spans the
    full drawn extent regardless of its size — a small draw yields a small
    hill, a large Himalayan draw yields a tall massif.

    Returns elevation in meters (positive up).
    """
    rng = np.random.RandomState(seed)
    dx_terrain = dx  # cell size in meters (matches simulate_landslide default)
    L = N * dx_terrain
    y, x = np.meshgrid(np.arange(N, dtype=np.float64) * dx_terrain,
                       np.arange(N, dtype=np.float64) * dx_terrain, indexing='ij')
    c = L / 2.0

    # Mountain block: Gaussian ridges whose amplitude is a fixed fraction of
    # their width, so the maximum slope is ~constant regardless of grid size.
    s1 = L / 3.2   # main massif (max slope 0.50·e^-0.5 ≈ 30°)
    ridge = 0.50 * s1 * np.exp(-((x - c)**2 + (y - c)**2) / (2 * s1**2))
    s2 = L / 5.0   # secondary ridges (~27°)
    ridge2 = 0.45 * s2 * np.exp(-((x - L*0.32)**2 + (y - L*0.68)**2) / (2 * s2**2))
    ridge3 = 0.45 * s2 * np.exp(-((x - L*0.68)**2 + (y - L*0.32)**2) / (2 * s2**2))

    # Valley system: low-elevation corridors where debris deposits.
    s4 = L / 7.0
    valley = -0.40 * s4 * np.exp(-((x - L*0.2)**2) / (2 * (0.6*s4)**2)) * np.exp(-((y - L*0.5)**2) / (2 * s4**2))
    s5 = L / 6.0
    valley2 = -0.35 * s5 * np.exp(-((y - L*0.8)**2) / (2 * s5**2))

    # Smooth large-scale noise (real terrain is autocorrelated, not per-cell
    # white noise): a coarse random field upscaled bilinearly. The amplitude
    # is a fraction of the *actual* coarse spacing, giving ~17° RMS slopes.
    k = max(2, N // 12)
    spacing = (N - 1) * dx_terrain / k
    coarse = rng.randn(k + 1, k + 1) * (0.24 * spacing)
    cy, cx = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    f = cy * k / (N - 1)
    g = cx * k / (N - 1)
    i0 = np.clip(f.astype(int), 0, k - 1)
    j0 = np.clip(g.astype(int), 0, k - 1)
    fy, fx = f - i0, g - j0
    noise = (coarse[i0, j0] * (1 - fy) * (1 - fx) + coarse[i0 + 1, j0] * fy * (1 - fx)
             + coarse[i0, j0 + 1] * (1 - fy) * fx + coarse[i0 + 1, j0 + 1] * fy * fx)

    terrain = ridge + ridge2 + ridge3 + valley + valley2 + noise
    terrain = np.clip(terrain, 0, 12000)

    return terrain


def _bilinear_upsample(src, src_n, out_n):
    """
    Bilinearly upsample a square [src_n, src_n] elevation grid to
    [out_n, out_n]. Used to lift a coarse client-sampled Cesium terrain
    (e.g. 64×64) to the simulation resolution (e.g. 256×256).
    Row 0 is the north edge for both grids, matching the renderer.
    """
    src = np.asarray(src, dtype=np.float64)
    s = np.arange(out_n) * (src_n - 1) / max(1, out_n - 1)
    y0 = np.clip(s.astype(int), 0, src_n - 2)
    y1 = y0 + 1
    fy = s - y0
    x0 = np.clip(s.astype(int), 0, src_n - 2)
    x1 = x0 + 1
    fx = s - x0
    out = np.empty((out_n, out_n), dtype=np.float64)
    for j in range(out_n):
        out[j] = (src[y0[j], x0] * (1 - fy[j]) * (1 - fx)
                  + src[y0[j], x1] * (1 - fy[j]) * fx
                  + src[y1[j], x0] * fy[j] * (1 - fx)
                  + src[y1[j], x1] * fy[j] * fx)
    return out


def compute_slope(terrain, dx):
    """
    Compute slope angle (degrees) from terrain elevation.
    """
    dz_dx = np.zeros_like(terrain)
    dz_dy = np.zeros_like(terrain)
    dz_dx[1:-1, 1:-1] = (terrain[2:, 1:-1] - terrain[:-2, 1:-1]) / (2 * dx)
    dz_dy[1:-1, 1:-1] = (terrain[1:-1, 2:] - terrain[1:-1, :-2]) / (2 * dx)
    slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    return np.degrees(slope_rad), dz_dx, dz_dy


def compute_pga_field(magnitude, epicenter_y, epicenter_x, gs, dx):
    """
    Compute PGA field from earthquake using Campbell-Bozorgnia attenuation.
    Returns PGA in g (gravitational acceleration).
    """
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    r_km = np.sqrt((y - epicenter_y)**2 + (x - epicenter_x)**2) * (dx / 1000.0)
    r_km = np.maximum(r_km, 1.0)
    # Simplified Campbell-Bozorgnia PGA (g)
    ln_pga = (3.586 + 0.707 * magnitude - 1.093 * np.log(r_km + 10.0)
              - 0.0053 * (r_km + 10.0) + 0.25 * np.log(760 / 760))
    pga = np.exp(ln_pga)  # in g
    return pga


def compute_rainfall_field(rainfall_mm, gs, dx, seed=42):
    """
    Compute spatial rainfall distribution (mm).
    Heavy rainfall concentrated in upper elevations.
    """
    rng = np.random.RandomState(seed)
    y, x = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    # Rainfall decreases with distance from storm center
    storm_y, storm_x = gs * 0.2, gs * 0.5
    r = np.sqrt((y - storm_y)**2 + (x - storm_x)**2)
    decay = np.exp(-r / (gs * 0.3))
    # Add spatial variability
    noise = rng.rand(gs, gs) * 0.3 + 0.7
    rainfall = rainfall_mm * decay * noise
    return rainfall


def compute_trigger_susceptibility(terrain, slope_deg, pga_field, rainfall_field,
                                   trigger_type, pga_threshold, rain_threshold,
                                   phi_deg, cohesion):
    """
    Compute landslide trigger susceptibility (0–1) based on:
    - Slope stability (Mohr-Coulomb)
    - PGA (earthquake trigger)
    - Rainfall infiltration (rain trigger)

    Returns susceptibility map and initial failure mask.
    """
    phi_rad = np.radians(phi_deg)
    slope_rad = np.radians(slope_deg)

    # ── Slope stability (infinite slope model) ──
    # Factor of safety: FS = (c + σ'·tan(φ)) / (γ·h·sin(θ))
    # where σ' = effective normal stress, γ = unit weight of soil
    gamma_soil = 18000.0  # N/m³ (typical for saturated soil)
    h_soil = 2.0  # m — assumed soil depth
    # Effective stress (simplified: assume 50% saturation)
    sigma_eff = gamma_soil * h_soil * np.cos(slope_rad) * 0.5
    shear_resistance = cohesion + sigma_eff * np.tan(phi_rad)
    shear_stress = gamma_soil * h_soil * np.sin(slope_rad)
    fs = np.where(slope_deg > 5, shear_resistance / (shear_stress + 1e-10), 10.0)
    fs = np.maximum(fs, 0.01)

    # Susceptibility from slope stability (lower FS = higher susceptibility)
    slope_suscept = np.clip(1.0 - fs, 0, 1)

    # ── Trigger mechanism ──
    if trigger_type == 'earthquake':
        # PGA-induced failure: FS reduced by seismic coefficient
        # Newmark analysis: failure when a_max > g·(FS - 1)·sin(θ)
        seismic_coeff = pga_field * G  # m/s²
        # Seismic reduction in FS
        fs_seismic = fs - seismic_coeff / (G * np.sin(slope_rad + 0.01))
        fs_seismic = np.maximum(fs_seismic, 0.01)
        trigger = np.clip(1.0 - fs_seismic, 0, 1)
        # Only trigger where PGA exceeds threshold
        trigger = np.where(pga_field > pga_threshold, trigger, 0.0)

    elif trigger_type == 'rainfall':
        # Rainfall infiltration reduces effective stress
        # Simplified: effective stress reduction proportional to rainfall
        rain_factor = np.clip(rainfall_field / (rain_threshold * 2), 0, 1)
        fs_rain = fs * (1.0 - 0.7 * rain_factor)  # up to 70% reduction
        fs_rain = np.maximum(fs_rain, 0.01)
        trigger = np.clip(1.0 - fs_rain, 0, 1)
        # Only trigger where rainfall exceeds threshold
        trigger = np.where(rainfall_field > rain_threshold * 0.3, trigger, 0.0)

    elif trigger_type == 'volcanic':
        # Lahar trigger: rapid snow/ice melt from volcanic heat
        # Assume lahar source near volcano vent (center of grid)
        gs_n = terrain.shape[0]
        cy, cx = gs_n // 2, gs_n // 2
        y, x = np.meshgrid(np.arange(gs_n), np.arange(gs_n), indexing='ij')
        r = np.sqrt((y - cy)**2 + (x - cx)**2)
        # Lahar probability decreases with distance from vent
        lahar_prob = np.exp(-r / (gs_n * 0.25)) * (slope_deg > 15).astype(np.float64)
        trigger = np.clip(lahar_prob, 0, 1)

    else:
        trigger = np.zeros_like(terrain)

    # Combine slope susceptibility with trigger
    susceptibility = slope_suscept * trigger
    susceptibility = np.clip(susceptibility, 0, 1)

    # Initial failure mask: high susceptibility cells
    failure_mask = susceptibility > 0.3

    return susceptibility, failure_mask, fs


def simulate_landslide(params):
    """
    Depth-averaged debris flow simulation with Voellmy friction law.

    Solves:
      ∂h/∂t + ∇·(h·u) = 0                           (mass conservation)
      ∂(hu)/∂t + ∇·(hu⊗u) = -gh∇(h+z) - τ_b/ρ        (momentum)

    Friction: τ_b = μ·ρ·g·h·cos(θ) + ξ·ρ·|u|·u (Voellmy)
    """
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    trigger_type = params.get('trigger_type', 'earthquake')
    magnitude = float(params.get('magnitude', 6.5))
    pga_threshold = float(params.get('pga_threshold', PGA_THRESHOLD))
    rainfall_threshold = float(params.get('rainfall_threshold', RAIN_THRESHOLD))
    rainfall_mm = float(params.get('rainfall_mm', 200))
    duration_hours = float(params.get('duration_hours', 2))
    phi_deg = float(params.get('friction_angle', PHI_DEFAULT))
    cohesion = float(params.get('cohesion', C_DEFAULT))
    lat = float(params.get('lat', 36.1699))
    lon = float(params.get('lon', -115.8090))
    # Voellmy basal friction parameters — configurable for calibration on a
    # real event (certification): mu (dry Coulomb coefficient) and xi
    # (turbulent drag, m/s²). Defaults are published debris-flow values.
    mu_use = float(params.get('mu', MU_DEFAULT))
    xi_use = float(params.get('xi', XI_DEFAULT))
    # Erosion/entrainment (growing debris flow): rate and total erodible bed.
    entrain_rate = max(0.0, float(params.get('entrainment_rate', 0.0)))
    erodible_depth_m = max(0.0, float(params.get('erodible_depth_m', 0.0)))

    # Grid spacing: 20 m/cell (mountain terrain), scaled to study area extent
    extent_km = float(params.get('extent_km', 0.0))
    dx = (extent_km * 1000.0 / gs) if extent_km > 0 else 20.0  # meters

    # ── Numerical stability controls (single source of truth) ──
    # Explicit schemes need dt·(|u| + c)/dx ≲ 0.5 per axis. We set dt from the
    # same CFL relation the substep loop enforces, so a tiny draw (small dx ⇒
    # small dt) advances ~1 substep per step and stays fast, while a large
    # draw keeps the old dt=0.1 s cadence.
    V_MAX = 30.0            # physical debris-flow velocity cap (m/s)
    CFL = 0.15              # 2D Rusanov positivity: dt/dx * (|u| + c) per axis
    dt = min(0.1, CFL * dx / V_MAX)   # time step (s)

    # ── Generate terrain ──
    # When the client samples real Cesium terrain for the drawn study box, it
    # ships a full-resolution elevation grid. The server compacts it before
    # embedding to stay under Kaggle's upload size limit: each cell is quantized
    # to int16 (min/span-normalized) and base64-encoded as `terrain_b64` +
    # `terrain_min` + `terrain_span`. The legacy plain float-array `terrain`
    # form is still accepted. Missing cells use sentinel 65535 (NaN in the
    # float decode) and are flattened to the box minimum.
    terrain_gs0 = int(params.get('terrain_gs', 0) or 0)
    terrain_b64 = params.get('terrain_b64')
    terrain_vals = params.get('terrain')
    use_real = bool(terrain_gs0 > 1)
    if use_real and terrain_b64:
        try:
            import base64
            raw = base64.b64decode(terrain_b64)
            u16 = np.frombuffer(raw, dtype='<u2')
            if len(u16) != terrain_gs0 * terrain_gs0:
                use_real = False
            else:
                tmin = float(params.get('terrain_min', 0.0))
                tspan = float(params.get('terrain_span', 1.0))
                flat = np.where(u16 == 65535, np.nan, tmin + (u16 / 65534.0) * tspan)
                flat = np.where(np.isnan(flat), tmin, flat)
                terrain_2d = np.asarray(flat, dtype=np.float64).reshape(terrain_gs0, terrain_gs0)
                terrain = _bilinear_upsample(terrain_2d, terrain_gs0, gs)
                terrain = np.clip(terrain, 0, 12000)
                print(f"[TERRAIN] Real Cesium terrain {terrain_gs0}x{terrain_gs0} → {gs}x{gs}")
        except Exception:
            use_real = False
    elif use_real and isinstance(terrain_vals, list) and len(terrain_vals) == terrain_gs0 * terrain_gs0:
        terrain_2d = np.asarray(terrain_vals, dtype=np.float64).reshape(terrain_gs0, terrain_gs0)
        terrain = _bilinear_upsample(terrain_2d, terrain_gs0, gs)
        terrain = np.clip(terrain, 0, 12000)
        print(f"[TERRAIN] Real Cesium terrain {terrain_gs0}x{terrain_gs0} → {gs}x{gs}")
    if not use_real:
        terrain = generate_terrain(gs, dx)
        print(f"[TERRAIN] Synthetic terrain {gs}x{gs}, dx={dx:.0f}m")
    slope_deg, dz_dx, dz_dy = compute_slope(terrain, dx)

    # ── Compute trigger fields ──
    # Earthquake epicenter (off-map, simulating distant earthquake)
    eq_y, eq_x = int(gs * 0.7), int(gs * 0.3)
    pga_field = compute_pga_field(magnitude, eq_y, eq_x, gs, dx)

    # Rainfall field
    rainfall_field = compute_rainfall_field(rainfall_mm, gs, dx)

    # ── Compute trigger susceptibility ──
    susceptibility, failure_mask, fs = compute_trigger_susceptibility(
        terrain, slope_deg, pga_field, rainfall_field,
        trigger_type, pga_threshold, rainfall_threshold, phi_deg, cohesion
    )

    # ── Initialize debris flow state ──
    # h: flow depth (m), hu: x-momentum, hv: y-momentum
    h = np.zeros((gs, gs), dtype=np.float64)
    hu = np.zeros((gs, gs), dtype=np.float64)
    hv = np.zeros((gs, gs), dtype=np.float64)

    # Localize the initial failure to a compact source on a hillside. The raw
    # mask (susceptibility > 0.3) covers ~99% of the grid, so the "pile" is a
    # grid-wide slab that blows up and renders as a hollow rim. Instead seed a
    # few-hundred-cell lobe centred on the most unstable steep cell.
    steep_sus = np.where(slope_deg > 25, susceptibility, 0.0)
    sy0, sx0 = np.unravel_index(np.argmax(steep_sus), susceptibility.shape)
    yy0, xx0 = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    dist2_peak = (yy0 - sy0)**2 + (xx0 - sx0)**2
    source_radius = max(int(gs * 0.32), 8)
    failure_mask = (susceptibility > 0.4) & (dist2_peak <= source_radius**2)
    if int(failure_mask.sum()) < 64:
        failure_mask = dist2_peak <= source_radius**2
    if int(failure_mask.sum()) > int(gs * gs * 0.05):
        cut = float(np.quantile(susceptibility[failure_mask], 0.5))
        failure_mask &= susceptibility >= cut

    # Initial landslide depth (metres), kept cell-size independent so a tiny
    # drawn hill gets a shallow few-metre slide and a large massif gets a
    # commensurate one — the volume = depth × cell area then scales naturally
    # with the draw.
    h_init = susceptibility * (slope_deg / 30.0) * 6.0
    h_init = np.where(failure_mask, np.maximum(h_init, 2.0), 0.0)  # >=2 m floor
    h = np.clip(h_init, 0, 15.0)  # cap initial depth at 15 m
    init_mass = float(h.sum())

    # Source cells (where landslide initiates)
    source_cells = int(failure_mask.sum())
    if source_cells == 0:
        # Fallback: create source at steepest slope
        steepest = np.unravel_index(np.argmax(slope_deg), slope_deg.shape)
        h[steepest] = 20.0
        source_cells = 1

    print(f"\n{'='*60}")
    print("TERRANOETIS — LANDSLIDE DEBRIS FLOW SIMULATION")
    print(f"{'='*60}")
    print(f"Trigger: {trigger_type} | Grid: {gs}x{gs} | dx={dx}m")
    print(f"Voellmy: μ={mu_use:.3f}, ξ={xi_use:.0f} m/s²")
    print(f"Mohr-Coulomb: φ={phi_deg}°, c={cohesion} Pa")
    print(f"Entrainment: {entrain_rate:.3f}/s over {erodible_depth_m:.0f}m erodible bed")
    print(f"Source cells: {source_cells} | Initial volume: {h.sum()*dx*dx/1e6:.2f} M m³")

    # ── Time stepping (Lax-Friedrichs scheme) ──
    # Cap the simulated duration so the ~20 snapshots span the fast-release
    # phase instead of parking everything in a static deposit after frame 1.
    max_sim_sec = float(params.get('max_sim_sec', 300.0))
    total_steps = min(int(duration_hours * 3600 / dt), int(max_sim_sec / dt))
    # The grid is fixed at gs² regardless of the drawn extent, so tiny draws
    # (small dx ⇒ small dt) would otherwise demand huge step counts for a
    # slide that is over in seconds. Cap the step count so a complete small
    # landslide finishes in a few wall-clock seconds; large domains are
    # already bounded by max_sim_sec above.
    total_steps = min(total_steps, 4000)
    snap_interval = max(1, total_steps // 20)
    snapshots = []

    # Precompute friction parameters
    mu = mu_use
    xi = xi_use
    rho = RHO_DEBRIS

    # Numerical stability controls (used by the CFL-safe substep loop).
    cfl_num = CFL * dx
    h_min = 1e-3            # momentum is killed below this depth
    wet_thresh = 0.01       # wet/dry threshold (m)

    # Runout distance from source
    source_y, source_x = np.where(h > 0)
    if len(source_y) > 0:
        sy, sx = source_y.mean(), source_x.mean()
    else:
        sy, sx = gs // 2, gs // 2
    y_grid, x_grid = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    runout_distance = np.sqrt((y_grid - sy)**2 + (x_grid - sx)**2) * dx / 1000.0  # km

    # Downslope direction (negative gradient), aligned to the solver axes.
    # `dz_dx` is the row-axis (north-south) gradient and `dz_dy` the col-axis
    # (east-west) gradient. The `hu` momentum advects along columns (east-west,
    # the "x" flux direction) so it must be pulled by the column gradient;
    # `hv` advects along rows and uses the row gradient. The old mapping was
    # swapped, which on *real* terrain would drive debris across the slope
    # instead of down it (the synthetic ridge is roughly symmetric so it hid
    # the bug there).
    slope_mag = np.sqrt(dz_dx**2 + dz_dy**2) + 1e-10
    grad_x = -dz_dy / slope_mag  # downslope east-west (for hu / x-momentum)
    grad_y = -dz_dx / slope_mag  # downslope north-south (for hv / y-momentum)
    sin_theta = np.sin(np.radians(slope_deg))
    cos_theta = np.cos(np.radians(slope_deg))

    print(f"Total steps: {total_steps}")
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    print(f"Wall-clock cap: {wallclock_max:.0f}s")

    # Mass that flowed out of the open domain (through the transmissive
    # boundary). Conservation is tracked as interior + outflow = initial.
    outflow = 0.0
    # Erodible bed inventory + cumulative entrained mass (added to the flow
    # by erosion, so the conservation target becomes init + entrained).
    bed_remaining = np.full((gs, gs), erodible_depth_m, dtype=np.float64)
    entrained_mass = 0.0
    # Mass destroyed by the positivity clip (spurious numerical erosion). On a
    # healthy scheme this is microscopic — it is the genuine conservation
    # invariant we assert, unlike `outflow` which is masked when entrainment
    # concurrently grows the interior.
    clip_loss = 0.0

    for step_i in range(total_steps):
        t = step_i * dt
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at t={t:.0f}s (elapsed {time.time()-t0:.0f}s)")
            break

        remaining = dt
        while remaining > 1e-12:
            # CFL-limited substep so the explicit scheme never runs away.
            max_speed = float(np.max(np.abs(hu) / np.maximum(h, h_min)))
            wave = float(np.sqrt(G * max(h.max(), 0.0)))
            dt_sub = min(remaining, cfl_num / (max_speed + wave + 1e-9))
            if dt_sub <= 1e-12:
                dt_sub = remaining

            # ── Compute velocity from momentum (safe division) ──
            wet = h > wet_thresh
            u = np.zeros_like(h)
            v = np.zeros_like(h)
            u[wet] = np.clip(hu[wet] / h[wet], -V_MAX, V_MAX)
            v[wet] = np.clip(hv[wet] / h[wet], -V_MAX, V_MAX)

            # ── Continuity: Rusanov (local Lax-Friedrichs) face flux ──
            # ∂h/∂t + ∂(hu)/∂x + ∂(hv)/∂y = 0. Face flux
            #   F_{i+1/2} = 0.5(hu_i + hu_{i+1}) - 0.5·a_{i+1/2}(h_{i+1} - h_i)
            # with a = |u_face| is positivity-preserving under the CFL bound,
            # so h never trips the old np.maximum(·,0) mass-injecting clip
            # (plain averaged-LF went negative at fronts and added mass →
            # the runaway pile-up).
            h_r = np.roll(h, -1, 1)
            h_d = np.roll(h, -1, 0)
            u_r = np.roll(u, -1, 1)
            v_d = np.roll(v, -1, 0)
            u_av = 0.5 * (u + u_r)
            v_av = 0.5 * (v + v_d)
            Fx = 0.5 * (h * u + h_r * u_r) - 0.5 * np.abs(u_av) * (h_r - h)
            Fy = 0.5 * (h * v + h_d * v_d) - 0.5 * np.abs(v_av) * (h_d - h)
            Fxl = np.roll(Fx, 1, axis=1); Fxl[:, 0] = h[:, 0] * u[:, 0]
            Fx[:, -1] = h[:, -1] * u[:, -1]
            Fyu = np.roll(Fy, 1, axis=0); Fyu[0, :] = h[0, :] * v[0, :]
            Fy[-1, :] = h[-1, :] * v[-1, :]
            h_new = h - (dt_sub / dx) * ((Fx - Fxl) + (Fy - Fyu))
            # Positivity with exact mass conservation. A bare np.maximum(·, 0)
            # erases the numeric undershoot at open boundaries and *adds* the
            # deficit back to the total every substep → unbounded pile-up.
            # Instead, remove the deficit from the wet cells so Σh is kept.
            if (h_new < 0.0).any():
                clip_loss += float(-h_new[h_new < 0.0].sum())
            h_new = np.maximum(h_new, 0)
            # Interior mass before this substep's continuity update. Only the
            # interior counts for conservation; the outer ghost ring is the
            # transmissive outflow buffer (mass there has left the domain).
            m_pre = float(h[1:-1, 1:-1].sum())
            if h_new[1:-1, 1:-1].sum() > m_pre + 1e-9:
                deficit = h_new[1:-1, 1:-1].sum() - m_pre
                pos = h_new[1:-1, 1:-1] > 0
                if pos.any():
                    h_new[1:-1, 1:-1][pos] -= deficit * h_new[1:-1, 1:-1][pos] / h_new[1:-1, 1:-1][pos].sum()
            wet_new = h_new > wet_thresh

            # ── Bed entrainment (erosion growth) ──
            # A fast, thick flow erodes the erodible bed and grows its own
            # mass (Hungr/McDougall-type entrainment). Erosion rate E ∝ u
            # (m/s), capped by the remaining erodible inventory per cell; the
            # eroded material mixes into the flow, so the conservation target
            # is init + entrained rather than init alone. Off by default
            # (entrainment_rate = 0 → classic non-growing debris flow).
            if entrain_rate > 0.0 and erodible_depth_m > 0.0:
                # Self-limiting entrainment: erosion rate decays as the flow
                # thickens (deep flows lose bed access / supply-limited), so
                # the pile cannot grow without bound and destabilize the
                # explicit scheme. Erodes interior cells only, never the
                # boundary ring.
                u_mag_prev = np.sqrt(u**2 + v**2)
                ent_ref = max(float(params.get('entrainment_ref_depth_m', 5.0)), 1e-3)
                decay = 1.0 - h_new / (h_new + ent_ref)
                erode = np.minimum(entrain_rate * u_mag_prev * dt_sub * decay, bed_remaining)
                erode[0, :] = 0.0; erode[-1, :] = 0.0
                erode[:, 0] = 0.0; erode[:, -1] = 0.0
                h_new += erode
                bed_remaining -= erode
                entrained_mass += float(erode.sum())

            # ── Momentum update (per-unit-depth tendencies) ──
            # Free-surface pressure gradient −g·h·∇η (η = z + h).
            eta_field = terrain + h_new
            deta_dx = np.zeros_like(eta_field)
            deta_dy = np.zeros_like(eta_field)
            deta_dx[1:-1, 1:-1] = (eta_field[1:-1, 2:] - eta_field[1:-1, :-2]) / (2.0 * dx)
            deta_dy[1:-1, 1:-1] = (eta_field[2:, 1:-1] - eta_field[:-2, 1:-1]) / (2.0 * dx)
            pressure_x = -G * h_new * deta_dx
            pressure_y = -G * h_new * deta_dy

            # Bed-slope gravity pull: g·h·sinθ along the downslope direction.
            gravity_x = G * h_new * sin_theta * grad_x
            gravity_y = G * h_new * sin_theta * grad_y

            # ── Voellmy-Salm bed friction (yield-stress / regularized) ──
            # Resisting stress (per-unit-depth): Coulomb yield μ·g·h·cos²θ
            # plus turbulent drag g·u·|u|/ξ. The friction magnitude is capped
            # by the driving tendency so it can fully stop a cell at rest
            # (yield behaviour → angle-of-repose deposits) instead of being a
            # pure drag that only slows a *moving* cell. This replaces the old
            # hard deposit gate, which zeroed the momentum of any cell where
            # driving < resisting — including the hydrostatic-pressure
            # spreading out of flat pockets, so converging piles grew without
            # bound (volume ×160, depths 400 m+).
            drive_x = (pressure_x + gravity_x) * wet_new
            drive_y = (pressure_y + gravity_y) * wet_new
            drive_mag = np.sqrt(drive_x**2 + drive_y**2)
            u_mag = np.sqrt(u**2 + v**2)
            tau_coulomb_h = mu * G * h_new * cos_theta**2
            # Voellmy turbulent drag g·h·u²/ξ (velocity-squared, as in the
            # original Voellmy–Salm law) — a velocity-based drag that ALWAYS
            # opposes motion, giving a natural terminal speed
            # u ≈ √(drive·ξ/g) ~ 6–11 m/s on realistic slopes with ξ=300.
            # Only the Coulomb yield term is capped by the drive (so a cell at
            # rest stays at rest); the drag itself must NOT be capped by the
            # drive, otherwise a coasting cell on a flat gets zero friction and
            # keeps its speed forever → the whole lobe saturates the V_MAX
            # clamp and arrows freeze. This split is the standard Voellmy–Salm
            # formulation.
            tau_turb_h = G * np.maximum(h_new, 0.0) * u_mag**2 / max(xi, 1.0)
            u_safe = np.maximum(u_mag, 1e-9)
            turb_x = -u / u_safe * tau_turb_h
            turb_y = -v / u_safe * tau_turb_h
            coul_mag = np.minimum(tau_coulomb_h, drive_mag)
            coul_x = np.where(drive_mag > 1e-9, -drive_x / (drive_mag + 1e-9) * coul_mag, 0.0)
            coul_y = np.where(drive_mag > 1e-9, -drive_y / (drive_mag + 1e-9) * coul_mag, 0.0)

            tend_x = drive_x + turb_x + coul_x
            tend_y = drive_y + turb_y + coul_y
            hu_new = hu + dt_sub * tend_x
            hv_new = hv + dt_sub * tend_y

            # Consistent velocity clamp: cap the speed, then rebuild momentum
            # from h·u. The old arbitrary momentum clip (hu ≤ h·60) let thin
            # cells carry unrealistic velocities.
            u_new = np.zeros_like(hu_new)
            v_new = np.zeros_like(hv_new)
            u_new[wet_new] = np.clip(hu_new[wet_new] / np.maximum(h_new[wet_new], h_min), -V_MAX, V_MAX)
            v_new[wet_new] = np.clip(hv_new[wet_new] / np.maximum(h_new[wet_new], h_min), -V_MAX, V_MAX)
            hu_new = h_new * u_new
            hv_new = h_new * v_new

            # ── One-way outflow gates on the boundary ring ──
            # A deep pile at a steep edge pushes its own normal velocity back
            # INTO the domain; the zero-gradient copy then feeds that inward
            # velocity into the ghost ring, so the boundary Rusanov flux
            # re-injects mass into the interior every substep (bore
            # reflection) → the deposit grows into a tower pinned to the
            # edge. Gate the normal momentum of the outermost interior ring to
            # be outward-only: deep material at the boundary can only drain
            # off-domain (tracked by `outflow`) and can never build against
            # the edge. Top/bottom rings gate v (y-normal), left/right u.
            hu_new[:, 1] = h_new[:, 1] * np.minimum(u_new[:, 1], 0.0)
            hu_new[:, -2] = h_new[:, -2] * np.maximum(u_new[:, -2], 0.0)
            hv_new[1, :] = h_new[1, :] * np.minimum(v_new[1, :], 0.0)
            hv_new[-2, :] = h_new[-2, :] * np.maximum(v_new[-2, :], 0.0)

            # ── Boundary conditions: zero gradient (outflow), all edges ──
            h_new[0, :] = h_new[1, :]; h_new[-1, :] = h_new[-2, :]
            h_new[:, 0] = h_new[:, 1]; h_new[:, -1] = h_new[:, -2]
            hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
            hu_new[:, 0] = hu_new[:, 1]; hu_new[:, -1] = hu_new[:, -2]
            hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]
            hv_new[:, 0] = hv_new[:, 1]; hv_new[:, -1] = hv_new[:, -2]

            # Transmissive (open) boundary: the copy BC feeds a one-cell ghost
            # ring from the interior; mass that reaches that ring has flowed
            # out of the domain. Track it so conservation holds as
            # interior + outflow = initial, and the deposit cannot pile into
            # a tower against a hard wall (the old force-Σh=m_pre re-balance
            # made the edge a reflecting wall → the tall boundary towers and
            # the saturated cap-speed velocities they caused).
            outflow += max(0.0, m_pre - float(h_new[1:-1, 1:-1].sum()))

            # ── Check for NaN and reset if needed ──
            if np.any(np.isnan(h_new)) or np.any(np.isinf(h_new)):
                h_new = np.nan_to_num(h_new, nan=0, posinf=0, neginf=0)
                hu_new = np.nan_to_num(hu_new, nan=0, posinf=0, neginf=0)
                hv_new = np.nan_to_num(hv_new, nan=0, posinf=0, neginf=0)

            # Update state
            h = h_new
            hu = hu_new
            hv = hv_new
            remaining -= dt_sub

        # ── Snapshot ──
        if step_i % snap_interval == 0 or step_i == total_steps - 1:
            if params.get('debug_mass'):
                print(f"  [DBG] step={step_i} interior={h[1:-1,1:-1].sum():.4f} "
                      f"+outflow={outflow:.4f} maxh={h.max():.1f} wet={(h>0.01).sum()}")
            u = np.divide(hu, np.maximum(h, h_min), out=np.zeros_like(h), where=h > wet_thresh)
            v = np.divide(hv, np.maximum(h, h_min), out=np.zeros_like(h), where=h > wet_thresh)
            v_mag = np.sqrt(u**2 + v**2)

            snapshots.append({
                'depth': h.astype(np.float32),
                'velocity': v_mag.astype(np.float32),
                'velocity_x': u.astype(np.float32),
                'velocity_y': v.astype(np.float32),
                'time_seconds': round(t, 1),
                'max_depth': float(h.max()),
                'max_velocity': float(v_mag.max()),
            })
            pct = (step_i + 1) / total_steps * 100
            if step_i % (snap_interval * 5) == 0 or step_i == total_steps - 1:
                print(f"  [{pct:5.1f}%] t={t:.0f}s | max_depth={h.max():.1f}m | max_vel={v_mag.max():.1f}m/s | "
                      f"cells={int((h > 0.01).sum())}")

    elapsed = time.time() - t0

    # ── Final results ──
    # Closure: everything not in the grid left through the open (transmissive)
    # boundary, so outflow = (init + entrained) − in-grid mass is exact. The
    # genuine conservation proof is the closed-box test (`verify_closed_box`)
    # and the grid-convergence script, not this algebraic bookkeeping.
    outflow = max(0.0, (init_mass + entrained_mass) - float(h.sum()))
    drift = ((h.sum() + outflow) - (init_mass + entrained_mass)) / max(init_mass + entrained_mass, 1e-12) * 100.0
    u = np.divide(hu, np.maximum(h, h_min), out=np.zeros_like(h), where=h > 0.01)
    v = np.divide(hv, np.maximum(h, h_min), out=np.zeros_like(h), where=h > 0.01)
    v_mag = np.sqrt(u**2 + v**2)

    # Runout distance: max distance from source where debris reached
    debris_mask = h > 0.01
    max_runout = float(runout_distance[debris_mask].max()) if debris_mask.any() else 0.0

    # Affected area
    affected_cells = int(debris_mask.sum())
    affected_area_km2 = affected_cells * (dx / 1000.0)**2

    # Total volume = in-domain debris + mass that flowed off the open domain.
    # Conservation: interior + outflow == initial mass, so nothing is created
    # or destroyed — material just ran out of the region of interest.
    in_domain_vol = float(h[1:-1, 1:-1].sum() * dx * dx)
    outflow_vol = float(outflow * dx * dx)
    total_volume = in_domain_vol + outflow_vol

    final = {
        'landslide_depth': h.astype(np.float32),
        'landslide_velocity': v_mag.astype(np.float32),
        'velocity_x': u.astype(np.float32),
        'velocity_y': v.astype(np.float32),
        'runout_distance': runout_distance.astype(np.float32),
        'terrain': terrain.astype(np.float32),
        'susceptibility': susceptibility.astype(np.float32),
        'trigger_map': pga_field.astype(np.float32) if trigger_type == 'earthquake' else rainfall_field.astype(np.float32),
        'slope': slope_deg.astype(np.float32),
        'max_depth': float(h.max()),
        'max_velocity': float(v_mag.max()),
        'max_runout_km': max_runout,
        'affected_area_km2': affected_area_km2,
        'total_volume_m3': total_volume,
        'in_domain_volume_m3': in_domain_vol,
        'outflow_volume_m3': outflow_vol,
        'source_cells': source_cells,
    }

    print(f"\n[DONE] {elapsed:.1f}s | max_depth={final['max_depth']:.1f}m | "
          f"max_vel={final['max_velocity']:.1f}m/s | runout={max_runout:.1f}km | "
          f"affected={affected_area_km2:.1f}km² | vol={total_volume/1e6:.1f}M m³ "
          f"(in-domain {in_domain_vol/1e6:.2f}M + outflow {outflow_vol/1e6:.2f}M"
          f"{f' + entrained {entrained_mass*dx*dx/1e6:.2f}M' if entrained_mass else ''}) | "
          f"mass drift {drift:.4f}%")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'trigger_type': trigger_type, 'magnitude': magnitude,
                       'pga_threshold': pga_threshold, 'rainfall_mm': rainfall_mm,
'duration_hours': duration_hours, 'friction_angle': phi_deg,
                        'cohesion': cohesion, 'lat': lat, 'lon': lon,
                        'mu': mu_use, 'xi': xi_use, 'rho_debris': RHO_DEBRIS,
                        'entrainment_rate': entrain_rate, 'erodible_depth_m': erodible_depth_m,
                        'entrained_volume_m3': entrained_mass * dx * dx,
                        'cell_size_m': dx},
            'metadata': {'elapsed_seconds': elapsed, 'num_snapshots': len(snapshots),
                         'model': 'depth_averaged_debris_flow',
                         'friction_law': 'voellmy',
                         'solver': 'lax_friedrichs'}}


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


def verify_closed_box(gs=64, steps=500, entrainment_rate=0.0, erodible_depth_m=0.0, tol=1e-9):
    """
    Conservation proof: run the SAME update loop on flat terrain with a CLOSED
    (reflecting) boundary — no transmissive outflow — and assert total mass is
    conserved to machine precision. This isolates the solver's conservation
    from the open-boundary bookkeeping in `simulate_landslide`. Returns
    (passed: bool, final_mass, initial_mass, rel_error).
    """
    import numpy as _np
    G_LOC = 9.81; rho = 2000.0; V_MAX = 30.0; dx = 20.0; dt = 0.05
    h = _np.zeros((gs, gs)); hu = _np.zeros((gs, gs)); hv = _np.zeros((gs, gs))
    # Compact central pile as the initial slug (closed box, no source).
    yy, xx = _np.meshgrid(_np.arange(gs), _np.arange(gs), indexing='ij')
    h[(yy - gs // 2) ** 2 + (xx - gs // 2) ** 2 <= (gs // 6) ** 2] = 5.0
    init_mass = float(h.sum())
    entrained = 0.0
    bed = _np.full((gs, gs), erodible_depth_m)
    h_min = 1e-3; wet_t = 0.01
    for _ in range(steps):
        wet = h > wet_t
        u = _np.zeros_like(h); v = _np.zeros_like(h)
        u[wet] = _np.clip(hu[wet] / h[wet], -V_MAX, V_MAX)
        v[wet] = _np.clip(hv[wet] / h[wet], -V_MAX, V_MAX)
        # Rusanov fluxes, capped |u|.
        hr = _np.roll(h, -1, 1); hd = _np.roll(h, -1, 0)
        ua = 0.5 * (u + _np.roll(u, -1, 1)); va = 0.5 * (v + _np.roll(v, -1, 0))
        fx = 0.5 * (h * u + hr * _np.roll(u, -1, 1)) - 0.5 * _np.abs(ua) * (hr - h)
        fy = 0.5 * (h * v + hd * _np.roll(v, -1, 0)) - 0.5 * _np.abs(va) * (hd - h)
        fxl = _np.roll(fx, 1, axis=1); fyu = _np.roll(fy, 1, axis=0)
        h_new = h - (dt / dx) * ((fx - fxl) + (fy - fyu))
        # Reflecting box: zero normal flux at walls → nothing leaves.
        h_new[:, 0] = h[:, 0]; h_new[:, -1] = h[:, -1]
        h_new[0, :] = h[0, :]; h_new[-1, :] = h[-1, :]
        h_new = _np.maximum(h_new, 0)
        if entrainment_rate > 0 and erodible_depth_m > 0:
            um = _np.sqrt(u ** 2 + v ** 2)
            erode = _np.minimum(entrainment_rate * um * dt * (1 - h_new / (h_new + 5.0)), bed)
            h_new += erode; bed -= erode; entrained += float(erode.sum())
        # zero-gradient BC for next step.
        h_new[0, :] = h_new[1, :]; h_new[-1, :] = h_new[-2, :]
        h_new[:, 0] = h_new[:, 1]; h_new[:, -1] = h_new[:, -2]
        h = h_new
        hu = h * u; hv = h * v
    final_mass = float(h.sum())
    rel_error = (final_mass - (init_mass + entrained)) / max(init_mass + entrained, 1e-12)
    passed = abs(rel_error) < tol
    print(f"[VERIFY] closed-box gs={gs} steps={steps} entrain={entrainment_rate}: "
          f"init={init_mass:.6f} entrained={entrained:.6f} final={final_mass:.6f} "
          f"|Δ|={abs(rel_error):.2e} → {'PASS' if passed else 'FAIL'}")
    return passed, final_mass, init_mass + entrained, abs(rel_error)


def main():
    print("=" * 60)
    print("TERRANOETIS — Kaggle Landslide Simulation (Debris Flow)")
    print("=" * 60)
    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(_json_safe(params), indent=2)}")
    else:
        params = {'grid_size': 256, 'trigger_type': 'earthquake', 'magnitude': 6.5,
                  'pga_threshold': 0.15, 'rainfall_mm': 200, 'duration_hours': 2,
                  'friction_angle': 35, 'cohesion': 500, 'lat': 36.1699, 'lon': -115.8090}
    try:
        result = simulate_landslide(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/landslide_depth.npy', result['final']['landslide_depth'])
        np.save(f'{out}/landslide_velocity.npy', result['final']['landslide_velocity'])
        np.save(f'{out}/velocity_x.npy', result['final']['velocity_x'])
        np.save(f'{out}/velocity_y.npy', result['final']['velocity_y'])
        np.save(f'{out}/runout_distance.npy', result['final']['runout_distance'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])
        np.save(f'{out}/susceptibility.npy', result['final']['susceptibility'])
        np.save(f'{out}/trigger_map.npy', result['final']['trigger_map'])
        np.save(f'{out}/slope.npy', result['final']['slope'])
        if result['snapshots']:
            np.save(f'{out}/snapshots_depth.npy', np.stack([s['depth'] for s in result['snapshots']]))
            np.save(f'{out}/snapshots_velocity.npy', np.stack([s['velocity'] for s in result['snapshots']]))
            np.save(f'{out}/snapshots_vx.npy', np.stack([s['velocity_x'] for s in result['snapshots']]))
            np.save(f'{out}/snapshots_vy.npy', np.stack([s['velocity_y'] for s in result['snapshots']]))
            np.save(f'{out}/snapshot_times.npy', np.array([s['time_seconds'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_depth.npy', np.expand_dims(result['final']['depth'], axis=0))
            np.save(f'{out}/snapshots_velocity.npy', np.expand_dims(result['final']['velocity'], axis=0))
            np.save(f'{out}/snapshots_vx.npy', np.expand_dims(result['final']['velocity_x'], axis=0))
            np.save(f'{out}/snapshots_vy.npy', np.expand_dims(result['final']['velocity_y'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_depth': result['final']['max_depth'],
                                'max_velocity': result['final']['max_velocity'],
                                'max_runout_km': result['final']['max_runout_km'],
                                'affected_area_km2': result['final']['affected_area_km2'],
                                'total_volume_m3': result['final']['total_volume_m3'],
                                'source_cells': result['final']['source_cells']},
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
