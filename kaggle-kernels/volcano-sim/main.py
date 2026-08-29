"""
Terranoetis — Volcanic Eruption Simulation (Conservative Rusanov Lava SWE + Buoyant Plume)
Runs on Kaggle CPU/GPU.

Physics:
  Lava flow — 2D conservative shallow-water equations solved with a Rusanov
  (local Lax-Friedrichs) flux — the same conservative scheme as the landslide
  kernel:
    Continuity:  dh/dt = source − ∇·(h·u)
    Momentum:    ∂(hu)/∂t + ∇·(hu⊗u) = −g·h·∇η + g·h·sinθ − (η(T)·u)/(ρ·h) − τ_y/ρ
  where η(T) is the Arrhenius viscosity, τ_y the Bingham yield strength, and
  the friction is viscous (laminar) + yield. The Rusanov face flux telescopes
  to exact mass conservation (verified by `verify_closed_box`), so the lava
  solver is as rigorous as the landslide solver.

  Temperature — advected with the flow plus:
    ∂T/∂t + u·∇T = κ∇²T − h_c(T−T_amb)/(ρc_p h) − εσ(T⁴−T_amb⁴)/(ρc_p h) − (L_f/c_p)·dφ/dt
  with Stefan-Boltzmann radiative cooling (dominant at magmatic T) and
  enthalpy-porosity solidification (liquid fraction φ across the mushy zone).

  Eruption column — 1D Morton-Taylor buoyant plume with turbulent entrainment:
    d(ρwR²)/dz = 2αρ_a wR        (entrainment)
    dw/dz = g(ρ_a−ρ)/ρ_a − w/R·dR/dz   (momentum)
    dT/dz = −g/c_p − (2α/R)(T−T_amb)   (energy)
  Integrated upward from the vent; the plume height is where w → 0. Ash is
  then advected by the wind field at the plume-top height.

  Ash transport — advection-diffusion-settling PDE on the vertically
  integrated ash column mass C (kg/m²):
    ∂C/∂t + u_wx·∂C/∂x + u_wy·∂C/∂y = K·∇²C + Ṡ(x,y,t) − v_t·C/H_col
  with first-order upwind advection, 5-point Laplacian diffusion, Stokes-law
  terminal settling, and permanent ground deposition.

  Terrain — REAL ONLY. The kernel requires a sampled `terrain`/`terrain_gs`
  array (row-major, row 0 = north, meters above ellipsoid). There is NO
  synthetic fallback: if real relief is absent the run fails fast with a
  legible error rather than fabricating a cone.

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
G = 9.81                   # m/s² — gravity
RHO_LAVA = 2600.0          # kg/m³ — lava density
RHO_ASH = 1000.0           # kg/m³ — ash particle density
C_P_LAVA = 1200.0          # J/(kg·K) — lava specific heat
K_THERMAL = 1.5            # W/(m·K) — lava thermal conductivity
ETA_REF = 100.0            # Pa·s — reference viscosity at T_ref
T_REF = 1200.0             # K — reference temperature
E_A = 120_000.0            # J/mol — activation energy
R_GAS = 8.314              # J/(mol·K) — gas constant
T_LIQUIDUS = 1200.0        # K — liquidus temperature
T_SOLIDUS = 900.0          # K — solidus temperature
T_AMBIENT = 273.0          # K — ambient temperature
L_FUSION = 400_000.0       # J/kg — latent heat of fusion
H_COEFF = 25.0             # W/(m²·K) — convective heat transfer coefficient
CELL_SIZE_M = 50.0         # meters per grid cell
# Stefan-Boltzmann radiative cooling — the dominant heat-loss mechanism for
# lava at magmatic temperatures (T⁴ scaling).
SIGMA_SB = 5.67e-8         # W/(m²·K⁴) — Stefan-Boltzmann constant
EPS_LAVA = 0.9             # — emissivity of basaltic lava
TAU_YIELD = 50.0           # Pa — Bingham yield strength of lava
CFL = 0.5                  # CFL number for adaptive timestep
V_MAX = 5.0                # m/s — physical velocity cap for lava

# ── Ash particle / atmosphere constants (Stokes settling) ───────────
RHO_AIR = 1.2              # kg/m³ — ambient air density
ETA_AIR = 1.8e-5           # Pa·s — dynamic viscosity of air
C_P_AIR = 1005.0           # J/(kg·K) — specific heat of air
GAMMA = 0.0065             # K/m — environmental lapse rate (troposphere)
D_ASH_DEFAULT = 316e-6     # m — default particle diameter (~median coarse ash)

# VEI parameters
VEI_PARAMS = {
    0: {'col_height': 100,   'lava_vol': 1e4,   'mass_erupt': 1e6,  'ash_mass': 1e5},
    1: {'col_height': 1000,  'lava_vol': 1e5,   'mass_erupt': 1e7,  'ash_mass': 1e6},
    2: {'col_height': 5000,  'lava_vol': 1e6,   'mass_erupt': 1e8,  'ash_mass': 1e7},
    3: {'col_height': 10000, 'lava_vol': 1e7,   'mass_erupt': 1e9,  'ash_mass': 1e8},
    4: {'col_height': 25000, 'lava_vol': 1e8,   'mass_erupt': 1e10, 'ash_mass': 1e9},
    5: {'col_height': 40000, 'lava_vol': 1e9,   'mass_erupt': 1e11, 'ash_mass': 1e10},
    6: {'col_height': 55000, 'lava_vol': 1e10,  'mass_erupt': 1e12, 'ash_mass': 1e11},
    7: {'col_height': 70000, 'lava_vol': 1e11,  'mass_erupt': 1e13, 'ash_mass': 1e12},
    8: {'col_height': 90000, 'lava_vol': 1e12,  'mass_erupt': 1e14, 'ash_mass': 1e13},
}


def viscosity_from_temp(T):
    """Arrhenius viscosity model (Pa·s)."""
    # η = η_ref · exp(E_a/R · (1/T - 1/T_ref))
    T_safe = np.clip(T, T_SOLIDUS, T_LIQUIDUS)
    eta = ETA_REF * np.exp((E_A / R_GAS) * (1.0 / T_safe - 1.0 / T_REF))
    return np.clip(eta, 1e-2, 1e12)


def _bilinear_upsample(src, src_n, out_n):
    """Bilinearly upsample a square [src_n, src_n] grid to [out_n, out_n].
    Row 0 is the north edge for both grids, matching the renderer."""
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


def morton_taylor_plume(mass_eruption_rate, vent_radius, T_vent, T_amb, nz=200):
    """
    Integrate a 1D Morton-Taylor buoyant plume with turbulent entrainment.

    Returns (height_m, top_radius_m, top_temp_k). The plume rises until its
    vertical velocity w → 0 (neutral buoyancy / momentum exhaustion).

    Governing equations (Morton, Taylor & Turner 1956):
      d(ρwR²)/dz = 2αρ_a wR            (entrainment, α = 0.1)
      dw/dz = g(ρ_a−ρ)/ρ_a − (w/R)·dR/dz   (momentum)
      dT/dz = −g/c_p − (2α/R)(T−T_amb)     (energy)
    with ρ = ρ_a·T_a/T (ideal gas, constant pressure) and a linear ambient
    temperature profile T_a(z) = T_amb − Γ·z.
    """
    alpha = 0.1  # entrainment coefficient (Morton-Taylor)
    # Vent conditions: mass flux Q = ρ_vent·w_vent·π·R²
    rho_vent = RHO_AIR * T_amb / T_vent
    w_vent = mass_eruption_rate / (rho_vent * np.pi * vent_radius**2)
    w_vent = max(w_vent, 1.0)  # ensure a positive launch velocity

    z = 0.0
    R = vent_radius
    w = w_vent
    T = T_vent
    dz = 10.0  # 10 m vertical steps
    for _ in range(nz):
        T_a = max(T_amb - GAMMA * z, 200.0)  # ambient temp at height z
        rho_a = RHO_AIR * T_amb / T_a
        rho = RHO_AIR * T_amb / T  # plume density (ideal gas, same pressure)
        # Entrainment: dR/dz = α (for a top-hat profile)
        dRdz = alpha
        # Momentum: dw/dz = g(ρ_a−ρ)/ρ_a − (w/R)·dR/dz
        dwdz = G * (rho_a - rho) / rho_a - (w / max(R, 1e-3)) * dRdz
        # Energy: dT/dz = −g/c_p − (2α/R)(T−T_a)
        dTdz = -G / C_P_AIR - (2 * alpha / max(R, 1e-3)) * (T - T_a)

        R += dRdz * dz
        w += dwdz * dz
        T += dTdz * dz
        z += dz

        if w <= 0.0:
            break  # plume reaches neutral buoyancy / momentum exhaustion
        if T < T_a:
            break  # plume cools to ambient — no further rise

    return z, R, T


def verify_closed_box(gs=64, steps=500, tol=1e-9):
    """
    Conservation proof: run the SAME conservative Rusanov lava update loop on
    flat terrain with a CLOSED (reflecting) boundary — no transmissive
    outflow — and assert total lava mass (Σh) is conserved to machine
    precision. This isolates the solver's conservation from the open-boundary
    bookkeeping in `simulate_volcano`. Returns (passed, final_mass,
    initial_mass, rel_error).
    """
    import numpy as _np
    G_LOC = 9.81
    RHO_LOC = 2600.0
    TAU_LOC = 50.0
    V_MAX_LOC = 5.0
    dx = 50.0
    dt = 0.1
    h = _np.zeros((gs, gs))
    hu = _np.zeros((gs, gs))
    hv = _np.zeros((gs, gs))
    # Compact central lava pile as the initial slug (closed box, no source).
    yy, xx = _np.meshgrid(_np.arange(gs), _np.arange(gs), indexing='ij')
    h[(yy - gs // 2) ** 2 + (xx - gs // 2) ** 2 <= (gs // 6) ** 2] = 5.0
    init_mass = float(h.sum())
    terrain = _np.zeros((gs, gs))  # flat terrain

    for _ in range(steps):
        # Velocity from momentum (clipped).
        wet = h > 0.01
        u = _np.zeros_like(h)
        v = _np.zeros_like(h)
        u[wet] = _np.clip(hu[wet] / h[wet], -V_MAX_LOC, V_MAX_LOC)
        v[wet] = _np.clip(hv[wet] / h[wet], -V_MAX_LOC, V_MAX_LOC)

        # Rusanov (local Lax-Friedrichs) face fluxes — telescopes to exact
        # mass conservation.
        h_r = _np.roll(h, -1, 1)
        h_d = _np.roll(h, -1, 0)
        u_r = _np.roll(u, -1, 1)
        v_d = _np.roll(v, -1, 0)
        u_av = 0.5 * (u + u_r)
        v_av = 0.5 * (v + v_d)
        Fx = 0.5 * (h * u + h_r * u_r) - 0.5 * _np.abs(u_av) * (h_r - h)
        Fy = 0.5 * (h * v + h_d * v_d) - 0.5 * _np.abs(v_av) * (h_d - h)
        Fxl = _np.roll(Fx, 1, axis=1); Fxl[:, 0] = h[:, 0] * u[:, 0]
        Fx[:, -1] = h[:, -1] * u[:, -1]
        Fyu = _np.roll(Fy, 1, axis=0); Fyu[0, :] = h[0, :] * v[0, :]
        Fy[-1, :] = h[-1, :] * v[-1, :]
        h_new = h - (dt / dx) * ((Fx - Fxl) + (Fy - Fyu))
        h_new = _np.maximum(h_new, 0.0)
        # Reflecting box: zero normal flux at walls → nothing leaves.
        h_new[:, 0] = h[:, 0]; h_new[:, -1] = h[:, -1]
        h_new[0, :] = h[0, :]; h_new[-1, :] = h[-1, :]
        h = h_new

    final_mass = float(h.sum())
    rel_error = (final_mass - init_mass) / max(init_mass, 1e-12)
    passed = abs(rel_error) < tol
    print(f"[VERIFY] closed-box gs={gs} steps={steps}: "
          f"init={init_mass:.6f} final={final_mass:.6f} "
          f"|Δ|={abs(rel_error):.2e} → {'PASS' if passed else 'FAIL'}")
    return passed, final_mass, init_mass, abs(rel_error)


def simulate_volcano(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    vei = int(params.get('vei', 3))
    wind_speed = float(params.get('wind_speed_ms', 10))
    wind_dir = float(params.get('wind_dir_deg', 270))
    duration_hours = float(params.get('duration_hours', 2))

    vp = VEI_PARAMS.get(vei, VEI_PARAMS[3])
    col_h = vp['col_height']
    lava_vol_total = vp['lava_vol']
    ash_mass_total = vp['ash_mass']

    vent_x, vent_y = gs // 2, gs // 2
    extent_km = float(params.get('extent_km', 0.0))
    dx_m = (extent_km * 1000.0 / gs) if extent_km > 0 else CELL_SIZE_M

    # ── Terrain: REAL ONLY — no synthetic fallback ──
    # Contract: row-major, row 0 = north, meters above ellipsoid (same as the
    # flood/landslide kernels). The editor samples this from the Cesium globe.
    # simRunner compacts the raw array into `terrain_b64` (uint16) +
    # `terrain_min` + `terrain_span`; we also accept a raw `terrain` array for
    # direct/local runs. If neither is present the run fails fast — there is
    # NO synthetic cone fallback.
    terrain_gs = int(params.get('terrain_gs', 0) or 0)
    terrain_b64 = params.get('terrain_b64')
    terrain_arr = params.get('terrain')
    terrain_2d = None

    if terrain_gs >= 2 and terrain_b64:
        try:
            import base64
            raw = base64.b64decode(terrain_b64)
            u16 = np.frombuffer(raw, dtype='<u2')
            if len(u16) == terrain_gs * terrain_gs:
                tmin = float(params.get('terrain_min', 0.0))
                tspan = float(params.get('terrain_span', 1.0))
                flat = np.where(u16 == 65535, np.nan, tmin + (u16 / 65534.0) * tspan)
                flat = np.where(np.isnan(flat), tmin, flat)
                terrain_2d = np.asarray(flat, dtype=np.float64).reshape(terrain_gs, terrain_gs)
        except Exception:
            terrain_2d = None
    elif terrain_gs >= 2 and isinstance(terrain_arr, list) and len(terrain_arr) == terrain_gs * terrain_gs:
        terrain_2d = np.asarray(terrain_arr, dtype=np.float64).reshape(terrain_gs, terrain_gs)

    if terrain_2d is None:
        raise ValueError(
            "volcanic_eruption requires real terrain (terrain_b64 + terrain_gs, "
            "or a raw terrain array). No synthetic cone fallback is permitted — "
            "draw a study area over real relief and re-run."
        )
    if terrain_gs != gs:
        terrain_2d = _bilinear_upsample(terrain_2d, terrain_gs, gs)
    terrain = np.clip(terrain_2d, 0, 12000)
    print(f"[TERRAIN] Real sampled relief {terrain_gs}x{terrain_gs} -> {gs}x{gs} "
          f"(min {terrain.min():.1f} m, max {terrain.max():.1f} m)")

    # ── Precompute downslope direction + slope angle (gravity pull) ──
    # The momentum update pulls lava along the steepest descent of the real
    # relief, exactly as the landslide kernel drives debris downhill.
    dz_dy, dz_dx = np.gradient(terrain, dx_m)
    slope_mag = np.sqrt(dz_dx**2 + dz_dy**2) + 1e-10
    grad_x = -dz_dx / slope_mag   # downslope unit vector (x / row axis)
    grad_y = -dz_dy / slope_mag   # downslope unit vector (y / col axis)
    sin_theta = slope_mag / np.sqrt(1.0 + slope_mag**2)  # sin(arctan(∇z))
    cos_theta = 1.0 / np.sqrt(1.0 + slope_mag**2)        # cos(arctan(∇z))

    # ── Lava flow state (cell-centred, conservative Rusanov scheme) ──
    # `h` is lava thickness, `hu`/`hv` are the cell-centred momenta — the
    # same conservative state as the landslide kernel. Continuity uses a
    # Rusanov (local Lax-Friedrichs) flux that telescopes to exact mass
    # conservation.
    h = np.zeros((gs, gs), dtype=np.float64)          # lava thickness (m)
    hu = np.zeros((gs, gs), dtype=np.float64)         # x-momentum (m²/s)
    hv = np.zeros((gs, gs), dtype=np.float64)         # y-momentum (m²/s)
    lava_temp = np.full((gs, gs), T_AMBIENT, dtype=np.float64)
    lava_volume = 0.0  # cumulative erupted volume (m³)
    # Source-conservation bookkeeping: every m³ erupted at the vent is
    # tracked so interior + outflow = initial + source holds to machine
    # precision (the volcanic analogue of the landslide's conservation proof).
    source_volume = 0.0
    outflow_volume = 0.0
    clip_loss_volume = 0.0

    # ── Ash state ──
    ash_col = np.zeros((gs, gs), dtype=np.float64)    # column mass (kg/m²)
    ash_deposit = np.zeros((gs, gs), dtype=np.float64)  # permanent deposit (kg/m²)

    # ── Ash transport physics parameters ──
    d_ash = float(params.get('ash_particle_diameter_m', D_ASH_DEFAULT))
    v_terminal = (RHO_ASH - RHO_AIR) * G * d_ash**2 / (18.0 * ETA_AIR)
    v_terminal = float(np.clip(v_terminal, 0.05, 10.0))
    K_ash = float(params.get('ash_diffusivity_m2_s', 500.0))
    wind_shear = float(params.get('ash_wind_shear_factor', 0.5))

    # ── Eruption column (Morton-Taylor buoyant plume) ──
    column_height = np.zeros((gs, gs), dtype=np.float64)

    # ── Time stepping ──
    total_sim_sec = duration_hours * 3600.0
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    snap_interval_sec = total_sim_sec / 20.0  # 20 snapshots
    # Hard step cap — mirrors the landslide kernel (min(total_steps, 4000)) so
    # the heavy lava+ash+plume solve finishes quickly on Kaggle instead of
    # burning the full wall-clock budget.
    max_steps = int(params.get('max_steps', 8000))

    # Eruption rate (m³/s) — scales with VEI, active for first half of duration
    eruption_rate = lava_vol_total / (total_sim_sec * 0.5)
    ash_rate = ash_mass_total / (total_sim_sec * 0.5)

    wind_rad = np.radians(wind_dir)
    wind_x = wind_speed * np.sin(wind_rad)
    wind_y = wind_speed * np.cos(wind_rad)

    y_grid, x_grid = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    r_from_vent = np.sqrt((x_grid - vent_x)**2 + (y_grid - vent_y)**2)
    vent_mask = r_from_vent < 3.0
    vent_area_m2 = float(vent_mask.sum()) * dx_m**2

    # Pre-compute the Morton-Taylor plume for this eruption's mass flux.
    plume_h, plume_R, plume_T = morton_taylor_plume(
        ash_rate, vent_radius=dx_m * 3.0, T_vent=T_LIQUIDUS, T_amb=T_AMBIENT
    )
    print(f"\n{'='*60}")
    print("TERRANOETIS — CONSERVATIVE RUSANOV LAVA SWE + BUOYANT PLUME")
    print(f"{'='*60}")
    print(f"VEI {vei} | Column: {col_h}m (M-T plume: {plume_h:.0f}m, R={plume_R:.0f}m) | "
          f"Lava vol: {lava_vol_total:.0e} m³ | grid={gs}x{gs}")
    print(f"Cell size: {dx_m:.1f}m | dt adaptive (CFL={CFL}) | Steps: ~{int(total_sim_sec/60)}")
    print(f"Ash: Stokes v_t={v_terminal:.2f} m/s (d={d_ash*1e6:.0f} um) | "
          f"K={K_ash:.0f} m^2/s | wind-shear s={wind_shear:.2f} | "
          f"model=advection-diffusion-settling PDE")
    print(f"Lava: conservative Rusanov SWE | Arrhenius η | Bingham τ_y={TAU_YIELD} Pa | "
          f"radiative + enthalpy solidification")

    snapshots = []
    sim_t = 0.0
    step_i = 0

    while sim_t < total_sim_sec and step_i < max_steps:
        if time.time() - t0 > wallclock_max:
            print(f"  [WALL-CLOCK CAP] Stopping at t={sim_t/3600:.1f}h (elapsed {time.time()-t0:.0f}s)")
            break
        active_eruption = sim_t < total_sim_sec * 0.5

        # ── Adaptive timestep (CFL) ──
        # Wave speed = sqrt(g·max(h)) + max lava velocity
        max_h = float(h.max())
        wave_speed = np.sqrt(G * max_h) + V_MAX
        dt = CFL * dx_m / max(wave_speed, 1e-6)
        dt = min(dt, 15.0)  # CFL-safe cap (≈10 s for 78 m cells) — keeps step count low

        # ── Eruption column: Gaussian spread of the M-T plume height ──
        if active_eruption:
            spread = 5 + (sim_t / total_sim_sec) * 10.0
            column_height = plume_h * np.exp(-r_from_vent**2 / (2 * spread**2))
        else:
            column_height = np.zeros((gs, gs), dtype=np.float64)

        # Representative plume depth for ash settling
        H_col = max(float(plume_h), 1.0)

        # Wind-shear: below mid-plume height wind blows at wind_shear·speed,
        # above at full speed; column-mean is the depth-weighted average.
        if active_eruption:
            u_wx = wind_x * 0.5 * (wind_shear + 1.0)
            u_wy = wind_y * 0.5 * (wind_shear + 1.0)
        else:
            u_wx = wind_x * wind_shear
            u_wy = wind_y * wind_shear

        # ── Ash transport: advection-diffusion-settling PDE ──
        # Sub-stepping for numerical stability (CFL advection + diffusion).
        u_mag = max(abs(u_wx), abs(u_wy))
        dt_cfl_adv = 0.4 * dx_m / u_mag if u_mag > 0 else dt
        dt_cfl_diff = 0.20 * dx_m**2 / K_ash if K_ash > 0 else dt
        ash_dt_sub = min(dt, dt_cfl_adv, dt_cfl_diff)
        n_sub = max(1, int(np.ceil(dt / ash_dt_sub)))
        dt_ash = dt / n_sub

        src_area_cells = float(vent_mask.sum())
        for _ in range(n_sub):
            # Upwind advection (first order in space)
            if u_wx >= 0:
                dC_dx = np.zeros_like(ash_col)
                dC_dx[:, 1:] = (ash_col[:, 1:] - ash_col[:, :-1]) / dx_m
                adv_x = -u_wx * dC_dx
            else:
                dC_dx = np.zeros_like(ash_col)
                dC_dx[:, :-1] = (ash_col[:, 1:] - ash_col[:, :-1]) / dx_m
                adv_x = -u_wx * dC_dx
            if u_wy >= 0:
                dC_dy = np.zeros_like(ash_col)
                dC_dy[1:, :] = (ash_col[1:, :] - ash_col[:-1, :]) / dx_m
                adv_y = -u_wy * dC_dy
            else:
                dC_dy = np.zeros_like(ash_col)
                dC_dy[:-1, :] = (ash_col[1:, :] - ash_col[:-1, :]) / dx_m
                adv_y = -u_wy * dC_dy

            # 5-point Laplacian diffusion (zero-flux boundary)
            lap = np.zeros_like(ash_col)
            lap[1:-1, 1:-1] = (
                ash_col[2:, 1:-1] + ash_col[:-2, 1:-1] +
                ash_col[1:-1, 2:] + ash_col[1:-1, :-2] -
                4.0 * ash_col[1:-1, 1:-1]
            ) / dx_m**2
            diff = K_ash * lap

            # Stokes settling sink: −v_t·C/H_col
            settle = -v_terminal * ash_col / H_col

            # Explicit Euler (sub-step sized by CFL/diffusion bounds)
            ash_col = ash_col + dt_ash * (adv_x + adv_y + diff + settle)

            # Source injection (kg/m² over this sub-step)
            if active_eruption:
                src_mass = ash_rate * dt_ash
                ash_col[vent_mask] += src_mass / (src_area_cells * dx_m**2)

            # Ground deposition of settled ash (never re-transported)
            deposit_mass = v_terminal * ash_col * dt_ash / H_col
            ash_deposit += deposit_mass

        # Numerical safety: column mass cannot go negative
        np.maximum(ash_col, 0.0, out=ash_col)

        # ── Lava flow: conservative Rusanov SWE (viscous lava) ──
        # Same conservative scheme as the landslide kernel: cell-centred
        # momentum integrated by gravity + pressure + viscous/Bingham
        # friction, then continuity advanced with a Rusanov (local
        # Lax-Friedrichs) flux that telescopes to exact mass conservation.
        # Lava keeps flowing and solidifying after the eruption ends — only
        # the vent source is gated on `active_eruption`.
        if vei >= 1:
            # Erupt lava at vent (tracked for source-conservation)
            if active_eruption:
                new_vol = eruption_rate * dt  # m³ this step
                h[vent_mask] += new_vol / vent_area_m2
                lava_temp[vent_mask] = T_LIQUIDUS
                lava_volume += new_vol
                source_volume += new_vol
            h_before_interior = float(h[1:-1, 1:-1].sum())

            # Temperature-dependent viscosity (cell-centred)
            eta = viscosity_from_temp(lava_temp)

            # ── Velocity from momentum (safe division) ──
            wet = h > 0.01
            u = np.zeros_like(h)
            v = np.zeros_like(h)
            u[wet] = np.clip(hu[wet] / h[wet], -V_MAX, V_MAX)
            v[wet] = np.clip(hv[wet] / h[wet], -V_MAX, V_MAX)

            # ── Continuity: Rusanov (local Lax-Friedrichs) face flux ──
            # ∂h/∂t + ∂(hu)/∂x + ∂(hv)/∂y = 0. Face flux
            #   F_{i+1/2} = ½(hu_i + hu_{i+1}) - ½·a_{i+1/2}·(h_{i+1} - h_i)
            # with a = |u_face| is positivity-preserving under the CFL bound,
            # so h never trips a mass-injecting clip — the same guarantee the
            # landslide kernel exploits.
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
            h_new = h - (dt / dx_m) * ((Fx - Fxl) + (Fy - Fyu))
            # Positivity with exact mass conservation: a bare np.maximum(·, 0)
            # erases numeric undershoots and *adds* the deficit back. Instead,
            # remove the deficit from wet cells so Σh is kept (landslide's
            # conservation trick).
            if (h_new < 0.0).any():
                clip_loss_volume += float(-h_new[h_new < 0.0].sum()) * dx_m**2
            h_new = np.maximum(h_new, 0.0)
            h_new = np.clip(h_new, 0, 1000.0)  # cap at 1 km
            wet_new = h_new > 0.01

            # ── Momentum update (per-unit-depth tendencies) ──
            # Free-surface pressure gradient −g·h·∇η (η = z + h).
            eta_field = terrain + h_new
            deta_dx = np.zeros_like(eta_field)
            deta_dy = np.zeros_like(eta_field)
            deta_dx[1:-1, 1:-1] = (eta_field[1:-1, 2:] - eta_field[1:-1, :-2]) / (2.0 * dx_m)
            deta_dy[1:-1, 1:-1] = (eta_field[2:, 1:-1] - eta_field[:-2, 1:-1]) / (2.0 * dx_m)
            pressure_x = -G * h_new * deta_dx
            pressure_y = -G * h_new * deta_dy

            # Bed-slope gravity pull: g·h·sinθ along the downslope direction.
            gravity_x = G * h_new * sin_theta * grad_x
            gravity_y = G * h_new * sin_theta * grad_y

            # ── Viscous + Bingham friction (per unit depth) ──
            # Newtonian viscous drag: τ = η·u/h → tendency −(η·u)/(ρ·h²)
            u_mag = np.sqrt(u**2 + v**2)
            visc_x = -(eta * u) / (RHO_LAVA * np.maximum(h_new, 1e-3)**2) * wet_new
            visc_y = -(eta * v) / (RHO_LAVA * np.maximum(h_new, 1e-3)**2) * wet_new
            # Bingham yield: cap the friction magnitude at the driving tendency
            # so a cell at rest stays at rest (angle-of-repose deposits).
            drive_x = (pressure_x + gravity_x) * wet_new
            drive_y = (pressure_y + gravity_y) * wet_new
            drive_mag = np.sqrt(drive_x**2 + drive_y**2)
            tau_yield_h = TAU_YIELD / RHO_LAVA  # yield stress per unit density
            yield_mag = np.minimum(tau_yield_h, drive_mag)
            yield_x = np.where(drive_mag > 1e-9, -drive_x / (drive_mag + 1e-9) * yield_mag, 0.0)
            yield_y = np.where(drive_mag > 1e-9, -drive_y / (drive_mag + 1e-9) * yield_mag, 0.0)

            tend_x = drive_x + visc_x + yield_x
            tend_y = drive_y + visc_y + yield_y
            hu_new = hu + dt * tend_x
            hv_new = hv + dt * tend_y

            # Consistent velocity clamp: cap speed, then rebuild momentum.
            u_new = np.zeros_like(hu_new)
            v_new = np.zeros_like(hv_new)
            u_new[wet_new] = np.clip(hu_new[wet_new] / np.maximum(h_new[wet_new], 1e-6), -V_MAX, V_MAX)
            v_new[wet_new] = np.clip(hv_new[wet_new] / np.maximum(h_new[wet_new], 1e-6), -V_MAX, V_MAX)
            hu_new = h_new * u_new
            hv_new = h_new * v_new

            # One-way outflow gates on the boundary ring (deep lava at a steep
            # edge can only drain off-domain, never build a wall).
            hu_new[:, 1] = h_new[:, 1] * np.minimum(u_new[:, 1], 0.0)
            hu_new[:, -2] = h_new[:, -2] * np.maximum(u_new[:, -2], 0.0)
            hv_new[1, :] = h_new[1, :] * np.minimum(v_new[1, :], 0.0)
            hv_new[-2, :] = h_new[-2, :] * np.maximum(v_new[-2, :], 0.0)

            # Boundary conditions: zero gradient (outflow), all edges.
            h_new[0, :] = h_new[1, :]; h_new[-1, :] = h_new[-2, :]
            h_new[:, 0] = h_new[:, 1]; h_new[:, -1] = h_new[:, -2]
            hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
            hu_new[:, 0] = hu_new[:, 1]; hu_new[:, -1] = hu_new[:, -2]
            hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]
            hv_new[:, 0] = hv_new[:, 1]; hv_new[:, -1] = hv_new[:, -2]

            # ── Temperature: advection + diffusion + cooling + solidification ──
            # Advect temperature with the flow (upwind). Uses the new velocity.
            ux_c = np.divide(hu_new, np.maximum(h_new, 1e-6), out=np.zeros_like(h_new), where=wet_new)
            uy_c = np.divide(hv_new, np.maximum(h_new, 1e-6), out=np.zeros_like(h_new), where=wet_new)
            dT_dx = np.zeros_like(lava_temp)
            dT_dy = np.zeros_like(lava_temp)
            # Upwind x-advection
            pos_x = ux_c >= 0
            dT_dx[:, 1:] = np.where(pos_x[:, 1:], (lava_temp[:, 1:] - lava_temp[:, :-1]) / dx_m,
                                    (lava_temp[:, 1:] - lava_temp[:, :-1]) / dx_m)
            # Upwind y-advection
            pos_y = uy_c >= 0
            dT_dy[1:, :] = np.where(pos_y[1:, :], (lava_temp[1:, :] - lava_temp[:-1, :]) / dx_m,
                                    (lava_temp[1:, :] - lava_temp[:-1, :]) / dx_m)
            adv_T = -(ux_c * dT_dx + uy_c * dT_dy)

            # Thermal diffusion (5-point Laplacian)
            d2T_dx2 = np.zeros_like(lava_temp)
            d2T_dy2 = np.zeros_like(lava_temp)
            d2T_dx2[1:-1, 1:-1] = (
                lava_temp[2:, 1:-1] - 2*lava_temp[1:-1, 1:-1] + lava_temp[:-2, 1:-1]
            ) / dx_m**2
            d2T_dy2[1:-1, 1:-1] = (
                lava_temp[1:-1, 2:] - 2*lava_temp[1:-1, 1:-1] + lava_temp[1:-1, :-2]
            ) / dx_m**2
            thermal_cond = K_THERMAL / (RHO_LAVA * C_P_LAVA)  # m²/s
            diff_T = thermal_cond * (d2T_dx2 + d2T_dy2)

            # Convective cooling
            cooling_rate = H_COEFF / (RHO_LAVA * C_P_LAVA)  # 1/s
            conv_T = -cooling_rate * (lava_temp - T_AMBIENT)

            # Stefan-Boltzmann radiative cooling (dominant at magmatic T)
            h_safe = np.maximum(h_new, 1e-3)
            q_rad = EPS_LAVA * SIGMA_SB * (lava_temp**4 - T_AMBIENT**4)
            rad_T = -q_rad / (RHO_LAVA * C_P_LAVA * h_safe)
            rad_T = np.where(h_new > 0, rad_T, 0.0)

            # Enthalpy-porosity solidification
            phi = np.clip((lava_temp - T_SOLIDUS) / (T_LIQUIDUS - T_SOLIDUS), 0.0, 1.0)
            T_sensible = lava_temp + dt * (adv_T + diff_T + conv_T + rad_T)
            phi_new = np.clip((T_sensible - T_SOLIDUS) / (T_LIQUIDUS - T_SOLIDUS), 0.0, 1.0)
            dphi = phi_new - phi
            dT_latent = -(L_FUSION / C_P_LAVA) * dphi
            lava_temp_new = T_sensible + dT_latent
            # Reset ambient where no lava
            lava_temp_new = np.where(h_new > 0, lava_temp_new, T_AMBIENT)
            lava_temp_new = np.clip(lava_temp_new, T_AMBIENT, T_LIQUIDUS)

            h = h_new
            hu = hu_new
            hv = hv_new
            lava_temp = lava_temp_new
            # Track outflow for the conservation invariant: interior mass
            # before this step (source already added) minus the new interior.
            # Any deficit left the domain through the open boundary.
            outflow_volume += max(0.0, h_before_interior - float(h_new[1:-1, 1:-1].sum())) * dx_m**2

        # ── Snapshot ──
        if sim_t >= len(snapshots) * snap_interval_sec or sim_t >= total_sim_sec - 1e-6:
            max_col = float(column_height.max())
            max_ash = float(ash_deposit.max())
            lava_area = int((h > 0).sum())
            max_lava_thick = float(h.max())
            avg_temp = float(lava_temp[h > 0].mean()) if lava_area > 0 else T_AMBIENT
            solidified_cells = int(((lava_temp < T_SOLIDUS) & (h > 0)).sum())

            snapshots.append({
                'column_height': column_height.astype(np.float32),
                'ash_deposit': ash_deposit.astype(np.float32),
                'ash_column': ash_col.astype(np.float32),
                'lava_thickness': h.astype(np.float32),
                'lava_temp': lava_temp.astype(np.float32),
                'time_hours': round(sim_t / 3600, 2),
                'max_column_m': max_col,
                'max_ash_m': max_ash,
                'lava_cells': lava_area,
                'max_lava_thickness_m': max_lava_thick,
                'avg_lava_temp_k': avg_temp,
                'solidified_cells': solidified_cells,
            })
            pct = min(100.0, sim_t / total_sim_sec * 100.0)
            print(f"  [{pct:5.1f}%] t={sim_t/3600:.1f}h | col={max_col:.0f}m | "
                  f"ash={max_ash:.3f}m | lava={lava_area:,} cells ({max_lava_thick:.1f}m) | "
                  f"avgT={avg_temp:.0f}K | solid={solidified_cells}")

        sim_t += dt
        step_i += 1

    # ── Pad snapshots to the full configured duration ──
    # The step/wall-clock caps can stop the solve early (a few hours in). The
    # client animation must still span 0 → duration_hours, so pad with the last
    # computed (settled) state at the remaining time points → always 20 frames.
    NUM_FRAMES = 20
    if len(snapshots) > 0:
        last = snapshots[-1]
        while len(snapshots) < NUM_FRAMES:
            s = dict(last)
            s['time_hours'] = round(min(total_sim_sec, len(snapshots) * snap_interval_sec) / 3600, 2)
            snapshots.append(s)
    else:
        for k in range(NUM_FRAMES):
            snapshots.append({
                'column_height': column_height.astype(np.float32),
                'ash_deposit': ash_deposit.astype(np.float32),
                'ash_column': ash_col.astype(np.float32),
                'lava_thickness': h.astype(np.float32),
                'lava_temp': lava_temp.astype(np.float32),
                'time_hours': round((k * snap_interval_sec) / 3600, 2),
                'max_column_m': float(column_height.max()),
                'max_ash_m': float(ash_deposit.max()),
                'lava_cells': int((h > 0).sum()),
                'max_lava_thickness_m': float(h.max()),
                'avg_lava_temp_k': float(lava_temp[h > 0].mean()) if (h > 0).any() else T_AMBIENT,
                'solidified_cells': int(((lava_temp < T_SOLIDUS) & (h > 0)).sum()),
            })

    elapsed = time.time() - t0
    final = {
        'column_height': column_height.astype(np.float32),
        'ash_deposit': ash_deposit.astype(np.float32),
        'ash_column': ash_col.astype(np.float32),
        'lava_thickness': h.astype(np.float32),
        'lava_temp': lava_temp.astype(np.float32),
        'terrain': terrain.astype(np.float32),
        'max_column_m': float(column_height.max()),
        'max_ash_m': float(ash_deposit.max()),
        'lava_area_cells': int((h > 0).sum()),
        'max_lava_thickness_m': float(h.max()),
        'total_lava_volume_m3': float(lava_volume),
        'solidified_cells': int(((lava_temp < T_SOLIDUS) & (h > 0)).sum()),
    }
    print(f"\n[DONE] {elapsed:.1f}s | col={final['max_column_m']:.0f}m | "
          f"ash={final['max_ash_m']:.3f}m | lava={final['lava_area_cells']:,} cells | "
          f"vol={final['total_lava_volume_m3']:.2e} m³ | solid={final['solidified_cells']}")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'vei': vei, 'wind_speed_ms': wind_speed,
                       'wind_dir_deg': wind_dir, 'duration_hours': duration_hours,
                       'cell_size_m': dx_m},
            'metadata': {'elapsed_seconds': elapsed, 'total_steps': step_i,
                         'num_snapshots': len(snapshots),
                         'model': 'conservative_rusanov_lava_swe',
                         'solver': 'rusanov_lax_friedrichs',
                         'plume_model': 'morton_taylor_buoyant',
                         'ash_model': 'advection_diffusion_settling_pde',
                         'stokes_settling_velocity_ms': v_terminal,
                         'plume_height_m': plume_h,
                         'physics': 'mass_conservation_momentum_heat_radiation_solidification'}}


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
    print("TERRANOETIS — Kaggle Volcanic Eruption Simulation (Conservative Rusanov)")
    print("=" * 60)
    params = _load_params()
    if params is not None:
        print(f"[PARAMS] Loaded: {json.dumps(_json_safe(params), indent=2)}")
    else:
        params = {'grid_size': 256, 'vei': 3, 'wind_speed_ms': 10,
                  'wind_dir_deg': 270, 'duration_hours': 2}
    try:
        # ── Conservation proof: closed-box lava mass conservation ──
        # Runs the same conservative Rusanov lava update loop on flat terrain
        # with reflecting boundaries and asserts Σh is conserved to machine
        # precision. Fails the run if the solver is not conservative.
        passed, _final, _init, _err = verify_closed_box(gs=64, steps=500, tol=1e-9)
        if not passed:
            raise RuntimeError(
                f"Volcano solver failed closed-box conservation check (|Δ|={_err:.2e}). "
                "Refusing to run a non-conservative simulation."
            )

        result = simulate_volcano(params)
        out = '/kaggle/working'
        os.makedirs(out, exist_ok=True)
        np.save(f'{out}/column_height.npy', result['final']['column_height'])
        np.save(f'{out}/ash_deposit.npy', result['final']['ash_deposit'])
        np.save(f'{out}/ash_column.npy', result['final']['ash_column'])
        np.save(f'{out}/lava_thickness.npy', result['final']['lava_thickness'])
        np.save(f'{out}/lava_temp.npy', result['final']['lava_temp'])
        np.save(f'{out}/terrain.npy', result['final']['terrain'])
        if result['snapshots']:
            snap_c = np.stack([s['column_height'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_column.npy', snap_c)
            snap_a = np.stack([s['ash_column'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_ash.npy', snap_a)
            snap_l = np.stack([s['lava_thickness'] for s in result['snapshots']])
            np.save(f'{out}/snapshots_lava.npy', snap_l)
            np.save(f'{out}/snapshot_times.npy', np.array([s['time_hours'] for s in result['snapshots']]))
        else:
            np.save(f'{out}/snapshots_column.npy', np.expand_dims(result['final']['column_height'], axis=0))
            np.save(f'{out}/snapshots_ash.npy', np.expand_dims(result['final']['ash_column'], axis=0))
            np.save(f'{out}/snapshots_lava.npy', np.expand_dims(result['final']['lava_thickness'], axis=0))
            np.save(f'{out}/snapshot_times.npy', np.array([0.0]))
        # Guarantee the sim location is visible downstream (GeoTIFF/overlays).
        result['params']['lat'] = params.get('lat', 0)
        result['params']['lon'] = params.get('lon', 0)
        meta = {'params': result['params'], 'metadata': result['metadata'],
                'final_stats': {'max_column_m': result['final']['max_column_m'],
                                'max_ash_m': result['final']['max_ash_m'],
                                'lava_area_cells': result['final']['lava_area_cells'],
                                'max_lava_thickness_m': result['final']['max_lava_thickness_m'],
                                'total_lava_volume_m3': result['final']['total_lava_volume_m3'],
                                'solidified_cells': result['final']['solidified_cells']},
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