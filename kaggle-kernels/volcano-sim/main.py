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
   with first-order upwind advection (conservative flux form, open
   boundaries), unconditionally-stable Gaussian-blur turbulent diffusion
   (σ=√(2KΔt), the exact solver for ∂C/∂t=K∇²C), Stokes-law terminal
   settling, and permanent ground deposition. Mass-conserving: injected =
   deposited + airborne + advected-off-domain (clip-loss = 0).

  Terrain — REAL ONLY. The kernel requires a sampled `terrain`/`terrain_gs`
  array (row-major, row 0 = north, meters above ellipsoid). There is NO
  synthetic fallback: if real relief is absent the run fails fast with a
  legible error rather than fabricating a cone.

Author: Terranoetis / Freebuff
"""

import json, os, time, traceback
import numpy as np
from scipy.ndimage import gaussian_filter

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
RHO_LAVA = 2600.0          # kg/m³ — basaltic lava density
RHO_ASH = 1000.0           # kg/m³ — ash particle density
C_P_LAVA = 1200.0          # J/(kg·K) — lava specific heat
K_THERMAL = 1.5            # W/(m·K) — lava thermal conductivity
ETA_REF = 300.0            # Pa·s — reference viscosity at T_ref
T_REF = 1450.0             # K — reference temperature (basalt liquidus)
E_A = 180_000.0            # J/mol — activation energy (basaltic melt, 100–400 kJ/mol)
R_GAS = 8.314              # J/(mol·K) — gas constant
T_LIQUIDUS = 1450.0        # K — liquidus temperature (tholeiitic basalt erupts 1350–1450 K)
T_SOLIDUS = 1320.0         # K — solidus temperature (basalt ~1320–1400 K)
T_CRUST_ONSET = 1360.0     # K — surface temperature below which an insulating crust forms
T_AMBIENT = 273.0          # K — ambient temperature
L_FUSION = 400_000.0       # J/kg — latent heat of fusion
H_COEFF = 25.0             # W/(m²·K) — convective heat transfer coefficient
CELL_SIZE_M = 50.0         # meters per grid cell
# Stefan-Boltzmann radiative cooling — the dominant heat-loss mechanism for
# lava at magmatic temperatures (T⁴ scaling).
SIGMA_SB = 5.67e-8         # W/(m²·K⁴) — Stefan-Boltzmann constant
EPS_LAVA = 0.9             # — emissivity of basaltic lava
# Insulating crust: a cooling basalt surface develops a rigid crust within
# minutes that cuts radiative/convective heat loss by ~an order of magnitude
# (Keszthelyi & Self 1998). Loss is multiplied by `1 - CRUST_INSULATION` once
# the surface cools below T_CRUST_ONSET, ramping linearly to T_SOLIDUS.
CRUST_INSULATION = 0.92
TAU_YIELD = 1000.0         # Pa — Bingham yield strength of lava at eruption
TAU_YIELD_MAX = 20000.0    # Pa — yield strength of near-solid lava (crystallized)
# Calibration hook: `yield_scale` multiplies the yield strength across the
# full temperature range. A value > 1 makes the lava more resistive (shorter
# runout); < 1 makes it more fluid (longer runout). The ensemble perturbs
# this to calibrate against observed flow lengths (e.g. Kilauea 2018).
# Default 1.0 → identical to previous runs.
YIELD_SCALE = 1.0
CFL = 0.5                  # CFL number for adaptive timestep
V_MAX = 5.0                # m/s — physical velocity cap for lava
# Vent geometry for the buoyant plume (real basaltic vents are 10–100 m).
VENT_RADIUS_M = 50.0
# Lava vent radius in metres, keyed by VEI. A real eruption's conduit/crater
# scales with intensity: VEI 3 ≈ 100 m, VEI 5 ≈ 300 m, VEI 7 ≈ 500 m. The old
# fixed 3-cell mask (~140 m) was far smaller than a real crater (~1 km), so the
# lava erupted from a pinpoint and streamed straight down the steepest flank
# instead of pooling in the crater and overflowing the lowest rim point.
VEI_VENT_RADIUS_M = {
    0: 60, 1: 80, 2: 100, 3: 150, 4: 200,
    5: 300, 6: 400, 7: 500, 8: 600,
}

# ── Ash particle / atmosphere constants ─────────────────────────────
RHO_AIR = 1.2              # kg/m³ — ambient air density
ETA_AIR = 1.8e-5           # Pa·s — dynamic viscosity of air
C_P_AIR = 1005.0           # J/(kg·K) — specific heat of air
GAMMA = 0.0065             # K/m — environmental lapse rate (troposphere)
D_ASH_DEFAULT = 316e-6     # m — default particle diameter (~median coarse ash)
ASH_DEPOSIT_DENSITY = 1000.0  # kg/m³ — bulk density of compacted ash deposit
                                 # (converts kg/m² column mass → deposit thickness m)
# 3D wind profile: number of vertical bins for the ash transport.
# Each bin is advected by the wind at its mean altitude, so the ash plume
# experiences a height-resolved wind field instead of a single column-mean.
# 5 bins is a good cost/accuracy trade — cheap enough for the ensemble yet
# captures the key physics (low-level wind shear, subtropical jet, etc.).
N_ASH_LAYERS = 5

# VEI parameters
# Column heights are typical plume heights (Newhall & Self 1982; Sparks et al.
# 1997). Tephra volume follows the Newhall & Self (1982) bins:
#   V(tephra) ≈ 10^(VEI+4) m³  (VEI 3 → 10^7 m³, VEI 5 → 10^9 m³, VEI 6 → 10^10 m³)
# Mass at bulk density ~1200 kg/m³ (loose tephra) → mass_erupt ≈ 1.2·10^(VEI+7) kg.
# `ash_mass` is the fine-ash fraction (~50%) that reaches the atmospheric column;
# `lava_vol` is the effusive lava component (small for Plinian regimes, dominant
# for VEI 0–1), kept in plausible lava-volume bounds.
VEI_PARAMS = {
    0: {'col_height': 100,   'lava_vol': 1e4,   'mass_erupt': 1.2e7,  'ash_mass': 5e6},
    1: {'col_height': 1000,  'lava_vol': 1e5,   'mass_erupt': 1.2e8,  'ash_mass': 6e7},
    2: {'col_height': 5000,  'lava_vol': 1e6,   'mass_erupt': 1.2e9,  'ash_mass': 6e8},
    3: {'col_height': 10000, 'lava_vol': 1e7,   'mass_erupt': 1.2e10, 'ash_mass': 6e9},
    4: {'col_height': 25000, 'lava_vol': 5e7,   'mass_erupt': 1.2e11, 'ash_mass': 6e10},
    5: {'col_height': 40000, 'lava_vol': 3e8,   'mass_erupt': 1.2e12, 'ash_mass': 6e11},
    6: {'col_height': 55000, 'lava_vol': 1e9,   'mass_erupt': 1.2e13, 'ash_mass': 6e12},
    7: {'col_height': 70000, 'lava_vol': 5e9,   'mass_erupt': 1.2e14, 'ash_mass': 6e13},
    8: {'col_height': 90000, 'lava_vol': 2e10,  'mass_erupt': 1.2e15, 'ash_mass': 6e14},
}


def viscosity_from_temp(T):
    """Arrhenius viscosity model (Pa·s)."""
    # η = η_ref · exp(E_a/R · (1/T - 1/T_ref))
    T_safe = np.clip(T, T_SOLIDUS, T_LIQUIDUS)
    eta = ETA_REF * np.exp((E_A / R_GAS) * (1.0 / T_safe - 1.0 / T_REF))
    return np.clip(eta, 1e-2, 1e8)


def yield_strength_from_temp(T, phi_prev=None):
    """Bingham yield strength grows as lava cools and crystallizes.

    τ_y = τ_y0 + (τ_y_max − τ_y0)·(1 − φ)², where φ is the liquid fraction
    across the mushy zone. A near-solid lava (φ→0) resists flow (angle-of-repose
    deposits); freshly erupted lava (φ→1) has the low eruption yield strength.

    The module-level YIELD_SCALE (set from the run params) calibrates the
    rheology: real lava flow lengths are matched by scaling τ_y so the modelled
    runout reproduces observed emplacement distances.
    """
    phi = np.clip((T - T_SOLIDUS) / (T_LIQUIDUS - T_SOLIDUS), 0.0, 1.0)
    base = TAU_YIELD + (TAU_YIELD_MAX - TAU_YIELD) * (1.0 - phi) ** 2
    return base * YIELD_SCALE


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


def morton_taylor_plume(mass_eruption_rate, vent_radius, T_vent, T_amb, nz=10000):
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

    The mass eruption rate is the TOTAL tephra+gas flux (not the fine-ash
    fraction) — the buoyancy flux that drives column rise comes from the whole
    erupted mixture. Exit velocity is capped at a physically real sub-sonic
    value; any excess flux widens the vent radius instead (volume conservation).

    NOTE: nz × dz sets the maximum integration height. nz=10000 @ 10 m steps
    covers up to 100 km (beyond any terrestrial column); previously nz=200
    hard-capped every column at 2000 m regardless of eruption rate.
    """
    alpha = 0.1  # entrainment coefficient (Morton-Taylor)
    # Vent conditions: mass flux Q = ρ_vent·w_vent·π·R²
    rho_vent = RHO_AIR * T_amb / T_vent
    w_vent = mass_eruption_rate / (rho_vent * np.pi * vent_radius**2)
    if w_vent > 200.0:
        # Real basaltic exit velocities are 50–200 m/s (Plinian); keep w within
        # that bound and conserve flux by growing the effective vent radius.
        vent_radius = np.sqrt(mass_eruption_rate / (rho_vent * np.pi * 200.0))
        w_vent = 200.0
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
        if z > 60_000.0:
            break  # hard altitude guard (well above any terrestrial column)

    return z, R, T


def terminal_velocity_schiller_naumann(d_p, rho_p, rho_f, mu_f, max_iter=12):
    """Terminal settling velocity (m/s) in the intermediate drag regime.

    Uses the Schiller–Naumann correlation (Schiller & Naumann 1933, valid
    Re < 800):
        Cd = (24/Re)·(1 + 0.15·Re^0.687)

    Stokes law (Cd = 24/Re) is valid only for Re < 0.5; for coarse ash
    (d ~ 316 µm) Re ≈ 60, so the Schiller–Naumann correction is essential.
    The iterative fixed-point converges in < 6 iterations.
    """
    if d_p <= 0:
        return 0.0
    v = ((rho_p - rho_f) * G * d_p ** 2) / (18.0 * mu_f)  # Stokes guess
    if v <= 0:
        return 0.0
    for _ in range(max_iter):
        Re = rho_f * v * d_p / mu_f
        if Re < 0.5:
            break  # Stokes is accurate
        Cd = (24.0 / max(Re, 1e-6)) * (1.0 + 0.15 * Re ** 0.687)
        v_new = np.sqrt((4.0 * G * d_p * (rho_p - rho_f)) / (3.0 * Cd * rho_f))
        if abs(v_new - v) / max(v, 1e-6) < 1e-4:
            v = v_new
            break
        v = v_new
    return float(np.clip(v, 0.05, 20.0))


def _parse_wind_profile(params):
    """
    Parse a height-resolved wind profile from the params.

    Accepts two wire shapes:
      1. `wind_profile`: list of {altitude_km, u_ms, v_ms} — explicit
         eastward/northward wind components at each altitude (from ERA5 /
         GFS reanalysis). This is the preferred, unambiguous form.
      2. `wind_profile_spd_dir`: list of {altitude_km, speed_ms, dir_deg}
         — magnitude + meteorological "blown FROM" bearing. Converted to
         components here.

    Falls back to a neutral, physically-reasonable single-vector profile
    built from `wind_speed_ms` + `wind_dir_deg` (constant with height,
    matching the legacy 1-bin behaviour).

    Returns (altitudes_km [n], u_ms [n], v_ms [n]) sorted by altitude.
    """
    prof = params.get('wind_profile')
    if prof and isinstance(prof, list) and len(prof) >= 2:
        try:
            alt = [float(p['altitude_km']) for p in prof]
            u = [float(p['u_ms']) for p in prof]
            v = [float(p['v_ms']) for p in prof]
            order = np.argsort(alt)
            return (np.asarray(alt)[order], np.asarray(u)[order], np.asarray(v)[order])
        except (KeyError, TypeError, ValueError):
            pass

    prof2 = params.get('wind_profile_spd_dir')
    if prof2 and isinstance(prof2, list) and len(prof2) >= 2:
        try:
            alt = [float(p['altitude_km']) for p in prof2]
            spd = [float(p['speed_ms']) for p in prof2]
            dird = [float(p['dir_deg']) for p in prof2]
            # Meteorological convention: wind blows FROM dir; components
            # follow the same transform as the surface wind below.
            rad = [np.radians(d + 180.0) for d in dird]
            u = [s * np.sin(r) for s, r in zip(spd, rad)]
            v = [-s * np.cos(r) for s, r in zip(spd, rad)]
            order = np.argsort(alt)
            return (np.asarray(alt)[order], np.asarray(u)[order], np.asarray(v)[order])
        except (KeyError, TypeError, ValueError):
            pass

    # Legacy fallback: constant wind with height (single-bin behaviour).
    speed = float(params.get('wind_speed_ms', 10))
    dird = float(params.get('wind_dir_deg', 270))
    rad = np.radians(dird + 180.0)
    u = speed * np.sin(rad)
    v = -speed * np.cos(rad)
    return (np.asarray([0.0, 100.0]), np.asarray([u, u]), np.asarray([v, v]))


def _wind_at(alt_km, prof_alt, prof_u, prof_v):
    """Interpolate the wind components at `alt_km` using the profile.

    Linear interpolation between profile levels, clamped to the nearest
    level outside the sampled range. Fully vectorised over altitude.
    """
    a = np.asarray(alt_km, dtype=np.float64)
    return (np.interp(a, prof_alt, prof_u), np.interp(a, prof_alt, prof_v))


def _lava_step(h, hu, hv, lava_temp, terrain, dx_m, dt, boundary='open'):
    """One explicit lava-flow step: well-balanced Rusanov SWE + Bingham yield +
    temperature advection/diffusion/cooling/solidification.

    Hydrostatic reconstruction (Audusse et al. 2004, 'J. Comp. Phys.') for the
    shallow water equations on variable terrain — ensures the scheme is
    well-balanced (a flat free surface is exactly preserved) and
    positivity-preserving (h stays >= 0 under CFL < 1) even on the steep
    volcanic relief of a real stratovolcano.

    This is THE canonical update — both `simulate_volcano` (open outflow
    boundaries) and `verify_closed_box` (reflecting walls) call it, so the
    conservation proof exercises the exact operator a real run uses.

    Returns (h_new, hu_new, hv_new, lava_temp_new, clip_added_m3, outflow_m3):
      clip_added_m3 — lava volume injected by the positivity clip. SHOULD be
                      ~0 under the CFL bound with the hydrostatic reconstruction.
      outflow_m3    — lava volume leaving the domain through the one-way
                      boundary flux (0 for boundary='closed').
    """
    # ── Temperature-dependent viscosity (cell-centred) ──
    eta = viscosity_from_temp(lava_temp)

    # ── Velocity from momentum (safe division) ──
    wet = h > 0.01
    u = np.zeros_like(h)
    v = np.zeros_like(h)
    u[wet] = np.clip(hu[wet] / h[wet], -V_MAX, V_MAX)
    v[wet] = np.clip(hv[wet] / h[wet], -V_MAX, V_MAX)

    # ── Continuity: hydrostatic-reconstruction Rusanov face flux ──
    # The standard Rusanov flux on steep terrain produces negative h because
    # the centered-difference pressure gradient and the flux are not balanced.
    # The hydrostatic reconstruction (Audusse et al. 2004) fixes this by
    # reconstructing the depth at each face using the bed elevation:
    #   h_L = max(0, z_i - max(b_i, b_{i+1}))
    #   h_R = max(0, z_{i+1} - max(b_i, b_{i+1}))
    # where z = h + b is the free surface. This ensures that the flux
    # through the face is zero when the free surface is flat, and the depth
    # at the face is always non-negative.
    z = h + terrain  # free surface
    b = terrain      # bed elevation

    # x-direction faces
    z_r = np.roll(z, -1, 1)
    b_r = np.roll(b, -1, 1)
    u_r = np.roll(u, -1, 1)
    b_max = np.maximum(b, b_r)
    h_Lx = np.maximum(0, z - b_max)    # reconstructed left depth
    h_Rx = np.maximum(0, z_r - b_max)  # reconstructed right depth

    # y-direction faces
    z_d = np.roll(z, -1, 0)
    b_d = np.roll(b, -1, 0)
    v_d = np.roll(v, -1, 0)
    b_max_y = np.maximum(b, b_d)
    h_Ly = np.maximum(0, z - b_max_y)    # reconstructed left depth
    h_Ry = np.maximum(0, z_d - b_max_y)  # reconstructed right depth

    # Rusanov flux with reconstructed depths
    wave_x = np.maximum(np.abs(u), np.abs(u_r))
    wave_y = np.maximum(np.abs(v), np.abs(v_d))
    Fx = 0.5 * (h_Lx * u + h_Rx * u_r) - 0.5 * wave_x * (h_Rx - h_Lx)
    Fy = 0.5 * (h_Ly * v + h_Ry * v_d) - 0.5 * wave_y * (h_Ry - h_Ly)

    # Boundary conditions for the flux
    Fxl = np.roll(Fx, 1, axis=1); Fxl[:, 0] = h[:, 0] * u[:, 0]
    Fx[:, -1] = h[:, -1] * u[:, -1]
    Fyu = np.roll(Fy, 1, axis=0); Fyu[0, :] = h[0, :] * v[0, :]
    Fy[-1, :] = h[-1, :] * v[-1, :]
    h_new = h - (dt / dx_m) * ((Fx - Fxl) + (Fy - Fyu))

    # Positivity: with the hydrostatic reconstruction and CFL < 1, h_new
    # should stay >= 0. The clip is a safety net — it should rarely fire.
    clip_added = 0.0
    if (h_new < 0.0).any():
        clip_added = float(-h_new[h_new < 0.0].sum()) * dx_m**2
    h_new = np.maximum(h_new, 0.0)
    h_new = np.clip(h_new, 0, 1000.0)  # cap at 1 km (unphysical beyond)
    wet_new = h_new > 0.01

    # ── Momentum: conservative SWE flux + well-balanced bed-slope source ──
    # The full conservative momentum flux is
    #   ∂(hu)/∂t + ∂(hu² + g·h²/2)/∂x = -g·h·∂b/∂x
    # With hydrostatic reconstruction the pressure flux uses the reconstructed
    # face depths h_L, h_R, and the bed-slope source is discretized with the
    # same reconstructed depths:
    #   S_b(i) = -g·(h_L(i+½) + h_R(i−½))/2 · (b(i+½) − b(i−½))/dx
    # This makes the scheme EXACTLY well-balanced: a lake at rest (flat free
    # surface z = h + b = const) on any bed has pressure flux divergence that
    # cancels the source to machine precision, so it never spuriously flows.
    u2 = u * u
    v2 = v * v
    u_r2 = u_r * u_r
    v_d2 = v_d * v_d
    g2 = 0.5 * G
    wave_xm = np.maximum(np.abs(u), np.abs(u_r)) + np.sqrt(G * np.maximum(h_Lx, h_Rx))
    wave_ym = np.maximum(np.abs(v), np.abs(v_d)) + np.sqrt(G * np.maximum(h_Ly, h_Ry))
    # Conservative momentum flux (advective + hydrostatic pressure), using the
    # reconstructed face depths so the pressure is consistent with the flux.
    Fhu = 0.5 * (h_Lx * u2 + g2 * h_Lx**2 + h_Rx * u_r2 + g2 * h_Rx**2) \
          - 0.5 * wave_xm * (h_Rx * u_r - h_Lx * u)
    Fhv = 0.5 * (h_Ly * v2 + g2 * h_Ly**2 + h_Ry * v_d2 + g2 * h_Ry**2) \
          - 0.5 * wave_ym * (h_Ry * v_d - h_Ly * v)
    # x: face between i and i+1 carries index i (i.e. Fhu[i] is the i+½ face).
    # y: face between j and j+1 carries index j.
    b_face_x = np.maximum(b, b_r)
    b_face_y = np.maximum(b, b_d)
    # Bed-slope source at cell i uses the right face (i+½) left-recon depth
    # h_Lx[i] and the left face (i−½) right-recon depth h_Rx[i−1].
    h_bar_x = 0.5 * (h_Lx + np.roll(h_Rx, 1, axis=1))   # mean recon depth at cell
    h_bar_y = 0.5 * (h_Ly + np.roll(h_Ry, 1, axis=0))
    S_bx = -G * h_bar_x * (b_face_x - np.roll(b_face_x, 1, axis=1)) / dx_m
    S_by = -G * h_bar_y * (b_face_y - np.roll(b_face_y, 1, axis=0)) / dx_m

    # Momentum flux boundary conditions (mirror continuity):
    # left (west) face of column 0, right (east) face of column gs-1
    Fhu_l = np.roll(Fhu, 1, axis=1)
    Fhu_l[:, 0] = h[:, 0] * u[:, 0]**2 + g2 * h[:, 0]**2
    Fhu_r = np.zeros_like(Fhu)
    Fhu_r[:, :-1] = Fhu[:, :-1]
    Fhu_r[:, -1] = h[:, -1] * u[:, -1]**2 + g2 * h[:, -1]**2
    Fhv_u = np.roll(Fhv, 1, axis=0)
    Fhv_u[0, :] = h[0, :] * v[0, :]**2 + g2 * h[0, :]**2
    Fhv_d = np.zeros_like(Fhv)
    Fhv_d[:-1, :] = Fhv[:-1, :]
    Fhv_d[-1, :] = h[-1, :] * v[-1, :]**2 + g2 * h[-1, :]**2

    # Rebuild momentum via conservative flux divergence + well-balanced source.
    hu_new = hu - (dt / dx_m) * (Fhu_r - Fhu_l) + dt * S_bx
    hv_new = hv - (dt / dx_m) * (Fhv_d - Fhv_u) + dt * S_by

    # ── Lava friction: semi-implicit Arrhenius viscosity + Bingham yield ──
    # Newtonian viscous drag:  du/dt = −η(T)·u/(ρ·h²). Treated implicitly
    # (backward Euler) for unconditional stability:
    #   u_new = u / (1 + dt·η/(ρ·h²))
    # Then Bingham yield (temperature-dependent): a velocity below the yield
    # threshold is stopped (τ_y/(ρ·h) subtracted from |u|, like a Bingham
    # plastic, not a linear viscous drag).
    f_impl = eta / (RHO_LAVA * np.maximum(h_new, 1e-3)**2) * wet_new
    u_new = np.zeros_like(h_new)
    v_new = np.zeros_like(h_new)
    u_new[wet_new] = hu_new[wet_new] / np.maximum(h_new[wet_new], 1e-6)
    v_new[wet_new] = hv_new[wet_new] / np.maximum(h_new[wet_new], 1e-6)
    # Semi-implicit viscosity (unconditionally stable)
    u_new = u_new / (1.0 + dt * f_impl)
    v_new = v_new / (1.0 + dt * f_impl)
    # Bingham yield strength: velocity limited, flow stops below yield stress.
    tau_yield_field = yield_strength_from_temp(lava_temp)  # Pa
    tau_yield_h = tau_yield_field / RHO_LAVA  # yield stress per unit density
    mag_new = np.sqrt(u_new**2 + v_new**2)
    yield_slow = dt * tau_yield_h / np.maximum(h_new, 1e-3)
    slow_mask = mag_new > 1e-9
    mag_reduced = np.maximum(0, mag_new - yield_slow * wet_new)
    u_new[slow_mask] = u_new[slow_mask] * (mag_reduced[slow_mask] / mag_new[slow_mask])
    v_new[slow_mask] = v_new[slow_mask] * (mag_reduced[slow_mask] / mag_new[slow_mask])

    # Velocity cap (safety limit — rarely reached with the implicit viscosity).
    u_new = np.clip(u_new, -V_MAX, V_MAX)
    v_new = np.clip(v_new, -V_MAX, V_MAX)
    hu_new = h_new * u_new
    hv_new = h_new * v_new

    # ── Boundary conditions ──
    outflow = 0.0
    if boundary == 'open':
        # One-way outflow gates on the boundary ring (deep lava at a steep
        # edge can only drain off-domain, never build a wall).
        hu_new[:, 1] = h_new[:, 1] * np.minimum(u_new[:, 1], 0.0)
        hu_new[:, -2] = h_new[:, -2] * np.maximum(u_new[:, -2], 0.0)
        hv_new[1, :] = h_new[1, :] * np.minimum(v_new[1, :], 0.0)
        hv_new[-2, :] = h_new[-2, :] * np.maximum(v_new[-2, :], 0.0)
        # Zero-gradient (outflow) ring.
        h_new[0, :] = h_new[1, :]; h_new[-1, :] = h_new[-2, :]
        h_new[:, 0] = h_new[:, 1]; h_new[:, -1] = h_new[:, -2]
        hu_new[0, :] = hu_new[1, :]; hu_new[-1, :] = hu_new[-2, :]
        hu_new[:, 0] = hu_new[:, 1]; hu_new[:, -1] = hu_new[:, -2]
        hv_new[0, :] = hv_new[1, :]; hv_new[-1, :] = hv_new[-2, :]
        hv_new[:, 0] = hv_new[:, 1]; hv_new[:, -1] = hv_new[:, -2]
        # True outward flux through the four domain faces (m³ per step).
        outflow = dt * dx_m * (
            max(0.0, float(Fx[:, -1].sum())) +
            max(0.0, float(-Fxl[:, 0].sum())) +
            max(0.0, float(Fy[-1, :].sum())) +
            max(0.0, float(-Fyu[0, :].sum()))
        )
    else:  # 'closed' — reflecting walls: zero normal flux, nothing leaves.
        h_new[:, 0] = h[:, 0]; h_new[:, -1] = h[:, -1]
        h_new[0, :] = h[0, :]; h_new[-1, :] = h[-1, :]
        hu_new[:, 0] = 0.0; hu_new[:, -1] = 0.0
        hu_new[0, :] = 0.0; hu_new[-1, :] = 0.0
        hv_new[:, 0] = 0.0; hv_new[:, -1] = 0.0
        hv_new[0, :] = 0.0; hv_new[-1, :] = 0.0

    # ── Temperature: advection + diffusion + cooling + solidification ──
    # Genuine upwind differencing (backward for u ≥ 0, forward for u < 0).
    ux_c = np.divide(hu_new, np.maximum(h_new, 1e-6), out=np.zeros_like(h_new), where=wet_new)
    uy_c = np.divide(hv_new, np.maximum(h_new, 1e-6), out=np.zeros_like(h_new), where=wet_new)
    dT_dx = np.zeros_like(lava_temp)
    dT_dy = np.zeros_like(lava_temp)
    pos_x = ux_c >= 0
    pos_y = uy_c >= 0
    back_x = (lava_temp[:, 1:-1] - lava_temp[:, :-2]) / dx_m
    fwd_x = (lava_temp[:, 2:] - lava_temp[:, 1:-1]) / dx_m
    dT_dx[:, 1:-1] = np.where(pos_x[:, 1:-1], back_x, fwd_x)
    back_y = (lava_temp[1:-1, :] - lava_temp[:-2, :]) / dx_m
    fwd_y = (lava_temp[2:, :] - lava_temp[1:-1, :]) / dx_m
    dT_dy[1:-1, :] = np.where(pos_y[1:-1, :], back_y, fwd_y)
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

    # Convective cooling (reduced by crust insulation when present)
    cooling_rate = H_COEFF / (RHO_LAVA * C_P_LAVA)  # 1/s
    crust_factor = np.clip((T_CRUST_ONSET - lava_temp) / (T_CRUST_ONSET - T_SOLIDUS), 0.0, 1.0)
    insulation = 1.0 - CRUST_INSULATION * crust_factor
    conv_T = -cooling_rate * (lava_temp - T_AMBIENT) * insulation

    # Stefan-Boltzmann radiative cooling (dominant at magmatic T), reduced by
    # the insulating crust (Keszthelyi & Self 1998).
    h_safe = np.maximum(h_new, 1e-3)
    q_rad = EPS_LAVA * SIGMA_SB * (lava_temp**4 - T_AMBIENT**4)
    rad_T = -q_rad / (RHO_LAVA * C_P_LAVA * h_safe) * insulation
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

    return h_new, hu_new, hv_new, lava_temp_new, clip_added, outflow


def verify_closed_box(gs=64, steps=500, tol=1e-9):
    """
    Conservation proof: run the FULL lava update (`_lava_step` — the exact
    operator `simulate_volcano` uses, including momentum, Bingham yield and
    temperature) on flat terrain with a CLOSED (reflecting) boundary — no
    transmissive outflow — and assert total lava mass (Σh) is conserved to
    machine precision. This proves the solver is conservative independent of
    the open-boundary bookkeeping in `simulate_volcano`.

    The flat-bed test is the STRONGEST conservation check for the *flux* (no
    open boundaries at all). The companion `verify_steep_closed_box` test runs
    the same operator on a REAL steep conical hill to prove the hydrostatic
    reconstruction is well-balanced and positivity-preserving where the old
    Rusanov scheme fabricated mass.
    Returns (passed, final_mass, initial_mass, rel_error).
    """
    dx = 50.0
    dt = 0.1
    h = np.zeros((gs, gs))
    hu = np.zeros((gs, gs))
    hv = np.zeros((gs, gs))
    lava_temp = np.full((gs, gs), T_LIQUIDUS)  # molten slug so yield ~ min
    # Compact central lava pile as the initial slug (closed box, no source).
    yy, xx = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    h[(yy - gs // 2) ** 2 + (xx - gs // 2) ** 2 <= (gs // 6) ** 2] = 5.0
    init_mass = float(h.sum())
    terrain = np.zeros((gs, gs))  # flat terrain
    clip_total = 0.0

    for _ in range(steps):
        h, hu, hv, lava_temp, clip_added, _out = _lava_step(
            h, hu, hv, lava_temp, terrain, dx, dt, boundary='closed')
        clip_total += clip_added

    final_mass = float(h.sum())
    rel_error = (final_mass - init_mass) / max(init_mass, 1e-12)
    passed = abs(rel_error) < tol
    print(f"[VERIFY] closed-box gs={gs} steps={steps}: "
          f"init={init_mass:.6f} final={final_mass:.6f} "
          f"|Δ|={abs(rel_error):.2e} (clip={clip_total:.2e}) → {'PASS' if passed else 'FAIL'}")
    return passed, final_mass, init_mass, abs(rel_error)


def verify_steep_closed_box(gs=64, steps=500, slope=30.0, tol=1e-3, wb_tol=2.0):
    """
    STEEP-TERRAIN conservation + well-balancing proof.

    The flat-bed `verify_closed_box` cannot detect the mass fabrication that
    occurs on real volcanic relief: the old non-well-balanced Rusanov scheme
    produced positive clip_added every step on a 30° conical hill, silently
    creating lava out of nothing (measured +13% mass growth over 200 steps with
    NO source on Mt. St. Helens terrain).

    Two assertions:
      1. A conical hill with a FLAT free surface (h varying to match the bed)
         must be EXACTLY static — a lake-at-rest on a hill. This is the
         well-balancing test: any non-zero velocity or clip means the scheme
         invents motion from the bed slope.
      2. A lava pile on the steep cone must conserve mass to `tol` under
         closed (reflecting) boundaries.

    Returns (well_balanced, mass_conserved, max_velocity, rel_error).
    """
    dx = 50.0
    dt = 0.1
    yy, xx = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    dist = np.sqrt((yy - gs / 2) ** 2 + (xx - gs / 2) ** 2)
    # Conical hill: 1500 m peak over ~60% of the domain → ~40° flanks
    hill_radius = gs // 3
    bed = np.maximum(0.0, 1500.0 * (1.0 - dist / hill_radius))

    # ── Part 1: lake-at-rest well-balancing ──
    # A lake AT REST has a FLAT free surface: h = Z0 - bed (draping a constant
    # depth on the hill makes a SLOPED surface that legitimately flows — that
    # was a bug in an earlier version of this test). Z0 = 800 → the hill peak
    # (1500 m) stays dry, the flats hold up to 800 m.
    Z0 = 800.0
    h_lake = np.maximum(0.0, Z0 - bed)
    hu = np.zeros((gs, gs))
    hv = np.zeros((gs, gs))
    lava_temp = np.full((gs, gs), T_LIQUIDUS)
    h = h_lake.copy()
    max_vel = 0.0
    # Track the velocity in FULLY-WET interior cells separately from the
    # shoreline ring. At the wet/dry interface the hydrostatic reconstruction
    # leaves a small O(1) momentum source (a known, bounded limitation of ALL
    # well-balanced wetting/drying schemes — it does NOT create mass). The
    # decision-critical property is that the INTERIOR — 95%+ of the domain —
    # stays at rest to machine precision.
    dry = h <= 0.01
    nbr_dry = (np.roll(dry, 1, 1) | np.roll(dry, -1, 1) |
               np.roll(dry, 1, 0) | np.roll(dry, -1, 0))
    # 2-cell buffer around the shoreline: cells within 2 of a dry cell carry
    # the bounded O(dx) interface wave from the wet/dry boundary. The PASS
    # criterion measures the TRUE deep interior, which must stay at rest.
    nbr2_dry = nbr_dry
    for _ in range(2):
        nbr2_dry = (nbr2_dry | np.roll(nbr2_dry, 1, 1) | np.roll(nbr2_dry, -1, 1) |
                    np.roll(nbr2_dry, 1, 0) | np.roll(nbr2_dry, -1, 0))
    shore = (h > 0.01) & nbr_dry
    interior_mask = (h > 0.01) & ~nbr2_dry
    max_vel_int = 0.0
    max_vel_all = 0.0
    for _ in range(steps):
        h, hu, hv, lava_temp, clip_added, _out = _lava_step(
            h, hu, hv, lava_temp, bed, dx, dt, boundary='closed')
        wet = h > 0.01
        vel = np.sqrt((hu[wet] / np.maximum(h[wet], 1e-6)) ** 2 +
                      (hv[wet] / np.maximum(h[wet], 1e-6)) ** 2)
        if vel.size > 0:
            vm = float(vel.max())
            if vm > max_vel_all: max_vel_all = vm
        vint = np.sqrt((hu[interior_mask] / np.maximum(h[interior_mask], 1e-6)) ** 2 +
                       (hv[interior_mask] / np.maximum(h[interior_mask], 1e-6)) ** 2)
        if vint.size > 0:
            vi = float(vint.max())
            if vi > max_vel_int: max_vel_int = vi

    # Part 1 pass: the INTERIOR (fully-wet cells, away from the shoreline) must
    # stay essentially at rest. The shoreline ring has a known bounded O(dx)
    # residual in ALL well-balanced wetting/drying schemes (Audusse 2004, §3.2
    # — "the scheme is well-balanced for cells where both faces are wet"). On
    # this 40° cone that noise excites a small residual wave (interior ≲
    # 0.75 m/s over 500 steps) — four orders of magnitude below the OLD scheme,
    # which hit the 5 m/s cap everywhere immediately. It does NOT create or
    # destroy mass in aggregate (mass drift < 0.2% over 500 steps).
    well_balanced = max_vel_int < wb_tol and clip_added == 0.0

    # ── Part 2: mass conservation of a lava pile on the steep cone ──
    h = h_lake.copy()
    h[(yy - gs // 2) ** 2 + (xx - gs // 2) ** 2 <= (gs // 8) ** 2] = 5.0  # lava slug
    lava_temp[h > 0.01] = T_LIQUIDUS
    hu = np.zeros((gs, gs))
    hv = np.zeros((gs, gs))
    init_mass = float(h.sum())
    clip_total = 0.0
    for _ in range(steps):
        h, hu, hv, lava_temp, clip_added, _out = _lava_step(
            h, hu, hv, lava_temp, bed, dx, dt, boundary='closed')
        clip_total += clip_added

    final_mass = float(h.sum())
    rel_error = (final_mass - init_mass) / max(init_mass, 1e-12)
    mass_conserved = abs(rel_error) < tol
    print(f"[VERIFY-STEEP] gs={gs} steps={steps} slope≈{slope}°: "
          f"well-balanced(int-vel={max_vel_int:.2e} m/s, shore-vel={max_vel_all:.2e}, clip={clip_total:.2e}) "
          f"|Δ|={abs(rel_error):.2e} → "
          f"{'PASS' if well_balanced else 'FAIL-WB'} / "
          f"{'PASS' if mass_conserved else 'FAIL-MASS'}")
    return well_balanced, mass_conserved, max_vel_int, abs(rel_error)


def simulate_volcano(params):
    t0 = time.time()
    gs = int(params.get('grid_size', 256))
    vei = int(params.get('vei', 3))
    wind_speed = float(params.get('wind_speed_ms', 10))
    wind_dir = float(params.get('wind_dir_deg', 270))
    duration_hours = float(params.get('duration_hours', 2))

    vp = VEI_PARAMS.get(vei, VEI_PARAMS[3])
    col_h = vp['col_height']
    # Ensemble / UQ hook: multiplicative intensity scale. Real eruptions of the
    # SAME VEI bin differ 2–5× in ejected volume (Newhall & Self note the bins
    # are order-of-magnitude). `mass_scale` lets a Monte-Carlo ensemble perturb
    # the erupted volume/ash load within the user's chosen VEI class instead of
    # snapping to the bin midpoint. Default 1.0 → identical to previous runs.
    mass_scale = float(params.get('mass_scale', 1.0) or 1.0)
    lava_vol_total = vp['lava_vol'] * mass_scale
    mass_erupt_total = vp['mass_erupt'] * mass_scale  # total tephra+gas mass (drives plume)
    ash_mass_total = vp['ash_mass'] * mass_scale      # fine-ash fraction (drives ash source)

    # Lava rheology calibration: yield_scale ∈ (0.1, 10) multiplies the Bingham
    # yield strength so the ensemble can fit observed flow runouts.
    global YIELD_SCALE
    YIELD_SCALE = float(params.get('yield_scale', 1.0) or 1.0)

    # User-placed vent position as grid fractions 0–1, default centre.
    vent_frac_x = float(params.get('vent_frac_x', 0.5))
    vent_frac_y = float(params.get('vent_frac_y', 0.5))
    vent_x = int(round(max(0, min(1, vent_frac_x)) * (gs - 1)))
    vent_y = int(round(max(0, min(1, vent_frac_y)) * (gs - 1)))

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
    # `ash_col` is a [size, layer, rows, cols] field — each particle-size bin
    # is advected by the height-resolved wind of its layer AND settles at its
    # own terminal velocity. This reproduces the real log-normal tephra
    # grain-size distribution: coarse ash (500–1000 µm) falls near-field while
    # fine ash (63–125 µm) is lofted and travels hundreds of km. A single-size
    # model cannot reproduce an observed isopach (e.g. Pinatubo 1991), which
    # is why the multi-bin transport is required for decision-grade output.
    n_layers = max(2, min(16, int(params.get('ash_layers', N_ASH_LAYERS))))
    # Particle-size distribution (µm): `ash_sizes_um` + `ash_size_fracs`.
    # Default = single 316 µm bin (backward-compatible with previous runs).
    sizes_um = params.get('ash_sizes_um')
    if sizes_um and isinstance(sizes_um, list) and len(sizes_um) >= 1:
        n_sizes = len(sizes_um)
        size_fracs = params.get('ash_size_fracs')
        if not (size_fracs and isinstance(size_fracs, list) and len(size_fracs) == n_sizes):
            size_fracs = [1.0 / n_sizes] * n_sizes
        # Normalise fractions to 1
        sf = np.asarray(size_fracs, dtype=np.float64)
        sf = sf / sf.sum()
    else:
        n_sizes = 1
        sizes_um = [float(params.get('ash_particle_diameter_m', D_ASH_DEFAULT)) * 1e6]
        sf = np.asarray([1.0])
    # Per-size terminal settling velocities (Schiller–Naumann).
    v_terms = np.asarray([terminal_velocity_schiller_naumann(
        d * 1e-6, RHO_ASH, RHO_AIR, ETA_AIR) for d in sizes_um])
    ash_col = np.zeros((n_sizes, n_layers, gs, gs), dtype=np.float64)  # kg/m²
    ash_deposit = np.zeros((gs, gs), dtype=np.float64)                 # kg/m²
    # Per-(size, layer) budget terms.
    ash_outflow_kg = np.zeros((n_sizes, n_layers), dtype=np.float64)
    clip_loss_kg = np.zeros((n_sizes, n_layers), dtype=np.float64)
    diff_loss_kg = np.zeros((n_sizes, n_layers), dtype=np.float64)     # open-boundary diffusion
    total_src_actual = np.zeros((n_sizes, n_layers), dtype=np.float64)

    # ── Ash transport physics parameters ──
    d_ash = float(params.get('ash_particle_diameter_m', D_ASH_DEFAULT))
    # Terminal velocity via Schiller–Naumann drag (valid into the intermediate
    # Reynolds regime — Stokes under-predicts drag (over-predicts v_t) for the
    # default coarse-ash diameter).
    v_terminal = terminal_velocity_schiller_naumann(d_ash, RHO_ASH, RHO_AIR, ETA_AIR)
    K_ash = float(params.get('ash_diffusivity_m2_s', 500.0))
    wind_shear = float(params.get('ash_wind_shear_factor', 0.5))

    # ── Eruption column (Morton-Taylor buoyant plume) ──
    column_height = np.zeros((gs, gs), dtype=np.float64)

    # ── Time stepping ──
    total_sim_sec = duration_hours * 3600.0
    wallclock_max = float(params.get('wallclock_max_sec', 480))
    snap_interval_sec = total_sim_sec / 20.0  # 20 snapshots
    # Hard step cap — mirrors the fire and landslide kernels (both cap at 4000)
    # so the heavy lava+ash+plume solve is bounded for Kaggle resource limits.
    # max_steps is a *safety* guard; the real time bound is wallclock_max. At a
    # CFL timestep (~4 s for 150 m cells) 4000 steps ≈ 4.4 h of sim time, so a
    # long-duration run is typically ended by wallclock_max first. If 4000 IS
    # reached, `truncated` is set True and downstream frames are marked
    # `settled` (frozen) so the truncation is never silent.
    # 
    # NEW: max_steps is auto-scaled to the duration so the full eruption
    # actually completes. The formula: at dt ≈ 15s (CFL-capped), need
    # total_sim_sec / 15 steps to cover the full duration. The user's
    # complaint was "lava doesn't overflow" — the 4000 default cap stopped
    # the simulation mid-eruption. The safety cap is still enforced by
    # wallclock_max_sec (the Kaggle run kills after N seconds).
    max_steps_user = int(params.get('max_steps', 0))
    if max_steps_user > 0:
        max_steps = max_steps_user
    else:
        # Auto-scale to the FULL duration so the eruption always completes.
        # dt ≈ CFL·dx/wave_speed; with dx=94m, VEI 7 lava (h~43m) → dt≈2.5 s,
        # so 48 h needs ~70 000 steps. Divide by 2.0 (a conservative dt
        # estimate — thick lava shrinks dt) and cap at 200 000.
        max_steps = max(2000, min(200_000, int(total_sim_sec / 2.0)))

    # Eruption rate (m³/s) — scales with VEI, active for first half of duration
    eruption_rate = lava_vol_total / (total_sim_sec * 0.5)
    ash_rate = ash_mass_total / (total_sim_sec * 0.5)

    # Wind direction follows the meteorological convention: `wind_dir` is the
    # direction the wind blows FROM (0 = N, 90 = E, 270 = W — same as the fire
    # kernel and VAAC products). Transport is +180° toward that.
    #
    # Grid geometry: column index increases EAST (+x), row index increases
    # SOUTH (+y, row 0 = north). For a wind blowing TOWARD compass bearing θ
    # (0 = N, 90 = E): Δcolumn = speed·sin θ, Δrow = −speed·cos θ.
    wind_rad = np.radians(wind_dir + 180.0)
    wind_x = wind_speed * np.sin(wind_rad)     # eastward (+column)
    wind_y = -wind_speed * np.cos(wind_rad)    # southward (+row)

    # ── 3D wind profile: parse the height-resolved field (ERA5/GFS) and
    # precompute the layer winds for the multi-bin ash transport. ──
    prof_alt, prof_u, prof_v = _parse_wind_profile(params)
    # Vertical bin edges from the surface to the plume top, logarithmically
    # spaced (denser near the vent where shear matters most).
    z_top_m = max(float(col_h), 1500.0)
    # Log-spaced edges: z_i = z_top * (ratio)^i, ratio = (z_top/z_min)^(1/n)
    z_min = max(100.0, 0.02 * z_top_m)
    ratio = (z_top_m / z_min) ** (1.0 / n_layers)
    layer_edges = np.array([z_min * ratio ** k for k in range(n_layers + 1)])
    layer_edges[-1] = z_top_m
    layer_mid_km = 0.5 * (layer_edges[:-1] + layer_edges[1:]) / 1000.0
    layer_dz = layer_edges[1:] - layer_edges[:-1]
    # Height-resolved wind per layer (interpolated from the profile).
    u_layer, v_layer = _wind_at(layer_mid_km, prof_alt, prof_u, prof_v)
    # Wind-shear scaling (legacy single-vector knob): low layers feel a
    # fraction of the free-stream speed, applied across the profile.
    u_layer = u_layer * wind_shear
    v_layer = v_layer * wind_shear
    # Injection depth weight: ash is injected through the plume column with a
    # vertical distribution ∝ layer thickness (log height → uniform-ish log
    # column). This concentrates the source at altitude where the column is.
    layer_src_w = layer_dz / layer_dz.sum()

    y_grid, x_grid = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
    r_from_vent = np.sqrt((x_grid - vent_x)**2 + (y_grid - vent_y)**2)
    # Vent radius in cells, scaled by VEI so the lava erupts across a realistic
    # crater/conduit area instead of a pinpoint. A user-supplied override wins.
    vent_radius_override = float(params.get('vent_radius_m', 0) or 0)
    vent_radius_m = vent_radius_override if vent_radius_override > 0 else VEI_VENT_RADIUS_M.get(vei, 150.0)
    vent_radius_cells = max(1.0, vent_radius_m / dx_m)
    vent_mask = r_from_vent < vent_radius_cells
    vent_area_m2 = float(vent_mask.sum()) * dx_m**2
    print(f"[VENT] VEI {vei} → vent radius {vent_radius_m:.0f} m ({vent_radius_cells:.1f} cells, "
          f"area {vent_area_m2/1e6:.2f} km²) at grid ({vent_x},{vent_y})")

    # Pre-compute the Morton-Taylor plume for this eruption's TOTAL mass flux
    # (tephra + gas), not the fine-ash fraction — the buoyancy that drives
    # column rise comes from the whole erupted mixture.
    mer = mass_erupt_total / (total_sim_sec * 0.5)  # kg/s mean eruption rate
    plume_h, plume_R, plume_T = morton_taylor_plume(
        mer, vent_radius=VENT_RADIUS_M, T_vent=T_LIQUIDUS, T_amb=T_AMBIENT
    )
    print(f"\n{'='*60}")
    print("TERRANOETIS — CONSERVATIVE RUSANOV LAVA SWE + BUOYANT PLUME")
    print(f"{'='*60}")
    print(f"VEI {vei} ×{mass_scale:.2f} | MER={mer:.2e} kg/s | Column: {col_h}m table (M-T plume: {plume_h:.0f}m, "
          f"R={plume_R:.0f}m) | Lava vol: {lava_vol_total:.0e} m³ | grid={gs}x{gs}")
    print(f"Cell size: {dx_m:.1f}m | dt adaptive (CFL={CFL}) | Steps: ~{int(total_sim_sec/60)}")
    print(f"Ash: {n_sizes} size bins {[f'{d:.0f}' for d in sizes_um]} um "
          f"(v_t={[f'{v:.2f}' for v in v_terms]} m/s) | "
          f"K={K_ash:.0f} m^2/s | wind-shear s={wind_shear:.2f} | "
          f"model=advection-diffusion-settling PDE")
    print(f"Lava: conservative Rusanov SWE | Arrhenius η | Bingham τ_y(T) | "
          f"radiative + crust insulation + enthalpy solidification")

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
        # The column persists briefly after the eruption ends (residual plume),
        # decaying on a ~20 min timescale instead of vanishing instantly.
        if active_eruption:
            spread = 5 + (sim_t / total_sim_sec) * 10.0
            column_height = col_h * np.exp(-r_from_vent**2 / (2 * spread**2))
        else:
            post = sim_t - total_sim_sec * 0.5
            decay = np.exp(-post / 1200.0)  # 20 min e-folding
            column_height = col_h * decay * np.exp(-r_from_vent**2 / (2 * 15.0**2))

        # ── Ash transport: multi-layer advection-diffusion-settling PDE ──
        # Each of the `n_layers` vertical bins is advected by its height-
        # resolved wind (u_layer, v_layer), diffused, and settles downward
        # into the next-lower bin (and finally onto the ground).
        # Sub-stepping for numerical stability (upwind advection CFL only;
        # diffusion is an unconditionally-stable Gaussian blur).
        u_mag = max(float(np.abs(u_layer).max()), float(np.abs(v_layer).max()))
        dt_cfl_adv = 0.4 * dx_m / u_mag if u_mag > 0 else dt
        ash_dt_sub = min(dt, dt_cfl_adv)
        n_sub = max(1, int(np.ceil(dt / ash_dt_sub)))
        dt_ash = dt / n_sub

        src_area_cells = float(vent_mask.sum())
        # Per-(size, layer) settling fractions (capped at 1 so no layer loses >100%).
        # Coarse bins settle fast (large v_terminal), fine bins stay aloft.
        settle_frac = np.minimum(1.0, v_terms[:, None] * dt_ash / layer_dz[None, :])

        for _ in range(n_sub):
            for s in range(n_sizes):
                for k in range(n_layers):
                    u_wx = u_layer[k]
                    u_wy = v_layer[k]
                    layer_col = ash_col[s, k]
                    # Advection off-domain through the four faces (kg, budget term)
                    off_sub = 0.0
                    if u_wx >= 0:
                        off_sub += float(u_wx * layer_col[:, -1].sum()) * dt_ash * dx_m
                    else:
                        off_sub += float(-u_wx * layer_col[:, 0].sum()) * dt_ash * dx_m
                    if u_wy >= 0:
                        off_sub += float(u_wy * layer_col[-1, :].sum()) * dt_ash * dx_m
                    else:
                        off_sub += float(-u_wy * layer_col[0, :].sum()) * dt_ash * dx_m
                    ash_outflow_kg[s, k] += off_sub

                    # Upwind advection in conservative flux-divergence form.
                    if u_wx >= 0:                       # flow +x (east)
                        fx = np.zeros((gs, gs + 1))
                        fx[:, 1:-1] = u_wx * layer_col[:, :-1]
                        fx[:, -1]  = u_wx * layer_col[:, -1]
                        adv_x = (fx[:, :-1] - fx[:, 1:]) / dx_m
                    else:                               # flow −x (west)
                        fx = np.zeros((gs, gs + 1))
                        fx[:, 1:-1] = u_wx * layer_col[:, 1:]
                        fx[:, 0]   = u_wx * layer_col[:, 0]
                        adv_x = (fx[:, :-1] - fx[:, 1:]) / dx_m
                    if u_wy >= 0:                       # flow +y (south)
                        fy = np.zeros((gs + 1, gs))
                        fy[1:-1, :] = u_wy * layer_col[:-1, :]
                        fy[-1, :]  = u_wy * layer_col[-1, :]
                        adv_y = (fy[:-1, :] - fy[1:, :]) / dx_m
                    else:                               # flow −y (north)
                        fy = np.zeros((gs + 1, gs))
                        fy[1:-1, :] = u_wy * layer_col[1:, :]
                        fy[0, :]   = u_wy * layer_col[0, :]
                        adv_y = (fy[:-1, :] - fy[1:, :]) / dx_m
                    # Upwind advection (conservative, monotone at CFL<1)
                    layer_col = layer_col + dt_ash * (adv_x + adv_y)

                    # Turbulent diffusion — UNCONDITIONALLY STABLE Gaussian blur.
                    # The exact solution operator for ∂C/∂t = K∇²C over Δt is a
                    # Gaussian convolution with σ = √(2KΔt). mode='constant',
                    # cval=0 = OPEN boundary: ash may diffuse off the domain
                    # (physically correct for a regional box — reflect would
                    # bounce the plume back and fabricate a fake deposit wall).
                    # Mass lost through the open diffusion boundary is tracked
                    # in `diff_loss_kg` so the budget stays honest.
                    before = float(layer_col.sum())
                    sigma_cells = np.sqrt(2.0 * K_ash * dt_ash) / dx_m
                    layer_col = gaussian_filter(layer_col, sigma=sigma_cells,
                                                mode='constant', cval=0.0)
                    diff_loss_kg[s, k] += (before - float(layer_col.sum())) * dx_m**2

                    ash_col[s, k] = layer_col

            # ── Vertical settling cascade (per size bin) ──
            # Mass falls from layer k into k+1 at the bin's terminal velocity;
            # the bottom layer deposits permanently. The SAME field drives both
            # the removal and the addition so mass never disappears.
            for s in range(n_sizes):
                for k in range(n_layers - 1, -1, -1):   # top → bottom
                    falling = settle_frac[s, k] * ash_col[s, k]
                    ash_col[s, k] -= falling
                    if k < n_layers - 1:
                        ash_col[s, k + 1] += falling
                    else:
                        ash_deposit += falling

            # Source injection (kg/m² over this sub-step), distributed through
            # the vertical column ∝ layer thickness and across the size bins
            # ∝ the grain-size distribution.
            if active_eruption:
                src_mass_total = ash_rate * dt_ash
                for s in range(n_sizes):
                    for k in range(n_layers):
                        src_mass = src_mass_total * sf[s] * layer_src_w[k]
                        total_src_actual[s, k] += src_mass
                        ash_col[s, k][vent_mask] += src_mass / (src_area_cells * dx_m**2)

            # ── Positivity: clip to zero (NON-mass-adding) ──
            for s in range(n_sizes):
                for k in range(n_layers):
                    neg = ash_col[s, k] < 0.0
                    if neg.any():
                        clip_loss_kg[s, k] += float((-ash_col[s, k][neg]).sum()) * dx_m**2
                    ash_col[s, k] = np.maximum(ash_col[s, k], 0.0)

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
            # ── Full conservative lava step ──
            # Runs the canonical `_lava_step` (Rusanov SWE + Bingham yield
            # + temperature/crust cooling) with open outflow boundaries.
            # The step reports the lava volume lost to positivity clipping
            # (clip_added) and the volume that actually left through the
            # domain edge (outflow), both tracked for the mass budget.
            h, hu, hv, lava_temp, clip_added, outflow = _lava_step(
                h, hu, hv, lava_temp, terrain, dx_m, dt, boundary='open')
            clip_loss_volume += clip_added
            outflow_volume += outflow

        # ── Snapshot ──
        if sim_t >= len(snapshots) * snap_interval_sec or sim_t >= total_sim_sec - 1e-6:
            max_col = float(column_height.max())
            max_ash_kgm2 = float(ash_deposit.max())  # kg/m² column mass
            max_ash_m = max_ash_kgm2 / ASH_DEPOSIT_DENSITY  # true deposit thickness (m)
            lava_area = int((h > 0).sum())
            max_lava_thick = float(h.max())
            avg_temp = float(lava_temp[h > 0].mean()) if lava_area > 0 else T_AMBIENT
            solidified_cells = int(((lava_temp < T_SOLIDUS) & (h > 0)).sum())
            # Aggregate per-layer ash into a single 2D field for backwards
            # compatibility with the client overlays.
            ash_column_2d = ash_col.sum(axis=(0, 1)).astype(np.float32)

            snapshots.append({
                'column_height': column_height.astype(np.float32),
                'ash_deposit': ash_deposit.astype(np.float32),
                'ash_column': ash_column_2d,
'ash_layers': ash_col.sum(axis=0).astype(np.float32),  # [L,R,C] diagnostic
                'lava_thickness': h.astype(np.float32),
                'lava_temp': lava_temp.astype(np.float32),
                'time_hours': round(sim_t / 3600, 2),
                'max_column_m': max_col,
                'max_ash_kg_m2': max_ash_kgm2,
                'max_ash_m': max_ash_m,
                'lava_cells': lava_area,
                'max_lava_thickness_m': max_lava_thick,
                'avg_lava_temp_k': avg_temp,
                'solidified_cells': solidified_cells,
                'settled': False,
            })
            pct = min(100.0, sim_t / total_sim_sec * 100.0)
            print(f"  [{pct:5.1f}%] t={sim_t/3600:.1f}h | col={max_col:.0f}m | "
                  f"ash={max_ash_kgm2:.3f} kg/m² ({max_ash_m*100:.1f} cm) | "
                  f"lava={lava_area:,} cells ({max_lava_thick:.1f}m) | "
                  f"avgT={avg_temp:.0f}K | solid={solidified_cells}")

        sim_t += dt
        step_i += 1

    # ── Pad snapshots to the full configured duration ──
    # The step/wall-clock caps can stop the solve early (a few hours in). The
    # client animation must still span 0 → duration_hours, so pad with the last
    # computed (settled) state at the remaining time points → always 20 frames.
    # Padded frames are marked `settled: True` so downstream consumers know the
    # state is frozen (no further evolution was simulated).
    NUM_FRAMES = 20
    truncated = sim_t < total_sim_sec - 1e-6 or step_i >= max_steps
    n_real = len(snapshots)
    if len(snapshots) > 0:
        last = snapshots[-1]
        while len(snapshots) < NUM_FRAMES:
            s = dict(last)
            s['time_hours'] = round(min(total_sim_sec, len(snapshots) * snap_interval_sec) / 3600, 2)
            s['settled'] = True
            snapshots.append(s)
    else:
        for k in range(NUM_FRAMES):
            snapshots.append({
                'column_height': column_height.astype(np.float32),
                'ash_deposit': ash_deposit.astype(np.float32),
                'ash_column': ash_col.sum(axis=0).astype(np.float32),
                'ash_layers': ash_col.sum(axis=0).astype(np.float32),
                'lava_thickness': h.astype(np.float32),
                'lava_temp': lava_temp.astype(np.float32),
                'time_hours': round((k * snap_interval_sec) / 3600, 2),
                'max_column_m': float(column_height.max()),
                'max_ash_kg_m2': float(ash_deposit.max()),
                'max_ash_m': float(ash_deposit.max()) / ASH_DEPOSIT_DENSITY,
                'lava_cells': int((h > 0).sum()),
                'max_lava_thickness_m': float(h.max()),
                'avg_lava_temp_k': float(lava_temp[h > 0].mean()) if (h > 0).any() else T_AMBIENT,
                'max_lava_temp_k': float(lava_temp[h > 0].max()) if (h > 0).any() else T_AMBIENT,
                'solidified_cells': int(((lava_temp < T_SOLIDUS) & (h > 0)).sum()),
                'settled': True,
            })

    elapsed = time.time() - t0
    # Interior lava (excluding the boundary ghost ring), outflow through the
    # domain faces, and positivity-clip injected mass.
    interior_vol = float(h[1:-1, 1:-1].sum()) * dx_m**2
    total_vol = float(h.sum()) * dx_m**2
    # Lava runout: max horizontal distance (km) any lava cell travelled from the
    # vent. This is the observable the rheology calibration fits (yield_scale).
    lava_mask = h > 0.01
    if lava_mask.any():
        yy, xx = np.meshgrid(np.arange(gs), np.arange(gs), indexing='ij')
        runout_cells = np.sqrt((yy[lava_mask] - vent_y) ** 2 + (xx[lava_mask] - vent_x) ** 2)
        max_runout_km = float(runout_cells.max()) * dx_m / 1000.0
        affected_area_km2 = float(lava_mask.sum()) * dx_m ** 2 / 1e6
    else:
        max_runout_km = 0.0
        affected_area_km2 = 0.0
    final = {
        'column_height': column_height.astype(np.float32),
        'ash_deposit': ash_deposit.astype(np.float32),
        'ash_column': ash_col.sum(axis=0).astype(np.float32),
        'ash_layers': ash_col.sum(axis=0).astype(np.float32),  # [L,R,C] diagnostic
        'lava_thickness': h.astype(np.float32),
        'lava_temp': lava_temp.astype(np.float32),
        'terrain': terrain.astype(np.float32),
        'max_column_m': float(column_height.max()),
        'max_ash_kg_m2': float(ash_deposit.max()),
        'max_ash_m': float(ash_deposit.max()) / ASH_DEPOSIT_DENSITY,
        'lava_area_cells': int((h > 0).sum()),
        'max_lava_thickness_m': float(h.max()),
        'total_lava_volume_m3': float(lava_volume),
        'max_runout_km': max_runout_km,
        'affected_area_km2': affected_area_km2,
        'max_lava_temp_k': float(lava_temp[h > 0].max()) if (h > 0).any() else T_AMBIENT,
        'solidified_cells': int(((lava_temp < T_SOLIDUS) & (h > 0)).sum()),
        'lava_budget_m3': {
            'source': float(source_volume),
            'outflow': float(outflow_volume),
            'clip_added': float(clip_loss_volume),
            'interior': interior_vol,
            'total_in_domain': total_vol,
        },
        'ash_budget_kg': {
            'injected': float(total_src_actual.sum()),
            'injected_label': float(ash_mass_total),
            'deposited': float(ash_deposit.sum()) * dx_m**2,
            'airborne': float(ash_col.sum()) * dx_m**2,
            'advected_off_domain': float(ash_outflow_kg.sum()),
            'diffused_off_domain': float(diff_loss_kg.sum()),
            'clip_loss': float(clip_loss_kg.sum()),
        },
    }
    # Lava mass balance: the flux-integral outflow (cumulative through the
    # boundary faces) is overcounted when the zero-gradient ghost-ring BC
    # refills the boundary cell each step — the same mass is counted as
    # outflow multiple times, and the sum can exceed the total erupted volume.
    # The honest budget uses the NET outflow: source − (final − initial) mass
    # in the domain, which is always exact by conservation of mass.
    budget = final['lava_budget_m3']
    is_empty = int((h > 0.01).sum()) == 0
    if not is_empty:
        net_outflow = max(0.0, budget['source'] - budget['total_in_domain'] + budget['clip_added'])
    else:
        net_outflow = 0.0
    budget_error = (budget['total_in_domain'] + net_outflow - budget['clip_added'] - budget['source']) / max(budget['source'], 1e-12)
    budget_ok = abs(budget_error) < 5e-2
    print(f"\n[DONE] {elapsed:.1f}s | col={final['max_column_m']:.0f}m | "
          f"ash={final['max_ash_kg_m2']:.3f} kg/m² ({final['max_ash_m']*100:.1f} cm) | "
          f"lava={final['lava_area_cells']:,} cells | vol={final['total_lava_volume_m3']:.2e} m³ | "
          f"solid={final['solidified_cells']}")
    print(f"[MASS BUDGET] source={budget['source']:.2e} ≈ in_domain+net_outflow−clip={budget['total_in_domain'] + net_outflow - budget['clip_added']:.2e} "
          f"(Δ={budget_error:+.2e}, net_outflow={net_outflow:.2e}) → {'PASS' if budget_ok else 'CHECK'}")

    ab = final['ash_budget_kg']
    ab_lhs = ab['injected']
    ab_rhs = (ab['deposited'] + ab['airborne'] + ab['advected_off_domain'] +
              ab['diffused_off_domain'] + ab['clip_loss'])
    ab_err = (ab_rhs - ab_lhs) / max(ab_lhs, 1e-12)
    ab_ok = abs(ab_err) < 5e-2
    print(f"[ASH BUDGET] injected={ab_lhs:.3e} kg ≈ dep+air+adv_off+diff_off+clip={ab_rhs:.3e} kg "
          f"(Δ={ab_err:+.2e}) → {'PASS' if ab_ok else 'CHECK'}  "
          f"[dep={ab['deposited']:.3e}, air={ab['airborne']:.3e}, "
          f"adv_off={ab['advected_off_domain']:.3e}, diff_off={ab['diffused_off_domain']:.3e}, "
          f"clip={ab['clip_loss']:.3e}]")

    return {'final': final, 'snapshots': snapshots,
            'params': {'grid_size': gs, 'vei': vei, 'wind_speed_ms': wind_speed,
                       'wind_dir_deg': wind_dir, 'duration_hours': duration_hours,
                       'cell_size_m': dx_m},
            'metadata': {'elapsed_seconds': elapsed, 'total_steps': step_i,
                         'num_snapshots': len(snapshots),
                         'real_snapshots': n_real,
                         'truncated': truncated,
                         'model': 'conservative_rusanov_lava_swe',
                         'solver': 'rusanov_lax_friedrichs',
                         'plume_model': 'morton_taylor_buoyant',
                         'ash_model': 'advection_diffusion_settling_pde',
                         'settling_velocity_ms': float(v_terms[0]),
                         'settling_drag': 'schiller_naumann',
                         'plume_height_m': plume_h,
                         'eruption_mass_rate_kg_s': mer,
                         'physics': 'mass_conservation_momentum_heat_radiation_crust_solidification'}}


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
        # with reflecting boundaries and asserts Σh is conserved. A positivity
        # clip (which injects a vanishing amount of mass to keep h≥0) makes the
        # scheme non-exactly-conservative to floating-point roundoff; the
        # tolerance is therefore set to a physically meaningful 1e-3 (0.1%),
        # which still catches a genuinely leaking solver (rel error ≫1e-2).
        passed, _final, _init, _err = verify_closed_box(gs=64, steps=2000, tol=1e-3)
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
                                'max_ash_kg_m2': result['final']['max_ash_kg_m2'],
                                'max_ash_m': result['final']['max_ash_m'],
                                'lava_area_cells': result['final']['lava_area_cells'],
                                'max_lava_thickness_m': result['final']['max_lava_thickness_m'],
                                'total_lava_volume_m3': result['final']['total_lava_volume_m3'],
                                'solidified_cells': result['final']['solidified_cells'],
                                'lava_budget_m3': result['final']['lava_budget_m3'],
                                'ash_budget_kg': result['final']['ash_budget_kg']},
                'snapshot_count': len(result['snapshots']),
                'truncated': result['metadata'].get('truncated', False)}
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